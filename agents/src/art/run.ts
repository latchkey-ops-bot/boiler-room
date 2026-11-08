import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { type Campaign, type Issue, sceneRegistry, validateCampaign } from '@boiler-room/schema';
import type { AgentDefinition } from '../define.ts';
import { artDirector } from '../definitions/art-director.ts';
import { type Naive, naiveClient, scrub, usd } from '../naive/client.ts';
import { fileIdOf } from '../researcher/output.ts';
import { describe, EventTracker } from '../researcher/run.ts';
import { siteHost } from '../researcher/text.ts';
import { syncAgents } from '../sync.ts';
import { type ArtPlan, applyArt, type Gate, gateDecision } from './apply.ts';
import {
  type AssetInfo,
  classifyAssets,
  distinctAssets,
  type Proposal,
  pageKey,
  proposeAssets,
} from './assets.ts';
import { checkBrand } from './brand.ts';
import { type ArtDecision, artDecisionSchema } from './decision.ts';
import {
  DEFAULT_CAP,
  DEFAULT_IMAGE_MODEL,
  type GenerationCap,
  type GenerationResult,
  generateImages,
  generationNeeds,
} from './generate.ts';
import { ART_CONTINUE_MESSAGE, artRepairMessage, artTask } from './prompt.ts';
import { decideStyle, type Lean } from './style.ts';

export interface ArtOptions {
  campaignPath: string;
  /** The Researcher's `research.json`. Defaults to `out/research/<host>/research.json`. */
  researchPath?: string;
  /** Where the updated campaign goes. Defaults to `<name>.art.json` beside the input. */
  outPath?: string;
  outRoot: string;
  budgetUsd?: number;
  maxRepairs: number;
  cap?: GenerationCap;
  imageModel?: string;
  /** False runs the code alone: default picks, no session, and nothing generated. */
  agent: boolean;
  definition?: AgentDefinition;
}

const RESUMABLE = new Set(['end_turn', 'max_iterations', 'awaiting_input']);
const MAX_CONTINUES = 4;
const MIN_TILES = 6;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const say = (message: string) =>
  console.log(scrub(`${new Date().toISOString().slice(11, 19)} ${message}`));

interface ResearchHints {
  mode: Lean | undefined;
  pageKinds: Map<string, string>;
  path: string | undefined;
}

/** Only the parts of a research result the Art Director uses, read leniently. */
function readResearch(path: string | undefined): ResearchHints {
  const hints: ResearchHints = { mode: undefined, pageKinds: new Map(), path: undefined };
  if (!path || !existsSync(path)) return hints;
  const raw = JSON.parse(readFileSync(path, 'utf8')) as {
    brand_details?: { mode?: unknown };
    brief?: { pages?: { url?: unknown; kind?: unknown }[] };
  };
  const mode = raw.brand_details?.mode;
  if (mode === 'light' || mode === 'dark') hints.mode = mode;
  for (const page of raw.brief?.pages ?? []) {
    const key = typeof page.url === 'string' ? pageKey(page.url) : undefined;
    if (key && typeof page.kind === 'string') hints.pageKinds.set(key, page.kind);
  }
  hints.path = path;
  return hints;
}

async function fileDigests(client: Naive, campaign: Campaign): Promise<Map<string, string>> {
  const digests = new Map<string, string>();
  await Promise.all(
    Object.entries(campaign.assets).map(async ([id, asset]) => {
      const fileId = fileIdOf(asset.src);
      if (!fileId) return;
      const file = await client.files.get(fileId).catch(() => null);
      if (file?.sha256) digests.set(id, file.sha256);
    }),
  );
  return digests;
}

