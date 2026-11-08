/**
 * `pnpm film <url> --phase script|render|all`: the film command as the film runner calls it, by
 * the contract in `services/film-runner/src/contract.ts` (`filmCommandArgs`, `FILM_EXIT`,
 * `FilmEvent`). One run dir holds a film across both phases:
 *
 * - `script`: the Researcher, then the Director with its checks. The script goes to the top of
 *   the run dir as `campaign.json`, version 1, and `script_ready` says so. Exit 0.
 * - `render`: the Art Director, the render, Quality Check and delivery of exactly the cut in
 *   `--approval`, from the run dir the script phase left. The claims the customer confirmed are
 *   marked approved before the render gate. Exit 2 when the approval is for another version.
 * - `all`: both, with no approval between: a GTM sample film, 16:9, Short.
 *
 * Every event goes to `--events` as it happens (`events.ts`); the decisions also go to
 * `decisions.json`. `--no-sync` never creates or changes an agent or pushes a skill, and stops
 * with `agent_drift` before anything is spent when a deployed agent is not this checkout's.
 * SIGTERM and SIGINT stop every live session and exit 143, after `error stopped`.
 *
 * Exit codes: 0 the phase finished (`script_ready`, or `delivered`); 1 the crew failed; 2 bad
 * input; 4 the film's cost cap; 143 stopped.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { parseArgs } from 'node:util';
import {
  FILM_EXIT,
  FORMATS,
  type Format,
  PHASES,
  type Phase,
  UPLOAD_KINDS,
  type UploadKind,
  variantKey,
} from '@boiler-room/film-runner/contract';
import type { AgentDefinition } from '../define.ts';
import { artDirector, director, qualityCheck, researcher } from '../definitions/index.ts';
import type { CloseClient } from '../naive/session.ts';
import type { Drift } from '../sync.ts';
import { EventLog, type FilmEvents } from './events.ts';
import type { FilmFormat, FilmLength } from './order.ts';
import {
  type Approval,
  BadApproval,
  checkApproval,
  DECISIONS_FILE,
  type FilmCrew,
  type FilmManifest,
  type FilmOptions,
  FLOORS,
  MANIFEST_FILE,
  readScript,
  renderApproved,
  SCRIPT_CAMPAIGN,
  writeScript,
} from './run.ts';

export interface ContractArgs {
  url: string;
  phase: Phase;
  /** Absolute, and the same for both phases of a film. */
  runDir: string;
  eventsFile: string;
  approvalFile?: string;
  reviseFile?: string;
  maxUsd: number;
  render: 'local' | 'naive';
  /** False with `--no-sync`. */
  sync: boolean;
  length?: FilmLength;
  /** The cuts the script is written for. Default 16:9. */
  formats?: FilmFormat[];
}

export const CONTRACT_USAGE = `Usage: pnpm film <url> --phase script|render|all --run-dir <abs dir> --events <file>
  --max-usd <n> [--render local|naive] [--no-sync] [--approval <file>] [--length short|standard]
  [--formats 16:9,9:16,1:1]`;

/** True when these arguments ask for the film runner's contract rather than `pnpm film` alone. */
export const isContractCall = (argv: readonly string[]) =>
  argv.some((arg) => arg === '--phase' || arg.startsWith('--phase='));

