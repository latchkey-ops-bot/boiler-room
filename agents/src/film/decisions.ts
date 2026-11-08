/**
 * Who decided what on a film, and why, read from what each stage wrote: the Researcher's report,
 * the Director's handoff and report, the Art Director's report and the Quality Check report. The
 * film command adds its own decisions (route-backs, budget pauses, the cap, the render gate). The
 * log is written as `decisions.json`, in the web app's words, so its film page and the company
 * board can show it as it is.
 */
import type { CrewMember, DecisionKind, FilmDecision, FilmStage, FilmStatus } from './order.ts';

export interface DecisionDraft {
  agent: CrewMember;
  kind: DecisionKind;
  stage: FilmStage;
  /** Default: `failed` for a failure, `done` for a delivery, else `working`. */
  status?: FilmStatus;
  message: string;
  why: string;
  data?: Record<string, unknown>;
}

export class DecisionLog {
  readonly entries: FilmDecision[] = [];
  private readonly clock: () => Date;
  constructor(clock: () => Date = () => new Date()) {
    this.clock = clock;
  }
  add(draft: DecisionDraft, round: number): FilmDecision {
    const seq = this.entries.length;
    const status =
      draft.status ??
      (draft.kind === 'failed' ? 'failed' : draft.kind === 'delivered' ? 'done' : 'working');
    const entry: FilmDecision = {
      id: `d-${seq}`,
      seq,
      at: this.clock().toISOString(),
      agent: draft.agent,
      kind: draft.kind,
      stage: draft.stage,
      status,
      round,
      message: draft.message,
      why: draft.why,
      ...(draft.data ? { data: draft.data } : {}),
    };
    this.entries.push(entry);
    return entry;
  }
}

type Json = Record<string, unknown>;
const list = (value: unknown): Json[] =>
  Array.isArray(value)
    ? value.filter((item): item is Json => !!item && typeof item === 'object')
    : [];
const text = (value: unknown, fallback = ''): string =>
  typeof value === 'string' && value.trim() ? value.trim() : fallback;
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
const usd = (micro: unknown) => `$${(Number(micro ?? 0) / 1e6).toFixed(4)}`;

/** The Researcher's result, from its `report.json` and `research.json`. */
export function researchDecisions(report: Json, research: Json | undefined): DecisionDraft[] {
  const drafts: DecisionDraft[] = [];
  const rounds = list(report.rounds).length;
  if (!research) {
    drafts.push({
      agent: 'researcher',
      kind: 'failed',
      stage: 'research',
      message: `No research of ${text(report.host, 'the site')} passed the gate`,
      why: text(report.error, `${plural(rounds, 'submission')} failed the verbatim gate`),
      data: { sessionId: report.session_id ?? null },
    });
    return drafts;
  }
  const claims = list(research.claims);
  const assets = Object.keys((research.assets as Json | undefined) ?? {});
  const brief = (research.brief as Json | undefined) ?? {};
  const pages = list(brief.pages);
  const rejected = list(report.rejected_claims);
  drafts.push({
    agent: 'researcher',
    kind: 'decision',
    stage: 'research',
    message: `Kept ${plural(claims.length, 'claim')} and ${plural(assets.length, 'asset')} from ${plural(pages.length, 'page')} of ${text(report.host, 'the site')}`,
    why: `Every quote is verbatim in the visible text of its page; the gate checked ${plural(rounds, 'submission')}${rejected.length ? ` and dropped ${plural(rejected.length, 'claim')} it could not verify` : ''}.`,
    data: {
      sessionId: report.session_id ?? null,
      claimIds: claims.map((claim) => claim.id),
      ...(rejected.length ? { rejected: rejected.map((claim) => claim.id) } : {}),
    },
  });
  const needs = list(research.needs_upload);
  if (needs.length) {
    drafts.push({
      agent: 'researcher',
      kind: 'decision',
      stage: 'research',
      message: `Asked for ${plural(needs.length, 'upload')}`,
      why: needs.map((need) => text(need.reason, text(need.kind, 'missing material'))).join('; '),
    });
  }
  return drafts;
}

