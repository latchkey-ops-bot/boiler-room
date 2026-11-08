import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Campaign, sceneFrames, sceneRegistry, validateCampaign } from '@boiler-room/schema';
import { describe, expect, it, vi } from 'vitest';
import { qualityCheck } from '../src/definitions/quality-check.ts';
import type { Naive } from '../src/naive/client.ts';
import {
  checkFrames,
  checkGate,
  checkGround,
  checkIntegrity,
  checkProbe,
  checkResearchBrand,
  checkResearchClaims,
  type ResearchFacts,
  timecode,
} from '../src/quality/checks.ts';
import {
  edgePixels,
  FrameScanner,
  type FrameStats,
  measureFrame,
  nearestPatch,
  rgbToHex,
  staticRuns,
} from '../src/quality/measure.ts';
import { qcReviewJsonSchema, qcReviewSchema } from '../src/quality/output.ts';
import { reviewTask, VISUAL_CHECKS } from '../src/quality/prompt.ts';
import { cutOf, readRenderDir } from '../src/quality/render-dir.ts';
import { mergeReviews, runReview, ViewTracker } from '../src/quality/review.ts';
import { finalVerdict, readResearch } from '../src/quality/run.ts';
import { contactFrames, transitionStills } from '../src/quality/sheets.ts';
import { PageIndex, type PagesBundle } from '../src/researcher/verify.ts';
import { skillContent } from '../src/sync.ts';
import { exampleResearch, workedExample } from './director-fixtures.ts';

const example = (): Campaign =>
  JSON.parse(
    readFileSync(
      new URL('../../packages/schema/examples/nova.campaign.json', import.meta.url),
      'utf8',
    ),
  ) as Campaign;

/** A film of `length` frames that moves on every frame, with `edit` applied to some of them. */
function film(length: number, edit: (frame: number) => Partial<FrameStats> = () => ({})) {
  return Array.from(
    { length },
    (_, frame): FrameStats => ({
      frame,
      max: 200,
      mean: 40,
      spread: 20,
      mad: frame === 0 ? null : 0.5,
      edges: 600,
      echo: Array.from({ length: 12 }, () => 5),
      ...edit(frame),
    }),
  );
}

const research = (campaign: Campaign): ResearchFacts => ({
  brand: { colors: { ...campaign.brand.colors } },
  claims: campaign.claims.map(({ id, quote, sourceUrl }) => ({ id, quote, sourceUrl })),
  accents: [],
});

describe('pixel measures', () => {
  it('measures brightness, spread and change from the frame before', () => {
    const dark = Buffer.alloc(12, 10);
    const lit = Buffer.from([10, 10, 10, 10, 10, 10, 250, 250, 250, 250, 250, 250]);
    expect(measureFrame(dark, undefined, 0)).toEqual({
      frame: 0,
      max: 10,
      mean: 10,
      spread: 0,
      mad: null,
    });
    const second = measureFrame(lit, dark, 1);
    expect(second).toMatchObject({ max: 250, mean: 130, mad: 120 });
    expect(second.spread).toBeCloseTo(120);
  });

  it('counts edge pixels: none on flat or graded ground, many on a shape', () => {
    const width = 40;
    const height = 20;
    const flat = Buffer.alloc(width * height * 3, 200);
    expect(edgePixels(flat, width)).toBe(0);
    const graded = Buffer.alloc(width * height * 3);
    for (let i = 0; i < graded.length; i += 1) graded[i] = 150 + Math.floor((i / 3) % width);
    expect(edgePixels(graded, width)).toBe(0);
    const shape = Buffer.from(flat);
    for (let y = 5; y < 15; y += 1)
      for (let x = 10; x < 20; x += 1) shape.fill(0, (y * width + x) * 3, (y * width + x) * 3 + 3);
    expect(edgePixels(shape, width)).toBeGreaterThan(20);
  });

  it('compares each frame with the frames before the one before it', () => {
    const scanner = new FrameScanner(8, 8);
    const a = Buffer.alloc(8 * 8 * 3, 10);
    const b = Buffer.alloc(8 * 8 * 3, 200);
    scanner.push(Buffer.concat([a, b, a]));
    const [first, second, third] = scanner.finish();
    expect(first?.echo).toEqual([]);
    expect(second?.echo).toEqual([]);
    expect(third?.echo).toEqual([0]);
    expect(third?.mad).toBe(190);
  });

  it('counts a static run in frames that look the same, from the frame before the first still one', () => {
    const stats = film(100, (frame) => (frame >= 41 && frame <= 70 ? { mad: 0.001 } : {}));
    expect(staticRuns(stats)).toEqual([{ from: 40, to: 70, length: 31 }]);
  });

  it('finds the ground patch nearest a colour', () => {
    const width = 200;
    const height = 100;
    const data = Buffer.alloc(width * height * 3, 255);
    for (let y = 0; y < 30; y += 1) {
      for (let x = 0; x < 30; x += 1) data.set([11, 16, 32], (y * width + x) * 3);
    }
    const nearest = nearestPatch({ width, height, data }, [11, 16, 32]);
    expect(nearest.distance).toBe(0);
    expect(rgbToHex(nearest.colour)).toBe('#0B1020');
  });

  it('writes a frame as minutes, seconds and frames', () => {
    expect(timecode(105, 30)).toBe('0:03.15');
    expect(timecode(1830, 30)).toBe('1:01.00');
  });
});

