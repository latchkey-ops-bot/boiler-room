/**
 * One Quality Check: read the render folder, measure the film in code, have `br-quality-check` open
 * frames taken from it, and merge both into one report. The verdict is decided here, not by the
 * model: a review passes only when code found nothing, the agent found nothing, and the agent
 * opened every image it was given.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import {
  type Campaign,
  campaignSchema,
  sceneFrames,
  sceneRegistry,
  validateCampaign,
} from '@boiler-room/schema';
import { z } from 'zod';
import type { AgentDefinition } from '../define.ts';
import { qualityCheck } from '../definitions/quality-check.ts';
import { type Naive, naiveClient, scrub, usd } from '../naive/client.ts';
import { researchOutputSchema } from '../researcher/output.ts';
import { PageIndex, pagesBundleSchema } from '../researcher/verify.ts';
import type { AgentSync } from '../sync.ts';
import {
  checkFrames,
  checkGate,
  checkGround,
  checkIntegrity,
  checkProbe,
  checkResearchBrand,
  checkResearchClaims,
  type Findings,
  frameOutliers,
  GROUND_UNSAMPLED,
  type GroundSample,
  INTEGRITY_CHECKS,
  merge,
  type ResearchFacts,
  sceneAt,
  timecode,
  type UnsampledRest,
} from './checks.ts';
import { hexToRgb, meanAbsoluteDifference, nearestPatch } from './measure.ts';
import { extractFrames, probeFilm, readRgb, scanFrames, sha256File } from './media.ts';
import type { QcCheck, QcIssue, QcReport } from './output.ts';
import { reviewTask } from './prompt.ts';
import { cutOf, type RenderDir, readRenderDir } from './render-dir.ts';
import { type LocalImage, type ReviewRun, runReview } from './review.ts';
import { buildSheets } from './sheets.ts';

export interface QcOptions {
  renderDir: string;
  /** Overrides the campaign the manifest names. Its hash must still match the render's. */
  campaignFile?: string;
  /**
   * The Researcher's `research.json`, with the `pages.json` and `report.json` of the same run
   * beside it. Claims are traced to it and to the stored page text, and brand colours to it.
   */
  researchFile: string;
  /** False runs code checks only. Such a review is blocked, since no one looked at the frames. */
  model: boolean;
  budgetUsd?: number;
  definition?: AgentDefinition;
  say?: (line: string) => void;
  /** The Naive client to use. `pnpm film` passes one that holds the film's spend cap. */
  client?: Naive;
  /** `verify` never creates or changes the agent: it checks the deployed one matches. */
  agentSync?: AgentSync;
}

const SEVERITY_ORDER = { blocker: 0, major: 1, minor: 2 } as const;

const reportSchema = z.looseObject({ capture_digests: z.array(z.string()) });

export interface ResearchEvidence {
  facts: ResearchFacts;
  /** The page text the Researcher's capture stored, which its gate verified quotes against. */
  pages: PageIndex;
}

/**
 * Reads a Researcher result and ties it to its run. The file must parse as `researchOutputSchema`
 * (a campaign does not), must not be the campaign under review, and must have beside it the
 * `pages.json` its capture stored and the `report.json` whose `capture_digests` name that
 * bundle's SHA-256. Throws, as an input error, on anything else.
 */
export function readResearch(file: string, campaignFile?: string): ResearchEvidence {
  if (campaignFile && resolve(file) === resolve(campaignFile)) {
    throw new Error(`${file} is the campaign under review, not a Researcher result.`);
  }
  const parsed = researchOutputSchema.safeParse(JSON.parse(readFileSync(file, 'utf8')));
  if (!parsed.success) {
    const first = parsed.error.issues
      .slice(0, 3)
      .map((issue) => `${issue.path.join('.') || '$'}: ${issue.message}`)
      .join('; ');
    throw new Error(`${file} is not a Researcher result (${first}).`);
  }
  const folder = dirname(file);
  const pagesFile = join(folder, 'pages.json');
  const reportFile = join(folder, 'report.json');
  for (const needed of [pagesFile, reportFile]) {
    if (!existsSync(needed)) {
      throw new Error(
        `${needed} is missing. Claims are traced to the page text the Researcher stored, so research.json needs the pages.json and report.json of its run beside it.`,
      );
    }
  }
  const bundle = readFileSync(pagesFile);
  const digest = createHash('sha256').update(bundle).digest('hex');
  const report = reportSchema.safeParse(JSON.parse(readFileSync(reportFile, 'utf8')));
  if (!report.success || !report.data.capture_digests.includes(digest)) {
    throw new Error(
      `${pagesFile} (sha256 ${digest.slice(0, 12)}...) is not a bundle the capture in ${reportFile} reported. It was changed after the capture, or it is from another run.`,
    );
  }
  const research = parsed.data;
  return {
    facts: {
      brand: { colors: research.brand.colors },
      claims: research.claims,
      accents: research.brand_details.accents,
      measured: research.brand_details.measured.map(({ hex, seen_as }) => ({ hex, seen_as })),
    },
    pages: new PageIndex(pagesBundleSchema.parse(JSON.parse(bundle.toString('utf8')))),
  };
}

