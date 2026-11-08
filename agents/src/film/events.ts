/**
 * The film command's events for the film runner (`--events <file>`): one JSON object a line, in
 * the shapes `parseFilmEvent` in `@boiler-room/film-runner/contract` accepts, each written and
 * flushed as it happens. The runner tails the file, uploads each artifact it names and forwards
 * every event to the website, whose film page shows the messages to the founder as they are. So
 * every message is a plain sentence: keys, links, paths and Naive ids are taken out first.
 *
 * Every event is checked with `parseFilmEvent` before it is written; one the contract would refuse
 * is never written, and is said on stderr instead. The same decisions go to `decisions.json`.
 */
import { closeSync, fsyncSync, mkdirSync, openSync, writeSync } from 'node:fs';
import { basename, dirname, isAbsolute, relative } from 'node:path';
import {
  type CostStep,
  clip,
  type FilmAgent,
  type Format,
  parseFilmEvent,
  type Stage,
  type UploadKind,
  type QcIssue as WireQcIssue,
} from '@boiler-room/film-runner/contract';
import { scrub } from '../naive/client.ts';
import { routable } from '../pipeline/ledger.ts';
import type { QcReport } from '../quality/output.ts';
import type { CrewMember, FilmDecision, FilmStage } from './order.ts';

const NAIVE_IDS: Record<string, string> = {
  ses: 'a session',
  fil: 'a file',
  cmp: 'a computer',
  agt: 'an agent',
  snp: 'a snapshot',
  run: 'a run',
};

/**
 * `text` as a sentence for the founder: no secret this process read, no link (only its site), no
 * path (only its file name), no Naive id, on one line, at most 500 characters.
 */