describe('frame checks', () => {
  const cut = example();

  it('passes a film that moves on every frame', () => {
    const { checks, issues } = checkFrames(film(600), cut);
    expect(issues).toEqual([]);
    expect(checks.map((check) => [check.id, check.result])).toEqual([
      ['black-frames', 'pass'],
      ['frame-0', 'pass'],
      ['blank-frames', 'pass'],
      ['flash-frames', 'pass'],
      ['static-runs', 'pass'],
    ]);
  });

  it('fails empty ground on frames the agent is never shown', () => {
    const { checks, issues } = checkFrames(
      film(600, (frame) => (frame >= 100 && frame <= 105 ? { edges: 0, max: 250 } : {})),
      cut,
    );
    expect(checks.find((check) => check.id === 'blank-frames')).toMatchObject({
      result: 'fail',
      frames: [100],
    });
    expect(issues).toEqual([
      expect.objectContaining({
        severity: 'major',
        check: 'blank-frames',
        owner: 'motion',
        frame: 100,
        sceneId: 'open',
      }),
    ]);
  });

  it('allows the blank frames of a t5 seam, and no more', () => {
    const t5 = example();
    const open = t5.scenes[0];
    if (open) open.transitionOut = 't5';
    const seam = sceneFrames(t5).scenes[1]?.from ?? 0;
    const blank = (last: number) =>
      checkFrames(
        film(600, (frame) => (frame >= seam && frame <= last ? { edges: 3 } : {})),
        t5,
      ).issues.map((issue) => issue.check);
    expect(blank(seam + 1)).toEqual([]);
    expect(blank(seam + 2)).toEqual(['blank-frames']);
  });

  it('fails a frame 0 that shows only graded ground', () => {
    const { issues } = checkFrames(
      film(600, (frame) => (frame === 0 ? { edges: 0, spread: 9.5, max: 56 } : {})),
      cut,
    );
    expect(issues).toEqual([
      expect.objectContaining({ check: 'frame-0', what: expect.stringContaining('only ground') }),
    ]);
  });

  it('leaves frame 0 to the frame-0 check', () => {
    const { issues } = checkFrames(
      film(600, (frame) => (frame <= 1 ? { edges: 0, spread: frame === 0 ? 0 : 20 } : {})),
      cut,
    );
    expect(issues.map((issue) => issue.check)).toEqual(['frame-0']);
  });

  it('fails a flash that jumps away and back between sampled frames', () => {
    const { issues } = checkFrames(
      // Frame 105 is 0.7 levels from frame 94, 11 frames back, which is echo index 9.
      film(600, (frame) => (frame === 95 || frame === 105 ? { mad: 28 } : {})).map((stat) =>
        stat.frame === 105
          ? { ...stat, echo: stat.echo?.map((value, index) => (index === 9 ? 0.7 : value)) }
          : stat,
      ),
      cut,
    );
    expect(issues).toEqual([
      expect.objectContaining({
        severity: 'major',
        check: 'flash-frames',
        owner: 'motion',
        frame: 95,
        what: expect.stringContaining('Frames 95-104 (10)'),
      }),
    ]);
  });

  it('does not take two jumps that do not come back for a flash', () => {
    const { issues } = checkFrames(
      film(600, (frame) =>
        frame === 95 || frame === 105
          ? { mad: 28, echo: Array.from({ length: 12 }, () => 25) }
          : {},
      ),
      cut,
    );
    expect(issues).toEqual([]);
  });

  it('fails black frames and names the scene and timecode they are in', () => {
    const { issues } = checkFrames(
      film(600, (frame) => (frame >= 330 && frame < 340 ? { max: 4 } : {})),
      cut,
    );
    expect(issues).toEqual([
      expect.objectContaining({
        severity: 'major',
        check: 'black-frames',
        owner: 'motion',
        frame: 330,
        sceneId: 'adoption',
        timecode: '0:11.00',
      }),
    ]);
  });

  it('fails a frozen stretch but allows the end card to hold', () => {
    const frozen = checkFrames(
      film(600, (frame) => (frame > 160 && frame <= 210 ? { mad: 0 } : {})),
      cut,
    );
    expect(frozen.issues).toEqual([
      expect.objectContaining({ check: 'static-runs', frame: 160, sceneId: 'speed' }),
    ]);
    const endHold = checkFrames(
      film(600, (frame) => (frame > 500 ? { mad: 0 } : {})),
      cut,
    );
    expect(endHold.issues).toEqual([]);
  });

  it('fails a black or flat frame 0', () => {
    const { issues } = checkFrames(
      film(600, (frame) => (frame === 0 ? { max: 0, spread: 0 } : {})),
      cut,
    );
    expect(issues.map((issue) => issue.check)).toEqual(['black-frames', 'frame-0']);
  });
});

describe('probe checks', () => {
  const cut = example();
  const good = {
    width: 1920,
    height: 1080,
    fps: 30,
    frames: 600,
    durationSeconds: 20,
    hasAudio: false,
    format: '16:9',
    muted: true,
    cut,
  };

  it('passes the size, rate and length the campaign asks for', () => {
    const { checks, issues } = checkProbe(good);
    expect(issues).toEqual([]);
    expect(checks.find((check) => check.id === 'audio-stream')?.result).toBe('n/a');
  });

  it('fails a wrong aspect ratio, a dropped chunk and a missing audio stream', () => {
    const { issues } = checkProbe({
      ...good,
      width: 1080,
      height: 1080,
      frames: 570,
      durationSeconds: 19,
      muted: false,
    });
    expect(issues.map((issue) => issue.check)).toEqual([
      'size',
      'frame-count',
      'duration',
      'audio-stream',
    ]);
    expect(issues[1]?.what).toContain('30 frames short');
  });
});