/** Contact and transition stills the render service wrote, to compare with the film. */
function stillsToCompare(render: RenderDir): { frame: number; file: string }[] {
  const contact = render.index.contactSheet.frames;
  const picks = [contact[0], contact[Math.floor(contact.length / 2)], contact.at(-1)].flatMap(
    (entry) =>
      entry
        ? [
            {
              frame: entry.frame,
              file: join(
                render.qualityDir,
                'frames',
                `contact-${String(entry.frame).padStart(5, '0')}.png`,
              ),
            },
          ]
        : [],
  );
  const transition = render.index.transitions[0];
  const during = transition?.stills.find((still) => still.when === 'during');
  const duringFile = transition?.files.during;
  if (during && duringFile) picks.push({ frame: during.frame, file: render.artifact(duringFile) });
  // A missing still is reported by the artifacts check; it is not compared.
  return picks.filter((pick) => existsSync(pick.file));
}

async function compareStills(
  render: RenderDir,
  work: string,
): Promise<{ frame: number; file: string; mad: number }[]> {
  const results: { frame: number; file: string; mad: number }[] = [];
  for (const [index, still] of stillsToCompare(render).entries()) {
    const image = await readRgb(still.file);
    const width = image.width === render.manifest.settings.width ? undefined : image.width;
    const extracted = await extractFrames(render.film, [still.frame], work, `still${index}`, width);
    const own = await readRgb(extracted.get(still.frame) as string);
    const mad =
      own.data.length === image.data.length
        ? meanAbsoluteDifference(own.data, image.data)
        : Number.POSITIVE_INFINITY;
    results.push({ frame: still.frame, file: still.file, mad });
  }
  return results;
}

/** Each scene's rest frame, two thirds through, where its copy has landed and its exit has not begun. */
function restFrames(cut: Campaign): { sceneId: string; frame: number }[] {
  return sceneFrames(cut).scenes.map((scene) => ({
    sceneId: scene.id,
    frame: scene.from + Math.floor((scene.durationInFrames * 2) / 3),
  }));
}

/** A model's measured text that says the check could not be made. */
const UNCHECKED =
  /\b(?:could not|couldn't|cannot|can't|unable to|was not able to|were not able to)\s+(?:be\s+)?(?:check|verify|confirm|judge|inspect|see|assess|measure|tell)|\b(?:were|was)\s+not\s+(?:supplied|provided|given|shown|available|included)\b|\bnot\s+(?:supplied|provided)\b/i;

/**
 * Model checks that pass without evidence: the agent says it could not make the check, or it
 * names no frame that any image it was given shows. Such a check must be n/a or fail.
 */
export function unsupportedPasses(
  checks: readonly QcCheck[],
  shownFrames: ReadonlySet<number>,
): { id: string; why: string }[] {
  return checks
    .filter((check) => check.source === 'model' && check.result === 'pass')
    .flatMap((check) => {
      if (UNCHECKED.test(check.measured))
        return [{ id: check.id, why: `it says "${check.measured.slice(0, 120)}"` }];
      if (!check.frames.some((frame) => shownFrames.has(frame)))
        return [
          {
            id: check.id,
            why: check.frames.length
              ? `none of frames ${check.frames.join(', ')} is in an image it was given`
              : 'it names no frame',
          },
        ];
      return [];
    });
}