/** The arguments, or why they cannot be run. */
export function parseContractArgs(argv: readonly string[]): ContractArgs | { problem: string } {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      strict: true,
      options: {
        phase: { type: 'string' },
        'run-dir': { type: 'string' },
        events: { type: 'string' },
        approval: { type: 'string' },
        revise: { type: 'string' },
        'max-usd': { type: 'string' },
        render: { type: 'string' },
        'no-sync': { type: 'boolean' },
        length: { type: 'string' },
        formats: { type: 'string' },
      },
    });
  } catch (cause) {
    return { problem: cause instanceof Error ? cause.message : String(cause) };
  }
  const { values, positionals } = parsed;
  const text = (name: string) => {
    const value = values[name];
    return typeof value === 'string' ? value : undefined;
  };
  const url = positionals[0] ?? '';
  const phase = text('phase') as Phase;
  const runDir = text('run-dir') ?? '';
  const eventsFile = text('events') ?? '';
  const maxUsd = Number(text('max-usd'));
  const render = (text('render') ?? 'naive') as ContractArgs['render'];
  if (positionals.length !== 1 || !/^https?:\/\//.test(url))
    return { problem: 'Give one http(s) URL.' };
  if (!PHASES.includes(phase)) return { problem: `--phase must be one of ${PHASES.join(', ')}.` };
  if (!isAbsolute(runDir)) return { problem: '--run-dir must be an absolute path.' };
  if (!eventsFile) return { problem: '--events names the events file.' };
  if (!(Number.isFinite(maxUsd) && maxUsd >= 0 && maxUsd <= 25))
    return { problem: '--max-usd must be a number of dollars from 0 to 25.' };
  if (render !== 'local' && render !== 'naive')
    return { problem: '--render must be local or naive.' };
  if (phase === 'render' && !text('approval'))
    return { problem: '--phase render needs --approval.' };
  const length = text('length') as FilmLength | undefined;
  if (length !== undefined && length !== 'short' && length !== 'standard')
    return { problem: '--length must be short or standard.' };
  const formats = text('formats')
    ?.split(',')
    .map((each) => each.trim()) as FilmFormat[] | undefined;
  if (
    formats &&
    (formats.length === 0 || !formats.every((each) => FORMATS.includes(each as Format)))
  )
    return { problem: `--formats must list some of ${FORMATS.join(', ')}.` };
  return {
    url,
    phase,
    runDir,
    eventsFile,
    maxUsd,
    render,
    sync: values['no-sync'] !== true,
    ...(text('approval') ? { approvalFile: text('approval') } : {}),
    ...(text('revise') ? { reviseFile: text('revise') } : {}),
    ...(length ? { length } : {}),
    ...(formats ? { formats } : {}),
  };
}

export interface CommandDeps {
  crew: FilmCrew & { stop?: () => Promise<void> };
  sessions: CloseClient;
  /** For `--no-sync`: how the deployed agents differ from this checkout's definitions. */
  checkAgents: (definitions: readonly AgentDefinition[]) => Promise<Drift[]>;
  clock?: () => Date;
  log?: (line: string) => void;
  /** Aborted on SIGTERM or SIGINT. */
  signal?: AbortSignal;
  /** How long a stop waits for the crew to close its sessions before it exits. Default 40 s. */
  stopGraceMs?: number;
}

/** The agents each phase runs, checked before anything is spent with `--no-sync`. */
const AGENTS: Record<Phase, readonly AgentDefinition[]> = {
  script: [researcher, director],
  render: [artDirector, qualityCheck],
  all: [researcher, director, artDirector, qualityCheck],
};

const usd = (micro: number) => `$${(micro / 1e6).toFixed(2)}`;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms).unref?.());

/** Stops with an error event and an exit code. */
class Stop extends Error {
  readonly code: string;
  readonly exit: number;
  readonly retryable: boolean;
  constructor(code: string, message: string, exit: number, retryable = false) {
    super(message);
    this.code = code;
    this.exit = exit;
    this.retryable = retryable;
  }
}

function readApproval(file: string | undefined): Approval {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(file ?? '', 'utf8'));
  } catch {
    throw new Stop('bad_input', 'The approval could not be read.', FILM_EXIT.badInput);
  }
  const record = (value ?? {}) as Partial<Approval>;
  const ok =
    Number.isInteger(record.version) &&
    (record.hookId === null || typeof record.hookId === 'string') &&
    (record.ctaId === null || typeof record.ctaId === 'string') &&
    Array.isArray(record.formats) &&
    Array.isArray(record.confirmedClaimIds) &&
    record.confirmedClaimIds.every((id) => typeof id === 'string');
  if (!ok)
    throw new Stop(
      'bad_input',
      'The approval is not in the shape the contract gives.',
      FILM_EXIT.badInput,
    );
  return record as Approval;
}

/** The poster: the frame Quality Check rested on nearest the middle of the film. */
function posterOf(qcDir: string): string | undefined {
  if (!existsSync(qcDir)) return undefined;
  const rests = readdirSync(qcDir)
    .flatMap((name) => {
      const frame = /^rest-(\d+)\.png$/.exec(name)?.[1];
      return frame ? [{ name, frame: Number(frame) }] : [];
    })
    .sort((a, b) => a.frame - b.frame);
  return rests.length
    ? join(qcDir, (rests[Math.floor(rests.length / 2)] as { name: string }).name)
    : undefined;
}

