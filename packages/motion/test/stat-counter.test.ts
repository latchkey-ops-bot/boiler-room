import { describe, expect, it } from 'vitest';
import { filmSeams } from '../src/film/seams.ts';
import { validateFilm } from '../src/film/validate-film.ts';
import { validateForRender } from '../src/film/validate-render.ts';
import { FORMAT_SIZES, stageFor } from '../src/layout/stage.ts';
import {
  accentProblem,
  countUpText,
  fitNumber,
  headlineRuns,
  labelBoxOf,
  layoutProblems,
  type NumberFit,
  numberBox,
  popScale,
  stat,
  statCounter,
  type WidthOf,
} from '../src/scenes/stat-counter.tsx';
import fixture from './campaigns/stat-counter.campaign.json' with { type: 'json' };
import { at } from './fixtures.ts';

const stages = {
  '16:9': stageFor(1920, 1080),
  '9:16': stageFor(1080, 1920),
  '1:1': stageFor(1080, 1080),
};
/** A face whose every character is `share` of an em wide, so widths scale with size exactly. */
const evenFace =
  (share: number): WidthOf =>
  (text, fontSize) =>
    [...text].length * share * fontSize;
const metrics = { cap: 0.7 };
const frames = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, index) => from + index);
const fixtureCopy = () => structuredClone(fixture) as Parameters<typeof validateForRender>[0];

describe('stat-counter layout', () => {
  it('sets the number at the display cap height, 211 px, when it fits its box', () => {
    const fit = fitNumber('40%', stages['16:9'], metrics, evenFace(0.6));
    expect(fit.fontSize).toBe(Math.floor(211 / 0.7));
    expect(fit.cap).toBeCloseTo(0.7 * 301, 6);
    expect(fit.width).toBeLessThanOrEqual(fit.maxWidth);
  });

  it('makes a wide number smaller to fit 0.8 W, 0.86 W or 0.80 W, and never larger', () => {
    for (const [format, share] of [
      ['16:9', 0.8],
      ['9:16', 0.86],
      ['1:1', 0.8],
    ] as const) {
      const stage = stages[format];
      const fit = fitNumber('Under 90 s', stage, metrics, evenFace(0.6));
      expect(fit.maxWidth).toBeCloseTo(stage.width * share, 6);
      expect(fit.width).toBeLessThanOrEqual(fit.maxWidth);
      expect(fit.fontSize).toBeLessThan(301);
      expect(fit.fontSize + 1).toSatisfy((size: number) => size * 6 > fit.maxWidth);
    }
  });

  it('centres the cap box at 0.42 H, 0.40 H in a tall frame and 0.42 H in a square', () => {
    const centre = (format: keyof typeof stages) =>
      fitNumber('3x', stages[format], metrics, evenFace(0.6)).centreY;
    expect(centre('16:9')).toBeCloseTo(0.42 * 1080, 6);
    expect(centre('9:16')).toBeCloseTo(0.4 * 1920, 6);
    expect(centre('1:1')).toBeCloseTo(0.42 * 1080, 6);
  });

  it('puts the label in a 1248, 929 or 864 px box with its first baseline at 0.72, 0.56 or 0.74 H', () => {
    expect(labelBoxOf(stages['16:9'])).toEqual({ x: 336, width: 1248, baseline: 0.72 * 1080 });
    const tall = labelBoxOf(stages['9:16']);
    expect(Math.round(tall.width)).toBe(929);
    expect(tall.baseline).toBeCloseTo(0.56 * 1920, 6);
    expect(tall.x + tall.width / 2).toBeCloseTo(540, 6);
    expect(labelBoxOf(stages['1:1'])).toEqual({
      x: expect.closeTo(108, 6),
      width: expect.closeTo(864, 6),
      baseline: expect.closeTo(0.74 * 1080, 6),
    });
  });

  it('lays out every format from its size alone', () => {
    for (const [format, size] of Object.entries(FORMAT_SIZES)) {
      const stage = stageFor(size.width, size.height);
      expect(stage).toEqual(stages[format as keyof typeof stages]);
    }
  });
});