describe('integrity checks', () => {
  const base = {
    filmSha256: 'a'.repeat(64),
    manifestFilmSha256: 'a'.repeat(64),
    campaignSha256: 'b'.repeat(64),
    manifestCampaignSha256: 'b'.repeat(64),
    campaignFile: 'campaign.json',
    stills: [{ frame: 0, file: 'contact-00000.png', mad: 0.4 }],
    fps: 30,
  };

  it('passes the film and campaign the manifest records', () => {
    expect(checkIntegrity(base).issues).toEqual([]);
  });

  it('blocks a campaign edited after the render and stills from another film', () => {
    const { issues } = checkIntegrity({
      ...base,
      campaignSha256: 'c'.repeat(64),
      stills: [{ frame: 0, file: 'contact-00000.png', mad: 9 }],
    });
    expect(issues.map((issue) => [issue.check, issue.severity])).toEqual([
      ['campaign-hash', 'blocker'],
      ['stills-from-film', 'blocker'],
    ]);
  });

  it('blocks a render folder missing files its index names, and one with no stills to compare', () => {
    const { checks, issues } = checkIntegrity({
      ...base,
      stills: [],
      missing: ['/r/film.quality/transitions-sheet.png', '/r/film.quality/phone-sheet.png'],
    });
    expect(issues.map((issue) => [issue.check, issue.severity])).toEqual([
      ['stills-from-film', 'blocker'],
      ['artifacts', 'blocker'],
    ]);
    expect(checks.find((check) => check.id === 'artifacts')?.result).toBe('fail');
    expect(finalVerdict(issues, checks, null, true).blocked).toMatch(
      /not the complete render of this campaign \(stills-from-film, artifacts\)/,
    );
  });
});

describe('ground check', () => {
  it('fails a rest frame whose ground is not the brand background', () => {
    const { checks, issues } = checkGround(
      '#0B1020',
      [
        { frame: 80, sceneId: 'open', colour: [9, 15, 32], distance: 2 },
        { frame: 220, sceneId: 'speed', colour: [60, 15, 32], distance: 49 },
      ],
      30,
    );
    expect(checks[0]?.result).toBe('fail');
    expect(issues).toEqual([expect.objectContaining({ frame: 220, sceneId: 'speed' })]);
  });
});

describe('gate and claims', () => {
  it('fails copy that states a number no cited claim backs', async () => {
    const campaign = example();
    const close = campaign.scenes.at(-1);
    close?.text.push({
      id: 'close-proof',
      role: 'label',
      value: 'Trusted by 90,000 teams',
      claimIds: [],
    });
    const plain = await validateCampaign(campaign);
    const withRegistry = await validateCampaign(campaign, { sceneRegistry });
    const { checks, issues } = checkGate(plain, withRegistry, campaign, 30);
    expect(checks.find((check) => check.id === 'claims-cited')?.result).toBe('fail');
    expect(issues).toContainEqual(
      expect.objectContaining({
        severity: 'blocker',
        check: 'claims-cited',
        owner: 'director',
        sceneId: 'close',
      }),
    );
  });

  it('fails a cited superlative its quote only uses inside a compound', async () => {
    const campaign = example();
    campaign.claims.push({
      id: 'growth',
      text: 'The fastest-growing teams ship with Nova',
      sourceUrl: 'https://nova.example.com',
      quote: 'The fastest-growing teams ship with Nova every week.',
      status: 'approved',
    });
    const headline = campaign.scenes[3]?.text[0];
    if (headline) {
      headline.value = 'The fastest way to ship.';
      headline.claimIds = ['growth'];
    }
    const plain = await validateCampaign(campaign);
    const withRegistry = await validateCampaign(campaign, { sceneRegistry });
    expect(plain.ok).toBe(true);
    const { checks, issues } = checkGate(plain, withRegistry, campaign, 30);
    expect(checks.find((check) => check.id === 'claims-cited')?.result).toBe('fail');
    expect(issues).toContainEqual(
      expect.objectContaining({
        severity: 'blocker',
        check: 'claims-cited',
        owner: 'director',
        sceneId: 'close',
        what: expect.stringContaining('"fastest-growing"'),
      }),
    );
  });

  it('fails a customer name no cited quote names', async () => {
    const campaign = example();
    const headline = campaign.scenes[3]?.text[0];
    if (headline) headline.value = 'Ship like Stripe and Figma.';
    const plain = await validateCampaign(campaign);
    const withRegistry = await validateCampaign(campaign, { sceneRegistry });
    expect(plain.ok).toBe(true);
    const { checks, issues } = checkGate(plain, withRegistry, campaign, 30);
    expect(checks.find((check) => check.id === 'claims-cited')?.result).toBe('fail');
    expect(issues).toContainEqual(
      expect.objectContaining({
        severity: 'blocker',
        check: 'claims-cited',
        owner: 'director',
        sceneId: 'close',
        what: expect.stringContaining('"Stripe", "Figma"'),
      }),
    );
  });

  it('reports scene types outside the registry once, as a minor issue for motion', async () => {
    const campaign = example();
    // The example uses registry types only, so give one scene a type the registry lacks.
    const scene = campaign.scenes[1];
    if (!scene) throw new Error('the example has no second scene');
    scene.type = 'stat';
    const plain = await validateCampaign(campaign);
    const withRegistry = await validateCampaign(campaign, { sceneRegistry });
    const { checks, issues } = checkGate(plain, withRegistry, campaign, 30);
    expect(checks.find((check) => check.id === 'gate')?.result).toBe('pass');
    expect(checks.find((check) => check.id === 'scene-registry')?.result).toBe('n/a');
    expect(issues).toEqual([
      expect.objectContaining({ severity: 'minor', check: 'scene-registry', owner: 'motion' }),
    ]);
  });

  it('passes claims the research holds, despite spacing and a trailing slash', () => {
    const campaign = example();
    const facts = research(campaign);
    for (const claim of facts.claims) {
      claim.quote = claim.quote.replace(/ /g, '  ');
      claim.sourceUrl = claim.sourceUrl.endsWith('/') ? claim.sourceUrl : `${claim.sourceUrl}/`;
    }
    expect(checkResearchClaims(campaign, facts, 30).issues).toEqual([]);
  });

  it('blocks a claim the research does not hold, however well the copy cites it', () => {
    const campaign = example();
    const facts = research(campaign);
    campaign.claims.push({
      id: 'ship-speed',
      text: 'Teams ship twice as fast',
      sourceUrl: 'https://nova.example.com',
      quote: 'Teams ship 2x faster with Nova.',
      status: 'extracted',
    });
    const speed = campaign.scenes[1];
    if (!speed?.text[0]) throw new Error('example has no speed headline');
    speed.text[0] = {
      id: 'speed-headline',
      role: 'headline',
      value: 'Ship 2x faster',
      claimIds: ['ship-speed'],
    };
    const { checks, issues } = checkResearchClaims(campaign, facts, 30);
    expect(checks[0]?.result).toBe('fail');
    expect(issues).toEqual([
      expect.objectContaining({
        severity: 'blocker',
        owner: 'director',
        sceneId: 'speed',
        frame: 120,
        timecode: '0:04.00',
      }),
    ]);
  });

  it('marks claims and colours n/a without research', () => {
    const campaign = example();
    expect(checkResearchClaims(campaign, undefined, 30).checks[0]?.result).toBe('n/a');
    expect(checkResearchBrand(campaign, undefined, 30).checks[0]?.result).toBe('n/a');
  });
});