/**
 * Names each delivered file for the runner to upload, then says `delivered`. Files are kept to
 * what the website shows: per format the MP4, a poster, the contact sheet and the QC report; then
 * the decisions and the manifest. Every one is checked against its upload kind's limit first,
 * since a refused upload stops the film.
 */
function announceDelivery(
  events: FilmEvents,
  runDir: string,
  manifest: FilmManifest,
  approval: Approval,
): string[] {
  const variants: string[] = [];
  const offer = (kind: UploadKind, file: string, contentType: string, variant?: string) => {
    if (!existsSync(file)) return;
    const size = statSync(file).size;
    if (size > UPLOAD_KINDS[kind].maxBytes) {
      if (kind === 'mp4')
        throw new Stop(
          'film_too_large',
          `The film is ${(size / 2 ** 20).toFixed(1)} MiB, over what the website takes.`,
          FILM_EXIT.failed,
        );
      return;
    }
    events.artifact(kind, file, contentType, approval.version, variant);
  };
  for (const format of approval.formats) {
    const film = manifest.films?.[format];
    if (!film) continue;
    const slug = format.replace(':', 'x');
    const variant = variantKey(format, approval.hookId, approval.ctaId);
    offer('mp4', join(runDir, film.file), 'video/mp4', variant);
    variants.push(variant);
    if (film.qcDir) {
      const qcDir = join(runDir, film.qcDir);
      const poster = posterOf(qcDir);
      const sheet = join(qcDir, 'contact-sheet.png');
      mkdirSync(join(runDir, 'delivered'), { recursive: true });
      if (poster) {
        const target = join(runDir, 'delivered', `poster-${slug}.png`);
        copyFileSync(poster, target);
        offer('still', target, 'image/png');
      }
      if (existsSync(sheet)) {
        const target = join(runDir, 'delivered', `contact-sheet-${slug}.png`);
        copyFileSync(sheet, target);
        offer('quality', target, 'image/png');
      }
    }
    if (film.qcReport) offer('quality', join(runDir, film.qcReport), 'application/json');
  }
  offer('decisions', join(runDir, DECISIONS_FILE), 'application/json');
  offer('manifest', join(runDir, MANIFEST_FILE), 'application/json');
  return variants;
}