describe('stat-counter fit or fail', () => {
  const copy = {
    headline: { id: 'proof-number', value: 'Under 90 s' },
    label: { id: 'proof-label', value: 'A live preview per pull request' },
  };
  const label = { lines: ['A live preview', 'per pull request'], fontSize: 111, targetSize: 111.4 };
  const fits = (format: keyof typeof stages, share: number) => ({
    number: fitNumber(copy.headline.value, stages[format], metrics, evenFace(share)),
    label,
    labelBox: labelBoxOf(stages[format]),
  });

  it('passes a number at 0.13 W or more and a label at the sentence cap height', () => {
    expect(layoutProblems('proof', copy, fits('16:9', 0.6), stages['16:9'])).toEqual([]);
  });

  it('fails a number under 0.13 W, naming the scene and the text id', () => {
    // 10 characters a full em wide fit 1536 px only at 153 px, under 0.13 x 1920 = 250 px.
    const problems = layoutProblems('proof', copy, fits('16:9', 1), stages['16:9']);
    expect(problems).toEqual([
      'Scene "proof", text "proof-number": the number "Under 90 s" fits 1536 px only at 153 px, under 0.13 W (250 px at 1920x1080), so it would not read as a stat. Shorten the headline to the number and its unit.',
    ]);
  });

  it('measures the floor against the width of the frame it renders in', () => {
    // The same face that fails at 16:9 needs only 141 px at 9:16, where 0.13 W is 140.4 px.
    const tall = fitNumber('Under 90 s', stages['9:16'], metrics, evenFace(0.65));
    expect(tall.smallest).toBeCloseTo(140.4, 6);
    expect(layoutProblems('proof', copy, fits('9:16', 0.65), stages['9:16'])).toEqual([]);
    expect(layoutProblems('proof', copy, fits('9:16', 0.7), stages['9:16'])).toHaveLength(1);
  });

  it('fails a label that would have to be set below the sentence cap height', () => {
    const shrunk = { ...fits('1:1', 0.6), label: { ...label, fontSize: 96 } };
    expect(layoutProblems('proof', copy, shrunk, stages['1:1'])).toEqual([
      'Scene "proof", text "proof-label": the label "A live preview per pull request" does not fit 2 lines of 864 px at the sentence cap height (78 px) at 1080x1080. Shorten the label.',
    ]);
    const empty = { ...fits('1:1', 0.6), label: { ...label, lines: [] } };
    expect(layoutProblems('proof', copy, empty, stages['1:1'])).toHaveLength(1);
  });

  it('accepts the label at the whole size the fitter sets, the floor of its cap-height size', () => {
    const floored = { ...fits('16:9', 0.6), label: { ...label, fontSize: 111, targetSize: 111.9 } };
    expect(layoutProblems('proof', copy, floored, stages['16:9'])).toEqual([]);
  });

  it('accents only the number: the label stays in ink', () => {
    const scene = {
      id: 'proof',
      text: [
        { id: 'proof-number', role: 'headline' as const, value: '40%', claimIds: [] },
        { id: 'proof-label', role: 'label' as const, value: 'shorter builds', claimIds: [] },
      ],
    };
    expect(accentProblem(scene, undefined)).toBeUndefined();
    expect(accentProblem(scene, { textId: 'proof-number', from: 0, to: 1 })).toBeUndefined();
    expect(accentProblem(scene, { textId: 'proof-label', from: 0, to: 1 })).toBe(
      'Scene "proof": props.accent names text "proof-label", a label, but stat-counter draws its label in ink and only accents the number. Point props.accent.textId at the headline, or remove it.',
    );
  });
});