describe('research as evidence', () => {
  /** The stored page text the worked example's claims were captured from. */
  function bundle(): PagesBundle {
    const claims = exampleResearch().claims;
    const page = (url: string) => {
      const text = claims
        .filter((claim) => claim.sourceUrl === url)
        .map((claim) => claim.quote)
        .join(' ');
      return {
        url,
        final_url: url,
        origin: 'site' as const,
        file_id: null,
        status: 200,
        content_type: 'text/html',
        title: 'Fernhook',
        text: { rendered: text, dom: text, meta: '', clean: text, illustrative: '' },
      };
    };
    return {
      version: 1,
      site: 'https://fernhook.example.com',
      captured_at: '2026-11-07T00:00:00Z',
      pages: [...new Set(claims.map((claim) => claim.sourceUrl))].map(page),
    };
  }

  /** A Researcher folder: research.json, pages.json and a report.json naming its digest. */
  function folder(edit: { pages?: string; digest?: string } = {}) {
    const dir = mkdtempSync(join(tmpdir(), 'qc-research-'));
    const pages = edit.pages ?? JSON.stringify(bundle());
    writeFileSync(join(dir, 'research.json'), JSON.stringify(exampleResearch()));
    writeFileSync(join(dir, 'pages.json'), pages);
    const digest = edit.digest ?? createHash('sha256').update(pages).digest('hex');
    writeFileSync(join(dir, 'report.json'), JSON.stringify({ capture_digests: [digest] }));
    return dir;
  }

  it('reads a Researcher result tied to the pages its capture stored', () => {
    const { facts, pages } = readResearch(join(folder(), 'research.json'));
    expect(facts.claims.map((claim) => claim.id)).toEqual(
      exampleResearch().claims.map((c) => c.id),
    );
    expect(pages.find('https://fernhook.example.com')).toBeDefined();
  });

  it('refuses the campaign under review, or any file that is not a Researcher result', () => {
    const dir = folder();
    const campaign = join(dir, 'campaign.json');
    writeFileSync(campaign, JSON.stringify(workedExample()));
    expect(() => readResearch(campaign, campaign)).toThrow(/is the campaign under review/);
    expect(() => readResearch(campaign)).toThrow(/is not a Researcher result/);
  });

  it('refuses research without its stored pages, or with pages its capture did not report', () => {
    const dir = folder();
    const lonely = mkdtempSync(join(tmpdir(), 'qc-research-'));
    writeFileSync(join(lonely, 'research.json'), readFileSync(join(dir, 'research.json')));
    expect(() => readResearch(join(lonely, 'research.json'))).toThrow(/pages\.json is missing/);
    const edited = folder({ digest: 'f'.repeat(64) });
    expect(() => readResearch(join(edited, 'research.json'))).toThrow(
      /is not a bundle the capture .* reported/,
    );
  });

  it('blocks a claim whose quote is not in the stored text, even when research.json holds it', () => {
    const campaign = workedExample();
    const facts = {
      brand: { colors: { ...campaign.brand.colors } },
      claims: campaign.claims.map(({ id, quote, sourceUrl }) => ({ id, quote, sourceUrl })),
      accents: [],
    };
    const stored = bundle();
    const home = stored.pages.find((page) => page.url === 'https://fernhook.example.com');
    if (home)
      home.text = {
        ...home.text,
        rendered: 'Nothing here.',
        dom: 'Nothing here.',
        clean: 'Nothing here.',
      };
    const { checks, issues } = checkResearchClaims(campaign, facts, 30, new PageIndex(stored));
    expect(checks[0]?.result).toBe('fail');
    expect(issues).toEqual([
      expect.objectContaining({
        severity: 'blocker',
        check: 'claims-research',
        what: expect.stringContaining('is not in the stored text of its page'),
      }),
    ]);
    const clean = checkResearchClaims(campaign, facts, 30, new PageIndex(bundle()));
    expect(clean.checks[0]?.result).toBe('pass');
  });
});