/** The Director's choices and the validator's rounds, from `director-report.json` and `handoff.json`. */
export function directorDecisions(report: Json, handoff: Json | undefined): DecisionDraft[] {
  const drafts: DecisionDraft[] = [];
  const rounds = list(report.rounds);
  for (const [index, round] of rounds.entries()) {
    const blocking = list(round.blocking);
    if (blocking.length) {
      drafts.push({
        agent: 'validator',
        kind: 'sent_back',
        stage: 'checks',
        message: `Sent submission ${index + 1} back to the Director with ${plural(blocking.length, 'issue')}: ${[...new Set(blocking.map((issue) => text(issue.code)))].join(', ')}`,
        why: text(blocking[0]?.message, 'validateCampaign or the §10 checks failed'),
        data: { codes: blocking.map((issue) => issue.code) },
      });
    } else {
      drafts.push({
        agent: 'validator',
        kind: 'passed',
        stage: 'checks',
        message: `Submission ${index + 1} passed validateCampaign, the §10 checks and the render gate`,
        why: `${plural(list(round.other).length, 'warning or issue')} left to other agents, none the Director's own.`,
      });
    }
  }
  for (const session of list(report.sessions)) {
    if (session.budget_paused) {
      drafts.push({
        agent: 'coordinator',
        kind: 'decision',
        stage: 'script',
        message: `Director session ${text(session.session_id)} paused on its budget and was cancelled`,
        why: 'A session parked on its budget waits for a person; the film never leaves one waiting. The Director retries once from its last submission.',
        data: { sessionId: session.session_id, spent: usd(session.consumed_micro_usd) },
      });
    }
  }
  if (!handoff) {
    drafts.push({
      agent: 'director',
      kind: 'failed',
      stage: 'script',
      message: 'No campaign was written',
      why: text(report.failed, text(report.error, 'the repair rounds did not clear every issue')),
    });
    return drafts;
  }
  drafts.push({
    agent: 'director',
    kind: 'decision',
    stage: 'script',
    message: `Chose the ${text(handoff.template)} template`,
    why: text(handoff.reason, 'By §1 of the director skill.'),
    data: { counts: handoff.counts ?? null },
  });
  const substitutions = list(handoff.substitutions);
  if (substitutions.length) {
    drafts.push({
      agent: 'director',
      kind: 'decision',
      stage: 'script',
      message: substitutions
        .map((each) => `row ${each.row}: ${text(each.from)} became ${text(each.to)}`)
        .join('; '),
      why: 'The research did not support the template scene on those rows, and director-beat-templates allows these substitutions.',
    });
  }
  const tier4 = Array.isArray(handoff.tier4SceneIds) ? handoff.tier4SceneIds : [];
  if (tier4.length) {
    drafts.push({
      agent: 'director',
      kind: 'decision',
      stage: 'script',
      message: `Left ${tier4.join(', ')} without a captured picture (tier 4)`,
      why: 'No capture shows what the copy says, and a greeked panel beats a picture of something else.',
    });
  }
  if (handoff.noNumericProof) {
    drafts.push({
      agent: 'director',
      kind: 'decision',
      stage: 'script',
      message: 'Showed no numeric proof',
      why: 'No claim states a figure the film can show.',
    });
  }
  const left = list(handoff.issuesLeft);
  if (left.length) {
    drafts.push({
      agent: 'director',
      kind: 'decision',
      stage: 'script',
      message: `Left ${plural(left.length, 'issue')} to their owners: ${left.map((issue) => `${text(issue.code)} (${text(issue.owner)})`).join(', ')}`,
      why: left.map((issue) => text(issue.note)).join(' '),
    });
  }
  if (text(handoff.notes)) {
    drafts.push({
      agent: 'director',
      kind: 'decision',
      stage: 'script',
      message: 'Notes for the next agents',
      why: text(handoff.notes),
    });
  }
  return drafts;
}