/** Naive files are checked by id, http(s) URLs are taken as they are, and paths beside the output. */
function assetExists(client: Naive, outDir: string) {
  return async (src: string): Promise<boolean> => {
    const fileId = fileIdOf(src);
    if (fileId)
      return client.files.get(fileId).then(
        () => true,
        () => false,
      );
    if (/^https?:\/\//i.test(src)) return true;
    return existsSync(resolve(outDir, src));
  };
}

interface SessionOutcome {
  decision: ArtDecision | undefined;
  gate: Gate;
  rounds: { round: number; problems: Gate['problems'] }[];
  sessionId: string | undefined;
  agentId: string | undefined;
  agentVersion: number | undefined;
  consumedMicroUsd: number;
  stopReason: string | undefined;
}

/** One session of `br-art-director`: picks reviewed, generated images inspected, repairs sent. */
async function reviewWithAgent(
  client: Naive,
  definition: AgentDefinition,
  task: string,
  budgetMicro: number,
  maxRepairs: number,
  proposals: readonly Proposal[],
  infos: readonly AssetInfo[],
  generation: GenerationResult,
  eventsPath: string,
  campaignId: string,
): Promise<SessionOutcome> {
  const [synced] = await syncAgents(client, [definition]);
  if (!synced) throw new Error('Agent sync returned nothing.');
  say(`agent ${synced.name} ${synced.id} v${synced.version} (${synced.action})`);
  const session = await client.sessions.create({
    agent_id: synced.id,
    message: task,
    budget_micro_usd: budgetMicro,
    ...(definition.output_schema ? { output_schema: definition.output_schema } : {}),
    structured_output_required: definition.structured_output_required,
    metadata: { run: 'art', campaign: campaignId },
  });
  say(`session ${session.id} started, budget ${usd(budgetMicro)}`);
  const tracker = new EventTracker();
  const deadline = Date.now() + definition.session.max_minutes * 60_000;
  let afterSeq = 0;

  const settle = async () => {
    for (;;) {
      const timer = setTimeout(
        () => {
          say(`time limit of ${definition.session.max_minutes} minutes reached; interrupting`);
          client.sessions.interrupt(session.id).catch(() => {});
        },
        Math.max(1000, deadline - Date.now()),
      );
      try {
        for await (const event of client.stream(session.id, { afterSeq })) {
          afterSeq = event.seq;
          const record = event as unknown as { type: string; data: Record<string, unknown> };
          tracker.handle(record);
          if (event.type !== 'message.delta' && !event.type.startsWith('span.'))
            appendFileSync(eventsPath, `${scrub(JSON.stringify(event))}\n`);
          const line = describe(record);
          if (line) say(line);
        }
      } finally {
        clearTimeout(timer);
      }
      const state = await client.sessions.get(session.id);
      if ((state.status !== 'running' && state.status !== 'queued') || Date.now() > deadline)
        return state;
      await sleep(1000);
    }
  };

  let decision: ArtDecision | undefined;
  let gate = gateDecision(undefined, proposals, infos, generation.generated);
  const rounds: SessionOutcome['rounds'] = [];
  let gated = 0;
  let continues = 0;
  let stopReason: string | undefined;
  for (;;) {
    const state = await settle();
    const fresh = tracker.submissions > gated && Boolean(state.structured_output);
    if (!fresh) {
      const resumable = state.status === 'idle' && RESUMABLE.has(state.stop_reason ?? '');
      if (resumable && continues < MAX_CONTINUES && Date.now() < deadline) {
        continues += 1;
        say(`no result yet; asking the agent to continue (${continues}/${MAX_CONTINUES})`);
        afterSeq = (
          await client.sessions.send(session.id, { message: ART_CONTINUE_MESSAGE, queue: true })
        ).accepted_seq;
        continue;
      }
      stopReason = state.stop_reason ?? state.status;
      say(`the session stopped (${state.status}/${state.stop_reason}) without a new result`);
      break;
    }
    gated = tracker.submissions;
    const parsed = artDecisionSchema.safeParse(state.structured_output);
    const round = rounds.length + 1;
    if (!parsed.success) {
      const problems = [
        {
          sceneId: '$',
          message: `The result does not match the schema: ${parsed.error.message.slice(0, 400)}`,
          fix: 'Submit scenes, generated and flags exactly as the output schema describes.',
        },
      ];
      rounds.push({ round, problems });
      if (round > maxRepairs) break;
      afterSeq = (
        await client.sessions.send(session.id, {
          message: artRepairMessage(problems, round, maxRepairs),
          queue: true,
        })
      ).accepted_seq;
      continue;
    }
    decision = parsed.data;
    gate = gateDecision(decision, proposals, infos, generation.generated);
    rounds.push({ round, problems: gate.problems });
    if (gate.problems.length === 0) {
      say(`decision accepted on submission ${round}`);
      break;
    }
    say(`decision has ${gate.problems.length} problem(s) on submission ${round}`);
    if (round > maxRepairs || Date.now() > deadline) break;
    afterSeq = (
      await client.sessions.send(session.id, {
        message: artRepairMessage(gate.problems, round, maxRepairs),
        queue: true,
      })
    ).accepted_seq;
  }

  const final = await client.sessions.get(session.id).catch(() => null);
  if (final && (final.status === 'running' || final.status === 'queued'))
    await client.sessions.interrupt(session.id).catch(() => {});
  return {
    decision,
    gate,
    rounds,
    sessionId: session.id,
    agentId: synced.id,
    agentVersion: synced.version,
    consumedMicroUsd: final?.consumed_micro_usd ?? 0,
    stopReason,
  };
}

function defaultOutPath(campaignPath: string): string {
  const name = basename(campaignPath, extname(campaignPath)).replace(/\.campaign$/, '');
  return join(dirname(campaignPath), `${name}.art.json`);
}

/**
 * `pnpm art <campaign.json>`: chooses the style family and fixes the colours in code, checks
 * fonts and logo, proposes assets per scene, generates the few images the skill allows under a
 * per-film cap, has `br-art-director` review the picks and inspect the generated images, merges
 * the result, validates it with `sceneRegistry` and writes it with a report. Prints the cost.
 */
export async function artDirect(options: ArtOptions): Promise<number> {
  const definition = options.definition ?? artDirector;
  const campaignPath = resolve(options.campaignPath);
  const outPath = resolve(options.outPath ?? defaultOutPath(campaignPath));
  const outDir = dirname(outPath);
  const reportPath = `${outPath.replace(/\.json$/, '')}.report.json`;
  mkdirSync(outDir, { recursive: true });

  const input = await validateCampaign(JSON.parse(readFileSync(campaignPath, 'utf8')), {
    sceneRegistry,
  });
  if (!input.ok) {
    say(
      `${campaignPath} does not pass validateCampaign; the Art Director takes only a valid campaign:`,
    );
    for (const issue of input.issues.filter((each) => each.severity === 'error'))
      say(`  ${issue.code} ${issue.path}: ${issue.message}`);
    return 1;
  }
  const campaign = input.campaign;
  const host = siteHost(campaign.sourceUrl);
  const research = readResearch(
    options.researchPath
      ? resolve(options.researchPath)
      : join(options.outRoot, 'research', host, 'research.json'),
  );

  const client = naiveClient();
  const balanceBefore = (await client.credits.show()).balance_micro_usd;
  const digests = await fileDigests(client, campaign);

  // 1-3: style family, colours, fonts and logo, all in code.
  const style = decideStyle(campaign.brand.colors, { mode: research.mode });
  const brandCheck = checkBrand(campaign);
  say(
    `family ${style.familyName}: background L ${style.backgroundL.toFixed(3)} -> ground L ${style.groundL.toFixed(3)}, ${style.changes.length} colour change(s)`,
  );

  // 4: assets per scene.
  const infos = distinctAssets(
    classifyAssets(campaign, { pageKinds: research.pageKinds, digests }),
  );
  const proposals = proposeAssets(campaign, infos);
  say(`${infos.length} distinct captured pictures; ${proposals.length} scene(s) to fill`);

  // 5: generation, only when the agent will inspect the result.
  const styled: Campaign = { ...campaign, brand: { ...brandCheck.brand, colors: style.colors } };
  const needs = generationNeeds(styled, style);
  const eventsPath = `${outPath.replace(/\.json$/, '')}.events.jsonl`;
  writeFileSync(eventsPath, '');
  let generation: GenerationResult = { generated: [], skipped: [], spentMicroUsd: 0 };
  if (needs.length > 0 && options.agent) {
    generation = await generateImages(client, needs, {
      cap: options.cap ?? DEFAULT_CAP,
      model: options.imageModel ?? DEFAULT_IMAGE_MODEL,
      outDir,
    });
    for (const image of generation.generated)
      say(`generated ${image.need.assetId} ${image.fileId} for ${usd(image.costMicroUsd)}`);
    for (const skip of generation.skipped)
      say(`not generated ${skip.need.assetId}: ${skip.reason}`);
  } else if (needs.length > 0) {
    generation.skipped = needs.map((need) => ({
      need,
      reason: 'no agent to inspect it (--no-agent), so the code-built fallback stands',
    }));
  }

  // The agent reviews picks and inspects generated images.
  const budgetMicro = Math.round(
    (options.budgetUsd ?? definition.session.budget_micro_usd / 1e6) * 1e6,
  );
  let outcome: SessionOutcome | undefined;
  let gate = gateDecision(undefined, proposals, infos, generation.generated);
  const review = proposals.length > 0 || generation.generated.length > 0;
  if (options.agent && review) {
    const task = artTask({
      campaign: styled,
      style,
      proposals,
      infos,
      generated: generation.generated,
      budgetUsd: budgetMicro / 1e6,
    });
    try {
      outcome = await reviewWithAgent(
        client,
        definition,
        task,
        budgetMicro,
        options.maxRepairs,
        proposals,
        infos,
        generation,
        eventsPath,
        campaign.id,
      );
      gate = outcome.gate;
    } catch (cause) {
      say(
        `agent review failed, keeping the code's picks: ${cause instanceof Error ? cause.message : cause}`,
      );
    }
  }

  const plan: ArtPlan = {
    colors: style.colors,
    brand: brandCheck.brand,
    extraAssets: brandCheck.assets,
    picks: gate.picks,
    generated: generation.generated.filter((image) => gate.accepted.has(image.need.assetId)),
  };
  const result = applyArt(campaign, plan);
  const validation = await validateCampaign(result, {
    sceneRegistry,
    assetExists: assetExists(client, outDir),
  });

  const sentBack = proposals
    .filter((proposal) => proposal.type === 'tile-wall' && proposal.assetIds.length < MIN_TILES)
    .map((proposal) => ({
      scene_id: proposal.sceneId,
      substitution:
        'tile-wall -> feature-card with its own headline (director-beat-templates substitution)',
      why: `Only ${proposal.candidates.length} distinct captured tile(s); tile-wall needs ${MIN_TILES}.`,
    }));
  const blocking = proposals
    .filter(
      (proposal) => proposal.type !== 'tile-wall' && proposal.assetIds.length < proposal.slot.min,
    )
    .map(
      (proposal) =>
        `${proposal.sceneId} (${proposal.type}) needs ${proposal.slot.min} captured page(s) and has ${proposal.assetIds.length}. The Researcher must capture more pages, or the customer must upload them.`,
    );
  const smallCaptures = infos
    .filter((info) =>
      proposals.some(
        (p) => p.type === 'site-hero' && gate.picks.get(p.sceneId)?.assetIds.includes(info.id),
      ),
    )
    .filter((info) => (info.asset.width ?? 0) > 0 && (info.asset.width ?? 0) < 2880)
    .map(
      (info) =>
        `site-hero page "${info.id}" is ${info.asset.width} px wide; the spec asks for device scale 2 (2880 px or more). It will look soft when pushed in.`,
    );

  const duplicates = infos
    .filter((info) => info.sameAs.length > 0)
    .map((info) => `${info.id} (also ${info.sameAs.join(', ')})`);
  const duplicateFlag = duplicates.length
    ? [
        `${duplicates.length} picture(s) are declared more than once with identical bytes, and each was offered once: ${duplicates.join('; ')}. A "-ui-" crop identical to its page top means the capture found no element to crop.`,
      ]
    : [];

  const balanceAfter = (await client.credits.show().catch(() => null))?.balance_micro_usd;
  const sessionMicro = outcome?.consumedMicroUsd ?? 0;
  const computer = outcome?.agentId
    ? await client.agents.computer(outcome.agentId).catch(() => null)
    : null;
  const report = {
    campaign: campaign.id,
    input: campaignPath,
    output: outPath,
    research: research.path ?? null,
    family: {
      name: style.familyName,
      background: campaign.brand.colors.background,
      background_l: Number(style.backgroundL.toFixed(4)),
      ground: style.colors.background,
      ground_l: Number(style.groundL.toFixed(4)),
      lean: style.lean ?? null,
      lean_from: style.leanFrom ?? null,
    },
    colour_changes: style.changes,
    contrast: {
      ink: Number(style.contrast.ink.toFixed(2)),
      accent: Number(style.contrast.accent.toFixed(2)),
      muted: style.contrast.muted === null ? null : Number(style.contrast.muted.toFixed(2)),
    },
    fonts: brandCheck.fonts,
    font_changes: brandCheck.changes,
    assets_per_scene: proposals.map((proposal) => {
      const pick = gate.picks.get(proposal.sceneId);
      const ids = pick?.assetIds ?? proposal.assetIds;
      const tiers = ids.map((id) => infos.find((info) => info.id === id)?.tier ?? 0);
      return {
        scene_id: proposal.sceneId,
        type: proposal.type,
        asset_ids: ids,
        tier: ids.length === 0 ? 4 : Math.max(...tiers),
        source: pick?.source ?? 'default',
        reason: pick?.reason ?? proposal.note ?? null,
        default: proposal.assetIds,
      };
    }),
    tier4_scenes: proposals
      .filter((proposal) => (gate.picks.get(proposal.sceneId)?.assetIds ?? []).length === 0)
      .map((proposal) => proposal.sceneId),
    generated: generation.generated.map((image) => ({
      asset_id: image.need.assetId,
      file_id: image.fileId,
      purpose: image.need.purpose,
      scene_ids: image.need.sceneIds,
      model: image.model,
      cost_micro_usd: image.costMicroUsd,
      local_copy: image.localPath ?? null,
      declared: gate.accepted.has(image.need.assetId),
      verdict:
        gate.accepted.get(image.need.assetId) ?? gate.rejected.get(image.need.assetId) ?? null,
      prompt: image.need.prompt,
    })),
    not_generated: generation.skipped.map((skip) => ({
      asset_id: skip.need.assetId,
      purpose: skip.need.purpose,
      reason: skip.reason,
    })),
    sent_back: sentBack,
    flags: [
      ...style.flags,
      ...brandCheck.flags,
      ...blocking,
      ...smallCaptures,
      ...duplicateFlag,
      ...(outcome?.decision?.flags ?? []).map((flag) => `Agent: ${flag}`),
    ],
    agent: outcome
      ? {
          agent_id: outcome.agentId,
          agent_version: outcome.agentVersion,
          session_id: outcome.sessionId,
          rounds: outcome.rounds,
          stop_reason: outcome.stopReason ?? null,
          computer: computer ? `${computer.id} ${computer.status}` : null,
        }
      : null,
    validation: { ok: validation.ok, issues: validation.issues },
    cost: {
      session_micro_usd: sessionMicro,
      images_micro_usd: generation.spentMicroUsd,
      balance_delta_micro_usd: balanceAfter === undefined ? null : balanceBefore - balanceAfter,
    },
  };
  writeFileSync(reportPath, scrub(`${JSON.stringify(report, null, 1)}\n`));

  const errors = validation.issues.filter((issue: Issue) => issue.severity === 'error');
  if (!validation.ok) {
    const rejectedPath = `${outPath.replace(/\.json$/, '')}.rejected.json`;
    writeFileSync(rejectedPath, `${JSON.stringify(result, null, 2)}\n`);
    say(
      `the result fails validateCampaign (${errors.map((issue) => issue.code).join(', ')}); not written as ${outPath}`,
    );
    for (const issue of errors) say(`  ${issue.code} ${issue.path}: ${issue.message}`);
  } else {
    writeFileSync(outPath, `${JSON.stringify(result, null, 2)}\n`);
    say(`wrote ${outPath} (validateCampaign ok, ${validation.issues.length} warning(s))`);
  }
  say(`report ${reportPath}`);
  for (const back of sentBack)
    say(`sent back: ${back.scene_id}: ${back.substitution}. ${back.why}`);
  say(
    `cost: session ${usd(sessionMicro)}, images ${usd(generation.spentMicroUsd)} (${generation.generated.length} generated), total ${usd(sessionMicro + generation.spentMicroUsd)}${report.cost.balance_delta_micro_usd !== null ? `. Org balance moved ${usd(report.cost.balance_delta_micro_usd)} meanwhile, which includes any other agent running in the org` : ''}.`,
  );
  if (!validation.ok) return 1;
  return sentBack.length > 0 ? 3 : 0;
}