describe('sheet frames', () => {
  it('takes one contact frame per second, from frame 0', () => {
    expect(contactFrames(example()).slice(0, 4)).toEqual([0, 30, 60, 90]);
    expect(contactFrames(example())).toHaveLength(20);
  });

  it('takes during from the cut, and before and after from the plan only when near the seam', () => {
    const cut = example();
    for (const scene of cut.scenes.slice(0, -1)) scene.transitionOut = 't1';
    const [first, second] = sceneFrames(cut)
      .scenes.slice(1)
      .map((scene) => scene.from);
    const index = {
      transitions: [
        {
          index: 0,
          name: 't1',
          boundary: first,
          from: 0,
          to: 0,
          files: {},
          stills: [
            { when: 'before', frame: (first ?? 0) - 8 },
            { when: 'after', frame: (first ?? 0) + 8 },
          ],
        },
        {
          index: 1,
          name: 't1',
          boundary: second,
          from: 0,
          to: 0,
          files: {},
          stills: [
            { when: 'before', frame: 2 },
            { when: 'after', frame: 599 },
          ],
        },
      ],
    } as unknown as Parameters<typeof transitionStills>[1];
    const [one, two] = transitionStills(cut, index, 600);
    expect(one?.stills).toEqual([
      { when: 'before', frame: (first ?? 0) - 8 },
      { when: 'during', frame: first },
      { when: 'after', frame: (first ?? 0) + 8 },
    ]);
    expect(two?.stills).toEqual([
      { when: 'before', frame: (second ?? 0) - 1 },
      { when: 'during', frame: second },
      { when: 'after', frame: (second ?? 0) + 1 },
    ]);
  });
});

describe('brand colours against the research', () => {
  it('passes measured colours, and black or white ink', () => {
    const campaign = example();
    const facts = research(campaign);
    campaign.brand.colors.foreground = '#FFFFFF';
    expect(checkResearchBrand(campaign, facts, 30).issues).toEqual([]);
  });

  it('fails a primary the Researcher never measured, and names the measured one', () => {
    const campaign = example();
    const facts = research(campaign);
    campaign.brand.colors.primary = '#FF3B30';
    const { checks, issues } = checkResearchBrand(campaign, facts, 30);
    expect(checks[0]?.result).toBe('fail');
    expect(issues).toEqual([
      expect.objectContaining({
        severity: 'major',
        owner: 'art-director',
        check: 'brand-research',
      }),
    ]);
    expect(issues[0]?.fix).toContain('#7C9CFF');
  });

  it('suggests a measured accent, not the nearest colour, for an accent it does not know', () => {
    const campaign = example();
    const facts = research(campaign);
    delete facts.brand.colors.accent;
    facts.accents = ['#7170FF'];
    campaign.brand.colors.accent = '#FF3B30';
    const [issue] = checkResearchBrand(campaign, facts, 30).issues;
    expect(issue).toMatchObject({ severity: 'minor', owner: 'art-director' });
    expect(issue?.fix).toContain('#7170FF');
  });
});