/** Runs one phase. Returns the exit code; every outcome but success also writes an `error`. */
export async function runFilmCommand(args: ContractArgs, deps: CommandDeps): Promise<number> {
  const clock = deps.clock ?? (() => new Date());
  mkdirSync(args.runDir, { recursive: true });
  const events = new EventLog(args.eventsFile, args.runDir, { clock });
  const say = deps.log ?? (() => {});
  const filmDeps = {
    crew: deps.crew,
    sessions: deps.sessions,
    clock,
    log: say,
    events,
    ...(deps.signal ? { signal: deps.signal } : {}),
  };

  const work = async (): Promise<number> => {
    if (args.reviseFile)
      throw new Stop(
        'bad_input',
        'A script cannot be rewritten from a note yet: approve this version, or start a new film.',
        FILM_EXIT.badInput,
      );
    // The render phase reads its script, its approval and their cut before anything else.
    let approval: Approval | undefined;
    const script = args.phase === 'render' ? readScript(args.runDir) : undefined;
    if (args.phase === 'render') {
      approval = readApproval(args.approvalFile);
      if (!script || !existsSync(join(args.runDir, SCRIPT_CAMPAIGN)))
        throw new Stop('bad_input', 'This film has no script to render yet.', FILM_EXIT.badInput);
      try {
        checkApproval(
          script,
          JSON.parse(readFileSync(join(args.runDir, SCRIPT_CAMPAIGN), 'utf8')),
          approval,
        );
      } catch (cause) {
        if (cause instanceof BadApproval)
          throw new Stop(cause.code, cause.message, FILM_EXIT.badInput);
        throw cause;
      }
    }
    if (!args.sync) {
      const drift = await deps.checkAgents(AGENTS[args.phase]);
      if (drift.length > 0)
        throw new Stop(
          'agent_drift',
          `The crew on Naive is not the crew this film computer was built with (${drift.map((each) => `${each.name}: ${each.problem}`).join('; ')}). Nothing was spent. The agents must be synced before films run.`,
          FILM_EXIT.failed,
        );
    }

    const sample = args.phase === 'all';
    const formats: FilmFormat[] = approval?.formats ?? args.formats ?? ['16:9'];
    const floors = { render: args.render === 'local' ? 0 : FLOORS.render };
    const perFormat = floors.render + FLOORS['quality-check'];
    const need =
      args.phase === 'render'
        ? formats.length * perFormat
        : FLOORS.research + FLOORS.director + (sample ? perFormat : 0);
    const maxMicroUsd = Math.round(args.maxUsd * 1e6);
    if (maxMicroUsd < need)
      throw new Stop(
        'cost_cap',
        `This part of the film needs at least ${usd(need)} of the crew budget, and ${usd(maxMicroUsd)} is left.`,
        FILM_EXIT.costCap,
      );
    const options: FilmOptions & { dir: string } = {
      url: args.url,
      length: args.length ?? script?.length ?? (sample ? 'short' : 'standard'),
      format: formats[0] ?? '16:9',
      sample: script?.sample ?? sample,
      maxMicroUsd,
      outRoot: dirname(args.runDir),
      dir: args.runDir,
      floors,
    };
    if (sample && options.length !== 'short')
      throw new Stop('bad_input', 'A sample film is Short.', FILM_EXIT.badInput);

    if (args.phase !== 'render') {
      const written = await writeScript({ ...options, formats }, filmDeps);
      if (!written.script)
        throw new Stop(
          written.capped ? 'cost_cap' : 'script_failed',
          `No script was written: ${written.failure ?? 'the crew stopped'}`,
          written.capped ? FILM_EXIT.costCap : FILM_EXIT.failed,
        );
      if (args.phase === 'script') return FILM_EXIT.ok;
      approval = {
        version: written.script.version,
        hookId: null,
        ctaId: null,
        formats,
        confirmedClaimIds: [],
      };
      return deliver(
        await renderApproved(options, approval, filmDeps, written.script, 'sample'),
        approval,
      );
    }
    return deliver(
      await renderApproved(
        options,
        approval as Approval,
        filmDeps,
        script as NonNullable<typeof script>,
      ),
      approval as Approval,
    );
  };

  const deliver = (result: Awaited<ReturnType<typeof renderApproved>>, approval: Approval) => {
    if (result.failure)
      throw new Stop(
        result.capped ? 'cost_cap' : 'film_failed',
        `No film was delivered: ${result.failure}`,
        result.capped ? FILM_EXIT.costCap : FILM_EXIT.failed,
      );
    const variants = announceDelivery(events, args.runDir, result.manifest, approval);
    events.delivered(approval.version, variants);
    return FILM_EXIT.ok;
  };

  const stopped = new Promise<number>((resolve) => {
    const onAbort = async () => {
      events.error('stopped', 'The film was stopped before it finished.', events.lastStage, false);
      events.close();
      say('stopping: closing every live session');
      await Promise.race([
        (deps.crew.stop?.() ?? Promise.resolve()).catch(() => undefined),
        sleep(deps.stopGraceMs ?? 40_000),
      ]);
      resolve(FILM_EXIT.stopped);
    };
    if (deps.signal?.aborted) void onAbort();
    else deps.signal?.addEventListener('abort', () => void onAbort(), { once: true });
  });

  const done = work().then(
    (code) => code,
    (cause: unknown) => {
      const stop =
        cause instanceof Stop
          ? cause
          : new Stop(
              'crew_failed',
              `The crew stopped: ${cause instanceof Error ? cause.message : String(cause)}`,
              FILM_EXIT.failed,
            );
      events.error(stop.code, stop.message, events.lastStage, stop.retryable);
      return stop.exit;
    },
  );
  // Once stopped, the stop is the answer, whatever the crew does on its way out.
  const code = await Promise.race([
    done.then((value) => (deps.signal?.aborted ? stopped : value)),
    stopped,
  ]);
  events.close();
  return code;
}

/**
 * Makes SIGTERM and SIGINT stop the film: `controller` is aborted, which stops every live session
 * and ends `runFilmCommand` with 143, and the process exits 143 after 55 s whatever happens, as
 * the runner sends SIGKILL 60 s after its SIGTERM.
 */
export function stopOnSignals(controller: AbortController, say: (line: string) => void = () => {}) {
  const onSignal = (signal: string) => {
    if (controller.signal.aborted) return;
    say(`${signal}: stopping the film`);
    controller.abort();
    setTimeout(() => process.exit(FILM_EXIT.stopped), 55_000).unref();
  };
  process.on('SIGINT', () => onSignal('SIGINT'));
  process.on('SIGTERM', () => onSignal('SIGTERM'));
}