describe('stat-counter motion', () => {
  it('pops the number on its T3 entry from 1.26, by 0.3 a frame, and rests at exactly 1 from frame 6', () => {
    expect(popScale(0)).toBeCloseTo(1.26, 10);
    expect(popScale(1)).toBeCloseTo(1 + 0.26 * 0.3, 10);
    expect(popScale(5)).toBeCloseTo(1 + 0.26 * 0.3 ** 5, 10);
    for (const f of frames(6, 95)) expect(popScale(f)).toBe(1);
  });

  it('never overshoots: the pop only shrinks towards rest', () => {
    const values = frames(0, 20).map(popScale);
    for (const [index, value] of values.entries()) {
      expect(value).toBeGreaterThanOrEqual(1);
      if (index > 0) expect(value).toBeLessThanOrEqual(values[index - 1] as number);
    }
  });

  it('keeps the number box on one fixed centre, the T5 headline slot, as it drifts larger', () => {
    for (const [format, centreY] of [
      ['16:9', 0.42 * 1080],
      ['9:16', 0.4 * 1920],
      ['1:1', 0.42 * 1080],
    ] as const) {
      const stage = stages[format];
      const fit: NumberFit = fitNumber('40%', stage, metrics, evenFace(0.6));
      const rest = numberBox(fit, 0);
      expect(rest.height).toBeCloseTo(fit.cap, 6);
      for (const f of [0, 6, 41, 95]) {
        const box = numberBox(fit, f);
        expect(box.x + box.width / 2).toBeCloseTo(stage.width / 2, 6);
        expect(box.y + box.height / 2).toBeCloseTo(centreY, 6);
        expect(box.width).toBeCloseTo(rest.width * (1 + 0.0013 * f), 6);
      }
    }
  });

  it('is a pure function of the frame, whatever order the frames are asked in', () => {
    const stage = stages['9:16'];
    const fit = fitNumber('1,200+', stage, metrics, evenFace(0.6));
    const value = (f: number) => [popScale(f), numberBox(fit, f), countUpText('$29', f)];
    const inOrder = frames(-5, 100).map(value);
    const backwards = frames(-5, 100).reverse().map(value).reverse();
    expect(backwards).toEqual(inOrder);
  });

  it('draws the headline exactly as written, word by word for the accent', () => {
    const runs = headlineRuns('Under 90 s');
    expect(runs.map(({ text }) => text).join('')).toBe('Under 90 s');
    expect(runs.filter(({ word }) => word !== undefined).map(({ word }) => word)).toEqual([
      0, 1, 2,
    ]);
    expect(new Set(runs.map(({ at }) => at)).size).toBe(runs.length);
    const padded = headlineRuns(' 40% ');
    expect(padded.map(({ text }) => text).join('')).toBe(' 40% ');
    expect(new Set(padded.map(({ at }) => at)).size).toBe(padded.length);
  });
});

describe('stat-counter count-up, built for when the founder approves it', () => {
  it('shows 0 with the prefix and unit until frame 6, and exactly the written value from frame 41', () => {
    for (const f of frames(0, 5)) {
      expect(countUpText('$29', f)).toBe('$0');
      expect(countUpText('Under 90 s', f)).toBe('Under 0 s');
      expect(countUpText('2.5x', f)).toBe('0.0x');
    }
    for (const f of frames(41, 95)) {
      expect(countUpText('1,200+', f)).toBe('1,200+');
      expect(countUpText('2.5x', f)).toBe('2.5x');
    }
    expect(countUpText('1,200+', 40)).not.toBe('1,200+');
  });

  it('only rises, keeps the grouping and decimals, and shows no digits but the count', () => {
    let previous = -1;
    for (const f of frames(0, 95)) {
      const text = countUpText('1,200+', f);
      expect(text).toMatch(/^(\d{1,3}(,\d{3})*)\+$/);
      const value = Number(text.slice(0, -1).replaceAll(',', ''));
      expect(value).toBeGreaterThanOrEqual(previous);
      expect(value).toBeLessThanOrEqual(1200);
      previous = value;
    }
    expect(countUpText('2.5x', 20)).toMatch(/^\d\.\dx$/);
  });

  it('leaves a headline with no number as written', () => {
    expect(countUpText('Free', 10)).toBe('Free');
  });
});