describe('the verdict', () => {
  const check = (result: 'pass' | 'fail') => ({
    id: 'x',
    result,
    measured: 'm',
    threshold: 't',
    frames: [],
    source: 'code' as const,
  });
  const run = (verdict: 'pass' | 'fail', viewed = true) => ({
    agentId: 'agt_1',
    agentVersion: 1,
    sessionId: 'ses_1',
    images: [{ fileId: 'fil_a', name: 'a.png', what: 'contact sheet', viewed }],
    review: { verdict, inspected: [], checks: [], issues: [], summary: 's' },
    problem: null,
    costMicroUsd: 1,
    sessions: [],
  });

  it('passes only when nothing failed and every image was opened', () => {
    expect(finalVerdict([], [check('pass')], run('pass'), true)).toEqual({
      verdict: 'pass',
      blocked: null,
    });
  });

  it('never passes without the model opening the frames', () => {
    expect(finalVerdict([], [check('pass')], null, false).blocked).toMatch(/no rendered frames/);
    expect(finalVerdict([], [check('pass')], run('pass', false), true)).toEqual({
      verdict: 'fail',
      blocked: 'the agent did not open a.png (fil_a)',
    });
  });

  it('fails when code fails, whatever the model says', () => {
    expect(finalVerdict([], [check('fail')], run('pass'), true).verdict).toBe('fail');
  });

  it('blocks a review whose claims were not traced to the research', () => {
    const untraced = { ...check('pass'), id: 'claims-research', result: 'n/a' as const };
    expect(finalVerdict([], [untraced], run('pass'), true).blocked).toBe(
      'claims and brand colours were not traced to the research',
    );
  });

  describe('model checks that pass without evidence', () => {
    const modelCheck = (measured: string, frames: number[]) => ({
      id: 'no-cross-dissolve',
      result: 'pass' as const,
      measured,
      threshold: 'see the quality-check skill',
      frames,
      source: 'model' as const,
    });
    const shown = new Set([0, 30, 119, 120, 121]);

    it('blocks a pass that says it could not check', () => {
      const said = modelCheck(
        'Seam frames were not supplied, so I judged from the contact sheet. I could not check S-1, S and S+1.',
        [120],
      );
      expect(finalVerdict([], [said], run('pass'), true, shown).blocked).toMatch(
        /passed checks without evidence .*no-cross-dissolve \(it says "Seam frames were not supplied/,
      );
    });

    it('blocks a pass that names no frame it was shown', () => {
      expect(finalVerdict([], [modelCheck('clean', [])], run('pass'), true, shown).blocked).toMatch(
        /no-cross-dissolve \(it names no frame\)/,
      );
      expect(
        finalVerdict([], [modelCheck('clean', [95])], run('pass'), true, shown).blocked,
      ).toMatch(/none of frames 95 is in an image it was given/);
    });

    it('accepts a pass that rests on frames it was shown, and words like "could not find"', () => {
      const fine = modelCheck(
        'I could not find any frame with both scenes at partial opacity.',
        [119, 120, 121],
      );
      expect(finalVerdict([], [fine], run('pass'), true, shown)).toEqual({
        verdict: 'pass',
        blocked: null,
      });
    });
  });
});

describe('view tracking', () => {
  it('counts an image only when view_image opened it', () => {
    const tracker = new ViewTracker();
    tracker.handle({
      type: 'tool.started',
      data: { tool_call_id: 't1', name: 'view_image', args: { file_ids: ['fil_a', 'fil_b'] } },
    });
    tracker.handle({
      type: 'tool.completed',
      data: {
        tool_call_id: 't1',
        name: 'view_image',
        output: '1 image(s), in order:\nfil_a — a.png',
        is_error: false,
      },
    });
    tracker.handle({
      type: 'tool.started',
      data: { tool_call_id: 't2', name: 'view_image', args: { file_ids: ['fil_c'] } },
    });
    tracker.handle({
      type: 'tool.completed',
      data: { tool_call_id: 't2', name: 'view_image', output: 'fil_c', is_error: true },
    });
    expect([...tracker.viewed]).toEqual(['fil_a']);
  });
});

describe('the review session', () => {
  it('stops a session whose event stream fails, keeps its cost, and deletes the images', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'qc-review-'));
    const file = join(dir, 'frame.png');
    writeFileSync(file, 'not really a png');
    const client = {
      skills: { push: vi.fn(async () => ({ version: 1 })) },
      agents: {
        list: vi.fn(async () => ({ data: [], has_more: false, next_cursor: null })),
        create: vi.fn(async () => ({ id: 'agt_qc', current_version: 1 })),
      },
      files: {
        upload: vi.fn(async () => ({ id: 'fil_frame' })),
        delete: vi.fn(async () => ({ deleted: true })),
      },
      sessions: {
        create: vi.fn(async () => ({ id: 'ses_qc' })),
        get: vi.fn(async () => ({
          status: 'running',
          stop_reason: null,
          consumed_micro_usd: 250_000,
        })),
        send: vi.fn(),
        interrupt: vi.fn(async () => ({})),
      },
      stream: vi.fn(() =>
        (async function* () {
          yield* [];
          throw new TypeError('fetch failed');
        })(),
      ),
    };
    const run = await runReview({
      client: client as unknown as Naive,
      definition: qualityCheck,
      images: [{ file, name: 'frame.png', what: 'a frame' }],
      folder: 'test',
      task: () => 'Review.',
      budgetMicroUsd: 1_000_000,
      eventsFile: join(dir, 'events.jsonl'),
      say: () => {},
      streamRetry: { retries: 1, delayMs: 0 },
    });
    expect(run).toMatchObject({
      sessionId: 'ses_qc',
      review: null,
      problem: 'the event stream failed: fetch failed',
      costMicroUsd: 250_000,
    });
    expect(client.sessions.interrupt).toHaveBeenCalledWith('ses_qc');
    expect(client.files.delete).toHaveBeenCalledWith('fil_frame');
  });

  const review = (verdict: 'pass' | 'fail', result: 'pass' | 'fail' | 'n/a', frames: number[]) => ({
    verdict,
    inspected: [{ file_id: 'fil_a', saw: 'a frame' }],
    checks: [{ id: 'frame-0', result, measured: `${result} here`, frames }],
    issues: [],
    summary: `${verdict}.`,
  });

  /** A review client whose sessions each run `turn(session)` as their one stream. */
  function reviewClient(
    turn: (session: number) => {
      events: Record<string, unknown>[];
      state: Record<string, unknown>;
    },
    images = 1,
  ) {
    let sessions = 0;
    let uploads = 0;
    const states = new Map<string, Record<string, unknown>>();
    const client = {
      skills: { push: vi.fn(async () => ({ version: 1 })) },
      agents: {
        list: vi.fn(async () => ({ data: [], has_more: false, next_cursor: null })),
        create: vi.fn(async () => ({ id: 'agt_qc', current_version: 1 })),
      },
      files: {
        upload: vi.fn(async () => {
          uploads += 1;
          return { id: `fil_${'abcdefgh'[uploads - 1]}` };
        }),
        delete: vi.fn(async () => ({ deleted: true })),
      },
      sessions: {
        create: vi.fn(async () => {
          sessions += 1;
          return { id: `ses_${sessions}` };
        }),
        get: vi.fn(async (id: string) => states.get(id) ?? {}),
        send: vi.fn(async () => ({ accepted_seq: 0 })),
        interrupt: vi.fn(async () => ({})),
        cancel: vi.fn(async (id: string) => ({ id, status: 'cancelled' })),
      },
      stream: vi.fn((id: string) => {
        const { events, state } = turn(Number(id.slice(4)));
        states.set(id, state);
        return (async function* () {
          for (const [index, event] of events.entries()) yield { seq: index + 1, ...event };
        })();
      }),
    };
    const dir = mkdtempSync(join(tmpdir(), 'qc-review-'));
    const files = Array.from({ length: images }, (_, index) => {
      const file = join(dir, `frame-${index}.png`);
      writeFileSync(file, 'not really a png');
      return { file, name: `frame-${index}.png`, what: `frame ${index}` };
    });
    const start = () =>
      runReview({
        client: client as unknown as Naive,
        definition: qualityCheck,
        images: files,
        folder: 'test',
        task: (shown) => `Review ${shown.map((image) => image.fileId).join(' ')}.`,
        budgetMicroUsd: 1_000_000,
        eventsFile: join(dir, 'events.jsonl'),
        say: () => {},
        streamRetry: { retries: 0, delayMs: 0 },
      });
    return { client, start };
  }

  /** A turn that views `ids` and submits `output`, which only the idle event carries. */
  const submitted = (ids: string[], output: unknown) => [
    {
      type: 'tool.started',
      data: { tool_call_id: 'v', name: 'view_image', args: { file_ids: ids } },
    },
    {
      type: 'tool.completed',
      data: { tool_call_id: 'v', name: 'view_image', output: ids.join(' ') },
    },
    { type: 'tool.started', data: { tool_call_id: 's', name: 'submit_output', args: output } },
    { type: 'tool.completed', data: { tool_call_id: 's', name: 'submit_output', is_error: false } },
    {
      type: 'session.usage',
      data: {
        token_usage: { input: 2, cache_write: 30, cache_read: 10, output: 5 },
        consumed_micro_usd: 160_000,
      },
    },
    { type: 'session.idle', data: { stop_reason: 'end_turn', structured_output: output } },
  ];

  it('takes the review from the idle event, not from a stale sessions.get', async () => {
    const fresh = review('pass', 'pass', [0]);
    const { start } = reviewClient(() => ({
      events: submitted(['fil_a'], fresh),
      state: {
        status: 'idle',
        stop_reason: 'end_turn',
        consumed_micro_usd: 160_000,
        structured_output: review('fail', 'fail', [9]),
      },
    }));
    const run = await start();
    expect(run.review).toEqual(fresh);
    expect(run.sessions).toEqual([
      expect.objectContaining({ session_id: 'ses_1', input_tokens: 42, budget_paused: false }),
    ]);
  });

  it('cancels a review paused on its budget and retries it in halves, merging both', async () => {
    const { client, start } = reviewClient(
      (session) =>
        session === 1
          ? {
              events: [{ type: 'session.idle', data: { stop_reason: 'budget_paused' } }],
              state: { status: 'idle', stop_reason: 'budget_paused', consumed_micro_usd: 900_000 },
            }
          : {
              events: submitted(
                session === 2 ? ['fil_a', 'fil_b'] : ['fil_c'],
                session === 2 ? review('pass', 'pass', [0]) : review('pass', 'n/a', [30]),
              ),
              state: { status: 'idle', stop_reason: 'end_turn', consumed_micro_usd: 100_000 },
            },
      3,
    );
    const run = await start();
    expect(client.sessions.cancel).toHaveBeenCalledWith('ses_1');
    expect(client.sessions.create).toHaveBeenCalledTimes(3);
    expect(run.sessions.map((each) => [each.session_id, each.images, each.budget_paused])).toEqual([
      ['ses_1', 3, true],
      ['ses_2', 2, false],
      ['ses_3', 1, false],
    ]);
    expect(run.images.every((image) => image.viewed)).toBe(true);
    expect(run.review?.checks).toEqual([
      { id: 'frame-0', result: 'pass', measured: 'pass here | n/a here', frames: [0, 30] },
    ]);
    expect(run.costMicroUsd).toBe(1_100_000);
    expect(client.files.delete).toHaveBeenCalledTimes(3);
  });
});