export function finalVerdict(
  issues: readonly QcIssue[],
  checks: readonly QcCheck[],
  run: ReviewRun | null,
  modelRequested: boolean,
  shownFrames: ReadonlySet<number> = new Set(),
): { verdict: 'pass' | 'fail'; blocked: string | null } {
  const integrity = issues.filter(
    (issue) => issue.source === 'code' && INTEGRITY_CHECKS.includes(issue.check),
  );
  let blocked: string | null = null;
  const untraced = checks.some(
    (check) =>
      check.source === 'code' &&
      ['claims-research', 'brand-research'].includes(check.id) &&
      check.result === 'n/a',
  );
  if (integrity.length) {
    blocked = `the film under review is not the complete render of this campaign (${[...new Set(integrity.map((issue) => issue.check))].join(', ')})`;
  } else if (!modelRequested) {
    blocked = 'no rendered frames were inspected (--no-model); code checks alone never pass a film';
  } else if (!run?.review) {
    blocked = `no review from the agent: ${run?.problem ?? 'it did not run'}`;
  } else if (untraced) {
    blocked = 'claims and brand colours were not traced to the research';
  } else {
    const unopened = run.images.filter((image) => !image.viewed);
    const unsupported = unsupportedPasses(checks, shownFrames);
    if (unopened.length) {
      blocked = `the agent did not open ${unopened.map((image) => `${image.name} (${image.fileId})`).join(', ')}`;
    } else if (unsupported.length) {
      blocked = `the agent passed checks without evidence from the frames it was given: ${unsupported.map((each) => `${each.id} (${each.why})`).join('; ')}`;
    }
  }
  const failed =
    issues.some((issue) => issue.severity !== 'minor') ||
    checks.some((check) => check.result === 'fail') ||
    run?.review?.verdict !== 'pass';
  return { verdict: blocked || failed ? 'fail' : 'pass', blocked };
}