export function plain(text: string): string {
  const out = scrub(text)
    // A link keeps only its site: "posthog.com", never the address of a file or a signed URL.
    .replace(
      /\bhttps?:\/\/([^\s/"'`<>)]+)[^\s"'`<>)]*?([.,;:!?]*)(?=[\s"'`<>)]|$)/gi,
      (_all, host: string, tail: string) =>
        `${host.replace(/^www\./, '').replace(/[.,;:]+$/, '')}${tail}`,
    )
    // A path keeps only its file name.
    .replace(
      /(^|[\s("'`=])((?:~|\.{1,2})?\/[^\s"'`)]+?)([.,;:!?]*)(?=[\s"'`)]|$)/g,
      (_all, lead: string, path: string, tail: string) =>
        `${lead}${basename(path) || 'a file'}${tail}`,
    )
    .replace(/\b(ses|fil|cmp|agt|snp|run)_[a-z0-9]{8,}\b/gi, (_all, kind: string) =>
      kind.toLowerCase() in NAIVE_IDS ? (NAIVE_IDS[kind.toLowerCase()] as string) : 'an id',
    )
    .replace(/\b(?:key|org|sk|pk)_[A-Za-z0-9_-]{8,}\b/g, '[id]')
    .replace(/\[REDACTED\]/g, '[id]')
    .replace(/\s+/g, ' ')
    .trim();
  return clip(out.length > 0 ? out : 'No details.');
}

/** Who speaks for a decision on the website: the crew member, or the stage's for the coordinator. */
const STAGE_AGENT: Record<FilmStage, FilmAgent> = {
  research: 'researcher',
  script: 'director',
  checks: 'validator',
  approval: 'account_manager',
  art_direction: 'art_director',
  motion: 'motion',
  audio: 'audio',
  render: 'render',
  review: 'quality_check',
  delivery: 'account_manager',
};

export function agentOf(member: CrewMember, stage: FilmStage, kind?: string): FilmAgent {
  if (member === 'coordinator' || member === 'customer') {
    // A route-back is Quality Check's finding sent on; the rest belong to the stage.
    return kind === 'sent_back' ? 'quality_check' : STAGE_AGENT[stage];
  }
  return member;
}

/** The three kinds a decision event may have: the others read as a plain decision. */
const kindOf = (kind: FilmDecision['kind']): 'decision' | 'passed' | 'sent_back' =>
  kind === 'passed' || kind === 'sent_back' ? kind : 'decision';

/** What the film command tells the runner, as it happens. */
export interface FilmEvents {
  stage(stage: Exclude<Stage, 'approval'>, agent: FilmAgent, message: string): void;
  decision(entry: FilmDecision): void;
  session(agent: FilmAgent, sessionId: string, state: 'started' | 'ended', microUsd?: number): void;
  cost(step: CostStep, microUsd: number, totalMicroUsd: number): void;
  /** A file in the run dir for the runner to upload. */
  artifact(
    kind: UploadKind,
    file: string,
    contentType: string,
    version: number,
    variantKey?: string,
  ): void;
  scriptReady(version: number, campaignFile: string, unconfirmedClaims: string[]): void;
  /** Quality Check's verdict on one format, or why it gave none. */
  qc(format: Format, report: QcReport | null, why?: string): void;
  delivered(version: number, variants: string[]): void;
  error(code: string, message: string, stage: Stage | null, retryable: boolean): void;
  /** Writes nothing more: a stopped film is not reported after its last word. */
  close(): void;
}

/** Events to nowhere, for `pnpm film` without `--events`. */
export const NO_EVENTS: FilmEvents = {
  stage() {},
  decision() {},
  session() {},
  cost() {},
  artifact() {},
  scriptReady() {},
  qc() {},
  delivered() {},
  error() {},
  close() {},
};

const whole = (value: number) => Math.max(0, Math.round(value));

/** The events file, written one flushed line at a time. */
export class EventLog implements FilmEvents {
  private readonly fd: number;
  private seq = 0;
  private closed = false;
  private readonly runDir: string;
  private readonly clock: () => Date;
  private readonly warn: (line: string) => void;
  /** The stage the film last said it was in, so an error can say where it stopped. */
  lastStage: Stage | null = null;

  constructor(
    file: string,
    runDir: string,
    options: { clock?: () => Date; warn?: (line: string) => void } = {},
  ) {
    mkdirSync(dirname(file), { recursive: true });
    this.fd = openSync(file, 'a');
    this.runDir = runDir;
    this.clock = options.clock ?? (() => new Date());
    this.warn = options.warn ?? ((line) => console.error(line));
  }

  /** Checks one event against the contract and appends it, flushed, or says why it was not. */
  private emit(event: Record<string, unknown>) {
    if (this.closed) return;
    const line = JSON.stringify({
      v: 1,
      seq: this.seq + 1,
      at: this.clock().toISOString(),
      ...event,
    });
    const parsed = parseFilmEvent(line);
    if (!parsed.ok) {
      this.warn(`event not written, the contract refuses it: ${parsed.reason}`);
      return;
    }
    this.seq += 1;
    writeSync(this.fd, `${line}\n`);
    try {
      fsyncSync(this.fd);
    } catch {
      // A file system that cannot sync still has the line in its cache, where the runner reads it.
    }
  }

  private rel(file: string): string {
    return isAbsolute(file) ? relative(this.runDir, file) : file;
  }

  stage(stage: Exclude<Stage, 'approval'>, agent: FilmAgent, message: string) {
    this.lastStage = stage;
    this.emit({ type: 'stage', stage, status: 'working', agent, message: plain(message) });
  }

  decision(entry: FilmDecision) {
    const said =
      entry.why && entry.why !== entry.message ? `${entry.message}. ${entry.why}` : entry.message;
    this.emit({
      type: 'decision',
      agent: agentOf(entry.agent, entry.stage, entry.kind),
      stage: entry.stage,
      kind: kindOf(entry.kind),
      message: plain(said),
      detail: { id: entry.id, round: entry.round, kind: entry.kind, by: entry.agent },
    });
  }

  session(agent: FilmAgent, sessionId: string, state: 'started' | 'ended', microUsd?: number) {
    this.emit({
      type: 'session',
      agent,
      sessionId,
      state,
      ...(microUsd !== undefined ? { microUsd: whole(microUsd) } : {}),
    });
  }

  cost(step: CostStep, microUsd: number, totalMicroUsd: number) {
    this.emit({
      type: 'cost',
      step,
      microUsd: whole(microUsd),
      totalMicroUsd: whole(totalMicroUsd),
    });
  }

  artifact(
    kind: UploadKind,
    file: string,
    contentType: string,
    version: number,
    variantKey?: string,
  ) {
    this.emit({
      type: 'artifact',
      kind,
      path: this.rel(file),
      contentType,
      version,
      ...(variantKey !== undefined ? { variantKey } : {}),
    });
  }

  scriptReady(version: number, campaignFile: string, unconfirmedClaims: string[]) {
    this.emit({
      type: 'script_ready',
      version,
      campaignPath: this.rel(campaignFile),
      unconfirmedClaims,
    });
  }

  qc(format: Format, report: QcReport | null, why?: string) {
    if (!report) {
      this.emit({
        type: 'qc',
        format,
        verdict: 'blocked',
        routable: 0,
        issues: [
          {
            severity: 'blocker',
            check: 'review',
            owner: 'quality_check',
            message: plain(
              `Quality Check did not review the ${format} film: ${why ?? 'no report'}`,
            ),
          },
        ],
      });
      return;
    }
    const issues: WireQcIssue[] = report.issues.slice(0, 20).map((issue) => ({
      severity: issue.severity,
      check: issue.check,
      owner: issue.owner,
      ...(issue.sceneId ? { scene: issue.sceneId } : {}),
      ...(issue.frame !== null ? { frame: issue.frame } : {}),
      message: plain(`${issue.what} Fix: ${issue.fix}`),
    }));
    this.emit({
      type: 'qc',
      format,
      verdict: report.blocked ? 'blocked' : report.verdict,
      routable: [...routable(report).values()].reduce((sum, each) => sum + each.length, 0),
      issues,
    });
  }

  delivered(version: number, variants: string[]) {
    this.emit({ type: 'delivered', version, variants });
  }

  error(code: string, message: string, stage: Stage | null, retryable: boolean) {
    this.emit({ type: 'error', code, message: plain(message), stage, retryable });
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    closeSync(this.fd);
  }
}