describe('mergeReviews', () => {
  it('fails a check either half fails, and fails the verdict either half fails', () => {
    const half = (verdict: 'pass' | 'fail', result: 'pass' | 'fail' | 'n/a') => ({
      verdict,
      inspected: [],
      checks: [{ id: 'c', result, measured: result, frames: [1] }],
      issues: [],
      summary: verdict,
    });
    expect(mergeReviews([half('pass', 'pass'), half('fail', 'fail')])).toMatchObject({
      verdict: 'fail',
      checks: [{ id: 'c', result: 'fail', frames: [1] }],
    });
    expect(mergeReviews([half('pass', 'n/a'), half('pass', 'n/a')]).checks[0]?.result).toBe('n/a');
  });
});

describe('render folders', () => {
  it('reads a moved render folder, mapping the paths the index names to the folder', () => {
    const dir = mkdtempSync(join(tmpdir(), 'qc-'));
    mkdirSync(join(dir, 'film.quality'));
    writeFileSync(join(dir, 'film.mp4'), '');
    writeFileSync(
      join(dir, 'film.manifest.json'),
      JSON.stringify({
        manifestVersion: 1,
        output: { file: '/elsewhere/film.mp4', sha256: 'a' },
        campaign: { id: 'nova-launch', file: '/elsewhere/nova.campaign.json', fileSha256: 'b' },
        settings: { format: '16:9', width: 1920, height: 1080, fps: 30, durationInFrames: 600 },
      }),
    );
    writeFileSync(
      join(dir, 'film.quality', 'index.json'),
      JSON.stringify({
        film: {
          file: '/elsewhere/film.mp4',
          width: 1920,
          height: 1080,
          fps: 30,
          durationInFrames: 600,
        },
        contactSheet: { file: '/elsewhere/film.quality/contact-sheet.png', frames: [] },
        transitionSheet: null,
        transitions: [],
        phoneSheet: { file: '/elsewhere/film.quality/phone-sheet.png', widthPx: 390, frames: [] },
      }),
    );
    const render = readRenderDir(dir);
    expect(render.artifact(render.index.contactSheet.file)).toBe(
      join(dir, 'film.quality', 'contact-sheet.png'),
    );
    expect(render.campaignPath('/elsewhere/nova.campaign.json')).toBe(
      join(dir, 'nova.campaign.json'),
    );
    expect(render.declared).toEqual([
      join(dir, 'film.quality', 'contact-sheet.png'),
      join(dir, 'film.quality', 'phone-sheet.png'),
    ]);
  });

  it('never resolves an artifact outside the quality folder, even when that file exists', () => {
    const dir = mkdtempSync(join(tmpdir(), 'qc-'));
    const outside = mkdtempSync(join(tmpdir(), 'qc-other-'));
    writeFileSync(join(outside, 'contact-sheet.png'), 'another film');
    mkdirSync(join(dir, 'film.quality'));
    writeFileSync(join(dir, 'film.mp4'), '');
    writeFileSync(
      join(dir, 'film.manifest.json'),
      JSON.stringify({
        manifestVersion: 1,
        output: { file: 'film.mp4', sha256: 'a' },
        campaign: { id: 'nova-launch', file: 'nova.campaign.json', fileSha256: 'b' },
        settings: {
          format: '16:9',
          width: 1920,
          height: 1080,
          fps: 30,
          durationInFrames: 600,
          framesPerChunk: 150,
        },
      }),
    );
    writeFileSync(
      join(dir, 'film.quality', 'index.json'),
      JSON.stringify({
        film: { file: 'film.mp4', width: 1920, height: 1080, fps: 30, durationInFrames: 600 },
        contactSheet: { file: join(outside, 'contact-sheet.png'), frames: [] },
        transitionSheet: { file: 'film.quality/../../escape.png' },
        transitions: [],
        phoneSheet: { file: 'phone-sheet.png', widthPx: 390, frames: [] },
      }),
    );
    const render = readRenderDir(dir);
    expect(render.artifact(render.index.contactSheet.file)).toBe(
      join(dir, 'film.quality', 'contact-sheet.png'),
    );
    expect(render.artifact('film.quality/../../escape.png')).toBe(
      join(dir, 'film.quality', 'escape.png'),
    );
    expect(render.manifest.settings.framesPerChunk).toBe(150);
  });

  it('cuts the film the way the render step does: hook first, CTA label everywhere', () => {
    const campaign = example();
    campaign.variants.hooks = [
      { ...(campaign.scenes[0] as Campaign['scenes'][number]), id: 'alt' },
    ];
    campaign.scenes[3]?.text.push({
      id: 'close-cta',
      role: 'cta',
      value: 'Start free',
      claimIds: [],
    });
    const cut = cutOf(campaign, 'alt', campaign.variants.ctas[1]?.id);
    expect(cut.scenes[0]?.id).toBe('alt');
    expect(cut.scenes[3]?.text.find((item) => item.role === 'cta')?.value).toBe(
      campaign.variants.ctas[1]?.label,
    );
  });
});

