/**
 * One Quality Check: read the render folder, measure the film in code, have `br-quality-check` open
 * frames taken from it, and merge both into one report. The verdict is decided here, not by the
 * model: a review passes only when code found nothing, the agent found nothing, and the agent
 * opened every image it was given.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type Campaign,
  campaignSchema,
  sceneFrames,
  sceneRegistry,
  validateCampaign,
} from '@boiler-room/schema';
import type { AgentDefinition } from '../define.ts';
import { qualityCheck } from '../definitions/quality-check.ts';
import { naiveClient, scrub, usd } from '../naive/client.ts';
import {
  checkFrames,
  checkGate,
  checkGround,
  checkIntegrity,
  checkProbe,
  checkResearchBrand,
  checkResearchClaims,
  type Findings,
  type GroundSample,
  merge,
  type ResearchFacts,
  sceneAt,
  timecode,
} from './checks.ts';
import { hexToRgb, meanAbsoluteDifference, nearestPatch } from './measure.ts';
import { extractFrames, probeFilm, readRgb, scanFrames, sha256File } from './media.ts';
import type { QcCheck, QcIssue, QcReport } from './output.ts';
import { reviewTask } from './prompt.ts';
import { cutOf, type RenderDir, readRenderDir } from './render-dir.ts';
import { type LocalImage, type ReviewRun, runReview } from './review.ts';

export interface QcOptions {
  renderDir: string;
  /** Overrides the campaign the manifest names. Its hash must still match the render's. */
  campaignFile?: string;
  /** A Researcher `research.json`; claims and brand colours are traced to it. */
  researchFile?: string;
  /** False runs code checks only. Such a review is blocked, since no one looked at the frames. */
  model: boolean;
  budgetUsd?: number;
  definition?: AgentDefinition;
  say?: (line: string) => void;
}

const SEVERITY_ORDER = { blocker: 0, major: 1, minor: 2 } as const;