describe('stat-counter in a campaign', () => {
  it('declares the props, roles and image its scene file gives', () => {
    expect(statCounter.roles).toEqual({ headline: { min: 1, max: 1 }, label: { min: 1, max: 1 } });
    expect(statCounter.image).toBe('none');
    expect(statCounter.maxImages).toBe(0);
    expect(statCounter.holdFrom).toBeUndefined();
    expect(statCounter.props.safeParse({}).success).toBe(true);
    expect(statCounter.props.safeParse({ countUp: false }).success).toBe(true);
    expect(
      statCounter.props.safeParse({ accent: { textId: 'proof-number', from: 0, to: 1 } }).success,
    ).toBe(true);
    expect(statCounter.props.safeParse({ countUp: 'yes' }).success).toBe(false);
    expect(statCounter.props.safeParse({ label: '40%' }).success).toBe(false);
  });

  it('refuses a count-up until the founder approves count-ups', async () => {
    const campaign = fixtureCopy() as { scenes: { props: Record<string, unknown> }[] };
    at(campaign.scenes, 1).props.countUp = true;
    const written = await validateForRender(campaign);
    if (!written.ok) throw new Error('the fixture no longer validates');
    const errors = validateFilm(written.campaign, '16:9').filter(
      ({ severity }) => severity === 'error',
    );
    expect(errors).toEqual([
      expect.objectContaining({
        code: 'PROPS_INVALID',
        path: 'scenes[1].props.countUp',
        message: expect.stringContaining('count-ups wait for the founder'),
      }),
    ]);
  });

  it('passes the example campaign in every format, with every seam played as written', async () => {
    const written = await validateForRender(fixtureCopy());
    expect(written.issues).toEqual([]);
    if (!written.ok) return;
    for (const format of ['16:9', '9:16', '1:1'] as const) {
      expect(validateFilm(written.campaign, format)).toEqual([]);
    }
    expect(
      filmSeams(written.campaign).map(({ from, to, used, reason, carry, blank }) => ({
        seam: `${from} > ${to}`,
        used,
        reason,
        carry,
        blank,
      })),
    ).toEqual([
      { seam: 'open > cut', used: 't3', reason: 'written', carry: undefined, blank: 0 },
      { seam: 'cut > teams', used: 't5', reason: 'written', carry: undefined, blank: 2 },
      { seam: 'teams > deploys', used: 't1', reason: 'written', carry: 'number', blank: 0 },
      { seam: 'deploys > speed', used: 't1', reason: 'written', carry: undefined, blank: 0 },
      { seam: 'speed > again', used: 't1', reason: 'written', carry: undefined, blank: 0 },
      { seam: 'again > close', used: 't3', reason: 'written', carry: undefined, blank: 0 },
    ]);
  });

  it('renders numbers only from scene.text: every number its scenes show is in a cited quote', async () => {
    const written = await validateForRender(fixtureCopy());
    if (!written.ok) throw new Error('the fixture no longer validates');
    const { scenes, claims } = written.campaign;
    for (const scene of scenes.filter(({ type }) => type === 'stat-counter')) {
      const number = scene.text.find(({ role }) => role === 'headline');
      const cited = claims.filter(({ id }) => number?.claimIds.includes(id));
      const digits = number?.value.match(/\d[\d,.]*/)?.[0] ?? '';
      expect(cited.some(({ quote }) => quote.includes(digits))).toBe(true);
      expect(Object.values(scene.props).every((value) => typeof value !== 'string')).toBe(true);
    }
    expect(stat.countFrom + 35).toBe(41);
  });
});