export async function qualityCheckRender(options: QcOptions): Promise<QcReport> {
  const say = options.say ?? ((line: string) => console.log(scrub(line)));
  const definition = options.definition ?? qualityCheck;
  const render = readRenderDir(options.renderDir);
  const { manifest } = render;
  const work = join(render.dir, `${manifest.campaign.id}.qc`);
  mkdirSync(work, { recursive: true });

  const campaignFile = options.campaignFile ?? render.campaignPath(manifest.campaign.file);
  const campaignBytes = readFileSync(campaignFile);
  const raw: unknown = JSON.parse(campaignBytes.toString('utf8'));
  const parsed = campaignSchema.safeParse(raw);
  const research = readResearch(options.researchFile, campaignFile);

  say(`measuring ${render.film}`);
  const [film, filmSha256, campaignSha256, stats, plain, withRegistry] = await Promise.all([
    probeFilm(render.film),
    sha256File(render.film),
    sha256File(campaignFile),
    scanFrames(render.film),
    validateCampaign(raw),
    validateCampaign(raw, { sceneRegistry }),
  ]);
  const fps = parsed.success ? parsed.data.fps : manifest.settings.fps;
  const stills = await compareStills(render, work);
  const missing = render.declared.filter((file) => !existsSync(file));

  const parts: Findings[] = [
    checkIntegrity({
      filmSha256,
      manifestFilmSha256: manifest.output.sha256,
      campaignSha256,
      manifestCampaignSha256: manifest.campaign.fileSha256,
      campaignFile,
      stills,
      missing,
      fps,
    }),
  ];
  let cut: Campaign | undefined;
  let rests: { sceneId: string; frame: number }[] = [];
  const images: LocalImage[] = [];
  if (!parsed.success) {
    parts.push(checkGate(plain, withRegistry, undefined, fps));
  } else {
    cut = cutOf(parsed.data, manifest.settings.hookId, manifest.settings.ctaId);
    parts.push(
      checkGate(plain, withRegistry, parsed.data, fps),
      checkProbe({
        width: film.width,
        height: film.height,
        fps: film.fps,
        frames: film.frames,
        durationSeconds: film.durationSeconds,
        hasAudio: film.hasAudio,
        format: manifest.settings.format,
        muted: manifest.settings.muted ?? false,
        cut,
      }),
      checkFrames(stats, cut),
      checkResearchClaims(cut, research.facts, fps, research.pages),
      checkResearchBrand(cut, research.facts, fps),
    );

    rests = restFrames(cut).filter((rest) => rest.frame < film.frames);
    const extracted = await extractFrames(
      render.film,
      rests.map((rest) => rest.frame),
      work,
      'rest',
    );
    const background = hexToRgb(cut.brand.colors.background);
    const ground: GroundSample[] = [];
    const unsampled: UnsampledRest[] = [];
    const typeOf = new Map(cut.scenes.map((scene) => [scene.id, scene.type]));
    for (const rest of rests) {
      const file = extracted.get(rest.frame);
      if (!file) continue;
      const type = typeOf.get(rest.sceneId) ?? '';
      if (Object.hasOwn(GROUND_UNSAMPLED, type)) {
        unsampled.push({ frame: rest.frame, sceneId: rest.sceneId, type });
      } else {
        const nearest = nearestPatch(await readRgb(file), background);
        ground.push({
          frame: rest.frame,
          sceneId: rest.sceneId,
          colour: nearest.colour,
          distance: nearest.distance,
        });
      }
      images.push({
        file,
        name: `${manifest.campaign.id}-rest-${rest.sceneId}-${rest.frame}.png`,
        what: `Full-size frame ${rest.frame} (${timecode(rest.frame, fps)}), scene ${rest.sceneId} two thirds through: its copy has landed and its exit has not begun.`,
        frames: [rest.frame],
      });
    }
    parts.push(checkGround(cut.brand.colors.background, ground, fps, unsampled));
  }

  const code = merge(...parts);
  const scheme = parsed.success
    ? null
    : parsed.error.issues
        .slice(0, 5)
        .map((issue) => issue.message)
        .join('; ');
  if (scheme) {
    code.issues.push({
      severity: 'blocker',
      check: 'gate',
      sceneId: null,
      frame: null,
      timecode: null,
      what: `The campaign does not parse: ${scheme}`,
      fix: 'Fix the campaign so validateCampaign accepts it, render it, then review that render.',
      owner: 'director',
      source: 'code',
    });
  }

  let run: ReviewRun | null = null;
  const blockedEarly = !cut || code.issues.some((issue) => INTEGRITY_CHECKS.includes(issue.check));
  if (options.model && cut && !blockedEarly) {
    const campaign = cut;
    // Every sheet the agent opens is built here from frames decoded from the film, never taken
    // from the render folder, so no picture from another render can stand in for this film.
    say('building the sheets from the film');
    const sheets = await buildSheets({
      film: render.film,
      size: film,
      cut,
      campaignId: manifest.campaign.id,
      index: render.index,
      rests,
      framesPerChunk: manifest.settings.framesPerChunk,
      outliers: frameOutliers(stats, cut),
      work,
    });
    images.unshift(...sheets);
    const budgetMicro = Math.round(
      (options.budgetUsd ?? definition.session.budget_micro_usd / 1e6) * 1e6,
    );
    const client = options.client ?? naiveClient();
    run = await runReview({
      client,
      definition,
      images,
      folder: `Boiler Room QC ${manifest.campaign.id}`,
      task: (uploaded) =>
        reviewTask({
          campaign,
          format: manifest.settings.format,
          width: film.width,
          height: film.height,
          images: uploaded,
          codeChecks: code.checks,
          researchSupplied: true,
          budgetUsd: budgetMicro / 1e6,
        }),
      budgetMicroUsd: budgetMicro,
      eventsFile: join(work, 'events.jsonl'),
      say,
      ...(options.agentSync ? { agentSync: options.agentSync } : {}),
    });
    say(
      `review cost ${usd(run.costMicroUsd)}, ${run.sessions.map((each) => `${each.input_tokens} input tokens`).join(' + ')}`,
    );
  } else if (options.model) {
    say('not starting a review: the film is not a valid render of this campaign');
  }

  const modelChecks: QcCheck[] = (run?.review?.checks ?? []).map((check) => ({
    ...check,
    threshold: 'see the quality-check skill',
    source: 'model',
  }));
  const frames = cut ? sceneFrames(cut) : undefined;
  const modelIssues: QcIssue[] = (run?.review?.issues ?? []).map((issue) => ({
    ...issue,
    sceneId:
      issue.sceneId ?? (frames && issue.frame !== null ? sceneAt(frames, issue.frame) : null),
    // The frame is what the agent read off a labelled still; the timecode is worked out from it,
    // because the agent's own arithmetic was wrong in the drill (F80 written as 0:02.80).
    timecode: issue.frame === null ? issue.timecode : timecode(issue.frame, fps),
    source: 'model',
  }));
  // Measured against every image planned for the agent, not only those that were uploaded.
  const opened = run
    ? images.filter((image) => run?.images.some((each) => each.name === image.name && each.viewed))
        .length
    : 0;
  const inspected: QcCheck[] = run
    ? [
        {
          id: 'frames-inspected',
          result: opened === images.length && images.length > 0 ? 'pass' : 'fail',
          measured: `${opened} of ${images.length} images taken from the film opened with view_image`,
          threshold: 'every image taken from the film is opened',
          frames: [],
          source: 'code',
        },
      ]
    : [];
  const checks = [...code.checks, ...inspected, ...modelChecks];
  const issues = [...code.issues, ...modelIssues].sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      (a.frame ?? Number.MAX_SAFE_INTEGER) - (b.frame ?? Number.MAX_SAFE_INTEGER),
  );
  // A pass rests only on frames of images the review's session was shown, by its own events.
  const { verdict, blocked } = finalVerdict(
    issues,
    checks,
    run,
    options.model,
    new Set(
      images
        .filter((image) => run?.images.some((each) => each.name === image.name && each.viewed))
        .flatMap((image) => image.frames ?? []),
    ),
  );

  const report: QcReport = {
    verdict,
    blocked,
    renderDir: render.dir,
    campaignId: manifest.campaign.id,
    render: {
      file: render.film,
      sha256: filmSha256,
      width: film.width,
      height: film.height,
      fps: film.fps,
      frames: film.frames,
      format: manifest.settings.format,
    },
    campaignFile,
    researchFile: options.researchFile,
    checks,
    issues,
    review: run
      ? {
          agent: definition.name,
          agentVersion: run.agentVersion,
          sessionId: run.sessionId,
          model: definition.model,
          costMicroUsd: run.costMicroUsd,
          images: run.images.map((image) => ({
            fileId: image.fileId,
            name: image.name,
            what: image.what,
            viewed: image.viewed,
          })),
          modelVerdict: run.review?.verdict ?? null,
          summary: run.review?.summary ?? run.problem,
          sessions: run.sessions,
          askedAgain: run.askedAgain,
          notReviewed: run.unreviewed,
        }
      : null,
    createdAt: new Date().toISOString(),
  };
  writeFileSync(join(work, 'qc-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  if (run?.review) {
    writeFileSync(join(work, 'review.json'), `${JSON.stringify(run.review, null, 2)}\n`);
  }
  return report;
}