export function readResearch(file: string): ResearchFacts {
  const raw = JSON.parse(readFileSync(file, 'utf8')) as {
    brand?: { colors?: Record<string, string> };
    claims?: { id: string; quote: string; sourceUrl: string }[];
    brand_details?: { accents?: string[] };
  };
  if (!raw.brand?.colors || !Array.isArray(raw.claims)) {
    throw new Error(`${file} is not a Researcher result: it needs brand.colors and claims.`);
  }
  return {
    brand: { colors: raw.brand.colors },
    claims: raw.claims,
    accents: raw.brand_details?.accents ?? [],
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
  if (during && duringFile) picks.push({ frame: during.frame, file: render.local(duringFile) });
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

export function finalVerdict(
  issues: readonly QcIssue[],
  checks: readonly QcCheck[],
  run: ReviewRun | null,
  modelRequested: boolean,
): { verdict: 'pass' | 'fail'; blocked: string | null } {
  const integrity = issues.filter(
    (issue) =>
      issue.source === 'code' &&
      ['film-hash', 'campaign-hash', 'stills-from-film'].includes(issue.check),
  );
  let blocked: string | null = null;
  if (integrity.length) {
    blocked = `the film under review is not the render of this campaign (${[...new Set(integrity.map((issue) => issue.check))].join(', ')})`;
  } else if (!modelRequested) {
    blocked = 'no rendered frames were inspected (--no-model); code checks alone never pass a film';
  } else if (!run?.review) {
    blocked = `no review from the agent: ${run?.problem ?? 'it did not run'}`;
  } else {
    const unopened = run.images.filter((image) => !image.viewed);
    if (unopened.length) {
      blocked = `the agent did not open ${unopened.map((image) => `${image.name} (${image.fileId})`).join(', ')}`;
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

  const campaignFile = options.campaignFile ?? render.local(manifest.campaign.file);
  const campaignBytes = readFileSync(campaignFile);
  const raw: unknown = JSON.parse(campaignBytes.toString('utf8'));
  const parsed = campaignSchema.safeParse(raw);
  const research = options.researchFile ? readResearch(options.researchFile) : undefined;

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

  const parts: Findings[] = [
    checkIntegrity({
      filmSha256,
      manifestFilmSha256: manifest.output.sha256,
      campaignSha256,
      manifestCampaignSha256: manifest.campaign.fileSha256,
      campaignFile,
      stills,
      fps,
    }),
  ];
  let cut: Campaign | undefined;
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
      checkResearchClaims(cut, research, fps),
      checkResearchBrand(cut, research, fps),
    );

    const rests = restFrames(cut).filter((rest) => rest.frame < film.frames);
    const extracted = await extractFrames(
      render.film,
      rests.map((rest) => rest.frame),
      work,
      'rest',
    );
    const background = hexToRgb(cut.brand.colors.background);
    const ground: GroundSample[] = [];
    for (const rest of rests) {
      const file = extracted.get(rest.frame);
      if (!file) continue;
      const nearest = nearestPatch(await readRgb(file), background);
      ground.push({
        frame: rest.frame,
        sceneId: rest.sceneId,
        colour: nearest.colour,
        distance: nearest.distance,
      });
      images.push({
        file,
        name: `${manifest.campaign.id}-rest-${rest.sceneId}-${rest.frame}.png`,
        what: `Full-size frame ${rest.frame} (${timecode(rest.frame, fps)}), scene ${rest.sceneId} two thirds through: its copy has landed and its exit has not begun.`,
      });
    }
    parts.push(checkGround(cut.brand.colors.background, ground, fps));

    const sheets: LocalImage[] = [
      {
        file: render.local(render.index.contactSheet.file),
        name: `${manifest.campaign.id}-contact-sheet.png`,
        what: `Contact sheet: one frame per second, each labelled with its time and frame number (${render.index.contactSheet.frames
          .map((entry) => `F${entry.frame} ${entry.scene}`)
          .join(', ')}).`,
      },
      ...(render.index.transitionSheet
        ? [
            {
              file: render.local(render.index.transitionSheet.file),
              name: `${manifest.campaign.id}-transitions-sheet.png`,
              what: `Transitions sheet: each row is one transition, before, during (the boundary) and after: ${render.index.transitions
                .map(
                  (transition) =>
                    `${transition.index + 1} ${transition.name} at boundary F${transition.boundary} (${transition.stills.map((still) => `${still.when} F${still.frame}`).join(', ')})`,
                )
                .join('; ')}.`,
            },
          ]
        : []),
      {
        file: render.local(render.index.phoneSheet.file),
        name: `${manifest.campaign.id}-phone-sheet.png`,
        what: `Phone sheet: each scene ${render.index.phoneSheet.widthPx} px wide, the width of a phone held upright (${render.index.phoneSheet.frames
          .map((entry) => `${entry.scene} F${entry.frame}`)
          .join(', ')}).`,
      },
    ];
    images.unshift(...sheets.filter((sheet) => existsSync(sheet.file)));
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
  const blockedEarly =
    !cut ||
    code.issues.some((issue) =>
      ['film-hash', 'campaign-hash', 'stills-from-film'].includes(issue.check),
    );
  if (options.model && cut && !blockedEarly) {
    const campaign = cut;
    const budgetMicro = Math.round(
      (options.budgetUsd ?? definition.session.budget_micro_usd / 1e6) * 1e6,
    );
    const client = naiveClient();
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
          researchSupplied: Boolean(research),
          budgetUsd: budgetMicro / 1e6,
        }),
      budgetMicroUsd: budgetMicro,
      eventsFile: join(work, 'events.jsonl'),
      say,
    });
    say(`review cost ${usd(run.costMicroUsd)}`);
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
    timecode: issue.timecode ?? (issue.frame === null ? null : timecode(issue.frame, fps)),
    source: 'model',
  }));
  const inspected: QcCheck[] = run
    ? [
        {
          id: 'frames-inspected',
          result: run.images.every((image) => image.viewed) ? 'pass' : 'fail',
          measured: `${run.images.filter((image) => image.viewed).length} of ${run.images.length} images opened with view_image`,
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
  const { verdict, blocked } = finalVerdict(issues, checks, run, options.model);

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
    researchFile: options.researchFile ?? null,
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