/** The Art Director's choices, from `campaign.art.report.json`. */
export function artDecisions(report: Json): DecisionDraft[] {
  const drafts: DecisionDraft[] = [];
  const family = (report.family as Json | undefined) ?? {};
  const changes = list(report.colour_changes);
  drafts.push({
    agent: 'art_director',
    kind: 'decision',
    stage: 'art_direction',
    message: `${text(family.name, 'Style')} family, on a ${text(family.ground)} ground`,
    why: `The brand background ${text(family.background)} has OKLCH lightness ${family.background_l ?? '?'}${changes.length ? `. ${changes.map((change) => `${text(change.token)} ${text(change.from)} to ${change.to ?? 'none'}: ${text(change.why)}`).join(' ')}` : ', so no colour changed.'}`,
    data: { contrast: report.contrast ?? null },
  });
  for (const note of Array.isArray(report.font_changes) ? report.font_changes : []) {
    if (typeof note === 'string')
      drafts.push({
        agent: 'art_director',
        kind: 'decision',
        stage: 'art_direction',
        message: 'Changed a font',
        why: note,
      });
  }
  const scenes = list(report.assets_per_scene);
  for (const scene of scenes.filter((each) => each.source === 'agent')) {
    const ids = Array.isArray(scene.asset_ids) ? scene.asset_ids : [];
    drafts.push({
      agent: 'art_director',
      kind: 'decision',
      stage: 'art_direction',
      message: ids.length
        ? `Picked ${ids.join(', ')} for ${text(scene.scene_id)}`
        : `Left ${text(scene.scene_id)} without a picture`,
      why: text(scene.reason, 'Chosen on sight from the candidates.'),
      data: { sceneId: scene.scene_id, tier: scene.tier ?? null },
    });
  }
  const defaults = scenes.filter((each) => each.source !== 'agent');
  if (defaults.length) {
    drafts.push({
      agent: 'art_director',
      kind: 'decision',
      stage: 'art_direction',
      message: `Kept the code's ranking on ${plural(defaults.length, 'scene')}: ${defaults.map((each) => text(each.scene_id)).join(', ')}`,
      why: 'Nothing to choose between, or no review that could be used; the code ranks pictures by the asset ladder.',
    });
  }
  for (const image of list(report.generated)) {
    drafts.push({
      agent: 'art_director',
      kind: 'decision',
      stage: 'art_direction',
      message: `${image.declared ? 'Used' : 'Did not use'} the generated ${text(image.purpose, 'image')} ${text(image.asset_id)}`,
      why: text(image.verdict, image.declared ? 'Accepted on sight.' : 'Not accepted on sight.'),
      data: { cost: usd(image.cost_micro_usd) },
    });
  }
  for (const back of list(report.sent_back)) {
    drafts.push({
      agent: 'art_director',
      kind: 'sent_back',
      stage: 'art_direction',
      message: `Sent ${text(back.scene_id)} back: ${text(back.substitution)}`,
      why: text(back.why),
    });
  }
  for (const review of list((report.agent as Json | undefined)?.reviews)) {
    if (review.budget_paused) {
      drafts.push({
        agent: 'coordinator',
        kind: 'decision',
        stage: 'art_direction',
        message: `Art Director review ${text(review.batch)} paused on its budget and was cancelled`,
        why:
          review.agent_cap_spent === true
            ? "A session parked on its budget waits for a person. The agent's own budget cap had no room for its first call; its pictures were offered again in smaller batches if they could be split, and once one that could not be split met the cap too, no further review started, leaving the code's ranking."
            : 'A session parked on its budget waits for a person. Its pictures were offered again in smaller batches.',
        data: { sessionId: review.session_id ?? null },
      });
    }
  }
  return drafts;
}

/** The Quality Check verdict and its blocker and major issues, from `qc-report.json`. */
export function qcDecisions(report: Json): DecisionDraft[] {
  const issues = list(report.issues);
  const serious = issues.filter((issue) => issue.severity !== 'minor');
  const review = (report.review as Json | undefined) ?? {};
  const passed = report.verdict === 'pass';
  const drafts: DecisionDraft[] = [
    {
      agent: 'quality_check',
      kind: passed ? 'passed' : 'sent_back',
      stage: 'review',
      message: passed
        ? 'Passed the film'
        : `Failed the film${report.blocked ? ' (blocked)' : ''} with ${plural(serious.length, 'blocker or major issue')}`,
      why: text(
        report.blocked,
        text(review.summary, passed ? 'Every check passed.' : 'See the issues.'),
      ),
      data: {
        sessionId: review.sessionId ?? null,
        minor: issues.length - serious.length,
      },
    },
  ];
  for (const issue of serious) {
    drafts.push({
      agent: 'quality_check',
      kind: 'decision',
      stage: 'review',
      message: `${text(issue.severity)} ${text(issue.check)} for ${text(issue.owner)}${issue.sceneId ? ` in ${text(issue.sceneId)}` : ''}${typeof issue.frame === 'number' ? ` at frame ${issue.frame}` : ''}: ${text(issue.what)}`,
      why: `Fix: ${text(issue.fix)}`,
      data: { check: issue.check, owner: issue.owner, source: issue.source ?? null },
    });
  }
  return drafts;
}