/** The report as plain text, for a person reading the terminal. */
export function formatReport(report: QcReport): string {
  const lines = [
    `QUALITY CHECK  ${report.campaignId}  ${report.verdict.toUpperCase()}${report.blocked ? ' (blocked)' : ''}`,
    `film     ${report.render.file}`,
    `         ${report.render.width} x ${report.render.height}, ${report.render.fps} fps, ${report.render.frames} frames, ${report.render.format ?? '?'}, sha256 ${report.render.sha256.slice(0, 16)}…`,
    `campaign ${report.campaignFile}`,
    `research ${report.researchFile ?? 'none supplied'}`,
  ];
  if (report.blocked) lines.push(`blocked  ${report.blocked}`);
  if (report.review) {
    lines.push(
      `review   ${report.review.agent} v${report.review.agentVersion} (${report.review.model}), session ${report.review.sessionId}, ${usd(report.review.costMicroUsd)}`,
      `         opened ${report.review.images.filter((image) => image.viewed).length}/${report.review.images.length} images; agent verdict ${report.review.modelVerdict ?? 'none'}`,
    );
    if (report.review.summary) lines.push(`         ${report.review.summary}`);
  }
  lines.push('', 'CHECKS');
  for (const check of report.checks) {
    lines.push(
      `  ${check.result.toUpperCase().padEnd(4)} ${check.id.padEnd(20)} [${check.source}] ${check.measured}`,
    );
  }
  lines.push('', `ISSUES (${report.issues.length})`);
  for (const issue of report.issues) {
    const where = [
      issue.sceneId ? `scene ${issue.sceneId}` : null,
      issue.frame !== null ? `F${issue.frame}` : null,
      issue.timecode,
    ]
      .filter(Boolean)
      .join(' ');
    lines.push(
      `  ${issue.severity.toUpperCase().padEnd(7)} ${issue.check} -> ${issue.owner} [${issue.source}]${where ? `  ${where}` : ''}`,
      `          ${issue.what}`,
      `          fix: ${issue.fix}`,
    );
  }
  return lines.join('\n');
}