describe('the quality-check agent', () => {
  it('can only look at images and read its skill', () => {
    const allowed = Object.entries(qualityCheck.tools.configs)
      .filter(([, config]) => config.permission === 'allow')
      .map(([name]) => name)
      .sort();
    expect(allowed).toEqual(['read_skill', 'view_image']);
    for (const name of ['bash', 'publish_file', 'web_fetch', 'vetta.tools_execute']) {
      expect(qualityCheck.tools.configs[name], name).toEqual({
        enabled: false,
        permission: 'deny',
      });
    }
  });

  it('uses the company quality-check skill and a typed result on a Sonnet budget', () => {
    expect(qualityCheck.skills.map((skill) => skill.slug)).toEqual(['quality-check']);
    expect(skillContent(qualityCheck.skills[0] as never)).toMatch(/^---\nname: quality-check\n/);
    expect(qualityCheck.model).toBe('anthropic/claude-sonnet-5.5');
    expect(qualityCheck.session.budget_micro_usd).toBeGreaterThanOrEqual(1_000_000);
    expect(qualityCheck.output_schema).toBe(qcReviewJsonSchema);
    expect(qualityCheck.structured_output_required).toBe(true);
  });

  it('accepts a review with an issue owned by director, art-director or motion only', () => {
    const review = {
      verdict: 'fail',
      inspected: [{ file_id: 'fil_a', saw: 'contact sheet' }],
      checks: [
        {
          id: 'inside-frame',
          result: 'fail',
          measured: 'headline runs off the right edge',
          frames: [150],
        },
      ],
      issues: [
        {
          severity: 'major',
          check: 'inside-frame',
          sceneId: 'speed',
          frame: 150,
          timecode: '0:05.00',
          what: 'The headline runs off the right edge.',
          fix: 'Fit the headline to its box.',
          owner: 'motion',
        },
      ],
      summary: 'One overflow.',
    };
    expect(qcReviewSchema.safeParse(review).success).toBe(true);
    const researcherOwned = { ...review, issues: [{ ...review.issues[0], owner: 'researcher' }] };
    expect(qcReviewSchema.safeParse(researcherOwned).success).toBe(false);
  });

  it('gives the agent every image id and every visual check, with no approval steps', () => {
    const campaign = example();
    const task = reviewTask({
      campaign,
      format: '16:9',
      width: 1920,
      height: 1080,
      images: [
        { fileId: 'fil_a', name: 'contact.png', what: 'Contact sheet' },
        { fileId: 'fil_b', name: 'rest.png', what: 'Rest frame' },
      ],
      codeChecks: [],
      researchSupplied: false,
      budgetUsd: 1,
    });
    expect(task).toContain('["fil_a","fil_b"]');
    for (const check of VISUAL_CHECKS) expect(task).toContain(`- ${check.id} (`);
    expect(task).toContain('"40% faster builds" cites build-times');
    expect(task).not.toMatch(/approv|confirm with|ask the user/i);
  });

  // The skill was read in full before any image, then carried through every later model request.
  // The criteria each check needs are in the task now, and code results are one short line each.
  it('needs no skill read, and keeps each code result to one short line', () => {
    const task = reviewTask({
      campaign: example(),
      format: '16:9',
      width: 1920,
      height: 1080,
      images: [{ fileId: 'fil_a', name: 'contact.png', what: 'Contact sheet' }],
      codeChecks: [
        {
          id: 'static-runs',
          result: 'pass',
          measured: 'x'.repeat(2_000),
          threshold: 't',
          frames: [],
          source: 'code',
        },
      ],
      researchSupplied: true,
      budgetUsd: 1,
    });
    expect(task).not.toContain('read_skill quality-check');
    expect(task).toContain('78 px at 1080');
    const line = task.split('\n').find((each) => each.startsWith('- static-runs:'));
    expect(line?.length).toBeLessThanOrEqual(230);
    expect(task.length).toBeLessThan(9_000);
  });
});
