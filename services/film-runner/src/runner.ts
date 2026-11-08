/**
 * The runner: one launch on a film's computer, for one phase of one film.
 *
 * 1. Read and delete `bootstrap.json`. Turn swap on. Say hello, and read the instructions. Events
 *    a past launch left unconfirmed are resent only when they belong to this launch's phase; an
 *    old `runner.exit` is never resent, since it would end this launch's phase on the website.
 * 2. Write the approval or the note, and the launch's Naive key (if the website sent one) to a
 *    private file, then start the film command in its own process group.
 * 3. Follow its events file. Upload each artifact, then queue its event with the runner's own
 *    sequence number. Send the queue in order, in batches, retrying with backoff.
 * 4. Heartbeat every 30 s. Stop the film when the website says so, at the deadline, or when the
 *    website cannot be reached for 15 minutes: SIGTERM to its group, SIGKILL 60 s later.
 * 5. When the film command exits, send what is left (up to 2 minutes), post `runner.exit`, and exit
 *    with the film command's code, or the runner's own when the runner ended the run.
 *
 * The HMAC key is held in memory only. Nothing the runner logs or sends carries it. The Naive key
 * is on disk only while the film command runs, in `naive.env` (mode 600), and nowhere else.
 */
import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  statfsSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { freemem, loadavg, totalmem } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { CallAborted, FatalCallError, RunnerClient } from './client.ts';
import {
  BOOTSTRAP_PATH,
  type Bootstrap,
  CONTRACT_VERSION,
  clip,
  type EventsAnswer,
  FILM_EXIT,
  type FilmEvent,
  type HelloAnswer,
  type HelloEvent,
  type Instructions,
  MAX_EVENTS_PER_BATCH,
  type Phase,
  parseBootstrap,
  parseFilmEvent,
  parseInstructions,
  RUN_KEY_FILE_PATH,
  RUNNER_EXIT,
  type RunnerEvent,
  routes,
  type Stage,
  safeName,
  UPLOAD_KINDS,
  type UploadAnswer,
  type UploadKind,
  uploadPath,
} from './contract.ts';
import { filmCommandSpec, type RunnerConfig } from './film-command.ts';
import { Outbox, type Unnumbered } from './outbox.ts';
import { naiveKeyIn, Scrubber } from './scrub.ts';
import { EventTail } from './tail.ts';

export interface RunnerOptions {
  /** `~/br-run`. */
  runDir: string;
  config: RunnerConfig;
  fetch?: typeof fetch;
  log?: (line: string) => void;
  now?: () => number;
  heartbeatMs?: number;
  stopGraceMs?: number;
  drainMs?: number;
  unreachableMs?: number;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
  tailPollMs?: number;
  /** Turn swap on at start. Off in tests. */
  swapon?: boolean;
}

/** The batch size the runner sends. The contract allows up to 100. */
const BATCH = Math.min(50, MAX_EVENTS_PER_BATCH);

class UploadFailed extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export class Runner {
  private readonly options: RunnerOptions;
  private readonly runDir: string;
  private readonly filmDir: string;
  private readonly log: (line: string) => void;
  private readonly now: () => number;
  private readonly abort = new AbortController();
  /** Aborts hello and the instructions call when a stop comes before the film command starts. */
  private readonly startAbort = new AbortController();
  private scrubber = new Scrubber([]);
  private bootstrap!: Bootstrap;
  private client!: RunnerClient;
  private outbox!: Outbox;
  private phase: Phase = 'script';
  private child: ChildProcess | null = null;
  private killTimer: NodeJS.Timeout | undefined;
  private timers: NodeJS.Timeout[] = [];
  private stopping: { reason: string } | null = null;
  private fatal: FatalCallError | null = null;
  private uploadFailure: UploadFailed | null = null;
  private sender: Promise<void> | null = null;
  private processing: Promise<void> = Promise.resolve();
  private uploads: Record<string, { fileId: string; bytes: number; sha256: string }> = {};
  private lastStage: Stage | null = null;
  private seen = { stoppedError: false, error: false, scriptReady: false, delivered: false };
  /** `<runDir>/naive.env`: the launch's Naive key, while the film command runs. */
  private readonly keyFile: string;

  constructor(options: RunnerOptions) {
    this.options = options;
    this.runDir = options.runDir;
    this.filmDir = join(options.runDir, 'film');
    this.keyFile = join(options.runDir, basename(RUN_KEY_FILE_PATH));
    this.now = options.now ?? Date.now;
    const log = options.log ?? ((line: string) => console.log(line));
    this.log = (line) => log(this.scrubber.scrub(line));
  }

  /** Stops the film command and ends the run once it has exited. Safe to call more than once. */
  requestStop(reason: string) {
    if (this.stopping) return;
    this.stopping = { reason };
    this.log(`stop: ${reason}`);
    if (!this.child) this.startAbort.abort();
    const child = this.child;
    if (child?.pid && child.exitCode === null && child.signalCode === null) {
      signalGroup(child.pid, 'SIGTERM');
      this.killTimer = setTimeout(() => {
        if (child.pid && child.exitCode === null && child.signalCode === null) {
          this.log('stop: the film command did not exit in time; sending SIGKILL');
          signalGroup(child.pid, 'SIGKILL');
        }
      }, this.options.stopGraceMs ?? 60_000);
    }
  }

  async run(): Promise<number> {
    const started = this.now();
    mkdirSync(this.filmDir, { recursive: true });
    writeFileSync(join(this.runDir, 'runner.pid'), `${process.pid}\n`);
    // A key file a crashed launch left behind.
    this.removeKeyFile();
    try {
      this.bootstrap = this.readBootstrap();
    } catch (error) {
      this.log(`bootstrap: ${message(error)}`);
      return RUNNER_EXIT.badBootstrap;
    }
    const { filmId, runId } = this.bootstrap;
    this.scrubber = new Scrubber([
      this.bootstrap.key,
      this.bootstrap.naiveKey,
      naiveKeyIn(this.options.config.envFile),
    ]);
    const launch = this.nextLaunch();
    this.log(
      `run ${runId} of film ${filmId}, launch ${launch}, adapter ${this.options.config.adapter}`,
    );
    if (this.options.swapon !== false) this.swapOn();
    this.client = new RunnerClient({
      bootstrap: this.bootstrap,
      ...(this.options.fetch ? { fetch: this.options.fetch } : {}),
      now: this.now,
      log: this.log,
      ...(this.options.unreachableMs ? { unreachableMs: this.options.unreachableMs } : {}),
      ...(this.options.baseBackoffMs ? { baseBackoffMs: this.options.baseBackoffMs } : {}),
      ...(this.options.maxBackoffMs ? { maxBackoffMs: this.options.maxBackoffMs } : {}),
    });
    this.outbox = new Outbox(this.runDir);
    this.uploads = this.readUploads();
    // A past launch's `runner.exit` is never resent: the website would read it as this launch's.
    this.quarantine((event) => event.type === 'runner.exit', "a past launch's runner.exit");

    let instructions: Instructions;
    let phaseKnown = false;
    try {
      const hello = await this.client.json<HelloAnswer>(
        'POST',
        routes.hello(filmId),
        this.helloEvent(launch),
        { learnClock: true, signal: this.startAbort.signal },
      );
      this.log(`hello: the website has this run in phase ${hello.phase}`);
      if (PHASES_KNOWN.includes(hello.phase)) {
        this.phase = hello.phase;
        phaseKnown = true;
      }
      const raw = await this.client.json<unknown>('GET', routes.instructions(filmId), undefined, {
        signal: this.startAbort.signal,
      });
      instructions = parseInstructions(raw);
    } catch (error) {
      // Only after a hello does the website take events, and only then is the phase known.
      if (phaseKnown && !(error instanceof FatalCallError)) {
        this.dropOtherPhases();
        this.sender = this.sendLoop();
      }
      if (error instanceof FatalCallError) {
        this.log(`hello: ${error.message}`);
        this.fatal = error;
        return this.finish(error.exitCode, started);
      }
      if (error instanceof CallAborted || this.stopping) {
        return this.finish(RUNNER_EXIT.stopped, started);
      }
      this.log(`instructions: ${message(error)}`);
      this.pushError('bad_instructions', message(error), false);
      return this.finish(RUNNER_EXIT.badBootstrap, started);
    }
    this.phase = instructions.phase;
    // Events a past launch of another phase left unconfirmed belong to a phase that is over.
    this.dropOtherPhases();
    this.sender = this.sendLoop();
    this.log(
      `instructions: phase ${instructions.phase}, ${instructions.mode}, script v${instructions.scriptVersion}, up to $${instructions.maxCrewUsd.toFixed(2)}`,
    );
    if (instructions.stop || this.stopping) {
      this.pushError(
        'stopped',
        `Stopped before the crew started: ${this.stopping?.reason ?? 'the website asked'}.`,
        false,
      );
      return this.finish(RUNNER_EXIT.stopped, started);
    }

    if (this.options.config.adapter === 'film' && !this.bootstrap.naiveKey) {
      this.pushError(
        'no_naive_key',
        'The website sent no Naive key for the crew, so the film could not start.',
        false,
      );
      return this.finish(RUNNER_EXIT.badBootstrap, started);
    }

    const deadlineMs = Date.parse(instructions.deadlineAt) - this.client.serverMs();
    if (deadlineMs <= 0) {
      this.pushError('phase_timeout', 'The phase was past its deadline before it started.', false);
      return this.finish(RUNNER_EXIT.stopped, started);
    }
    this.timers.push(setTimeout(() => this.requestStop('the phase deadline'), deadlineMs));
    this.timers.push(setInterval(() => this.heartbeat(), this.options.heartbeatMs ?? 30_000));

    const exit = await this.runFilm(instructions, launch);
    const code = this.exitCode(exit);
    return this.finish(code, started, exit.signal);
  }

  // ---------------------------------------------------------------------------------------------

  private async runFilm(
    instructions: Instructions,
    launch: number,
  ): Promise<{ code: number | null; signal: NodeJS.Signals | null; spawnError?: Error }> {
    const approvalFile = join(this.runDir, 'approval.json');
    const reviseFile = join(this.runDir, 'revise.json');
    if (instructions.approval) {
      writeFileSync(approvalFile, `${JSON.stringify(instructions.approval, null, 2)}\n`);
    }
    if (instructions.revise) {
      writeFileSync(reviseFile, `${JSON.stringify(instructions.revise, null, 2)}\n`);
    }
    const eventsFile = join(this.filmDir, `events-${instructions.phase}-${launch}.jsonl`);
    // The film command reads its Naive key from BOILER_ROOM_ENV: this launch's file, never a key
    // kept in the snapshot.
    if (this.bootstrap.naiveKey) {
      writeFileSync(this.keyFile, `NAIVE_API_KEY=${this.bootstrap.naiveKey}\n`, { mode: 0o600 });
    }
    const spec = filmCommandSpec(
      { ...this.options.config, envFile: this.keyFile },
      {
        url: instructions.url,
        phase: instructions.phase,
        runDir: this.filmDir,
        eventsFile,
        ...(instructions.approval ? { approvalFile } : {}),
        ...(instructions.revise ? { reviseFile } : {}),
        maxUsd: instructions.maxCrewUsd,
      },
    );
    const tail = new EventTail(eventsFile, (line) => {
      this.processing = this.processing
        .then(() => this.handleLine(line))
        .catch((error) => this.log(`event: ${message(error)}`));
    });
    tail.start(this.options.tailPollMs ?? 1000);
    const logFd = openSync(join(this.runDir, 'film.log'), 'a');
    this.log(
      `film: starting the ${this.options.config.adapter} command for phase ${instructions.phase}`,
    );
    const exit = await new Promise<{
      code: number | null;
      signal: NodeJS.Signals | null;
      spawnError?: Error;
    }>((resolveExit) => {
      let settled = false;
      const settle = (value: {
        code: number | null;
        signal: NodeJS.Signals | null;
        spawnError?: Error;
      }) => {
        if (settled) return;
        settled = true;
        resolveExit(value);
      };
      const child = spawn(spec.command, spec.args, {
        cwd: spec.cwd,
        env: spec.env,
        detached: true,
        stdio: ['ignore', logFd, logFd],
      });
      this.child = child;
      if (child.pid) writeFileSync(join(this.runDir, 'film.pid'), `${child.pid}\n`);
      child.on('error', (error) => settle({ code: 127, signal: null, spawnError: error }));
      child.on('exit', (code, signal) => settle({ code, signal }));
      // A stop that came in while the command was starting.
      if (this.stopping && child.pid) signalGroup(child.pid, 'SIGTERM');
    });
    closeSync(logFd);
    this.removeKeyFile();
    if (this.killTimer) clearTimeout(this.killTimer);
    tail.stop();
    await this.processing;
    this.log(
      `film: the command exited with ${exit.code ?? exit.signal}${exit.spawnError ? ` (${exit.spawnError.message})` : ''}`,
    );
    return exit;
  }

  /** Decides the run's exit code once the film command has exited, and reports why. */
  private exitCode(exit: {
    code: number | null;
    signal: NodeJS.Signals | null;
    spawnError?: Error;
  }) {
    if (this.fatal) return this.fatal.exitCode;
    if (this.uploadFailure) return RUNNER_EXIT.uploadFailed;
    const complete = this.phase === 'script' ? this.seen.scriptReady : this.seen.delivered;
    if (exit.code === FILM_EXIT.ok && complete) return RUNNER_EXIT.ok;
    if (this.stopping) {
      if (!this.seen.stoppedError) {
        this.pushError('stopped', `Stopped: ${this.stopping.reason}.`, false);
      }
      return RUNNER_EXIT.stopped;
    }
    if (exit.spawnError) {
      this.pushError(
        'film_command_missing',
        `The film command could not start: ${exit.spawnError.message}`,
        false,
      );
      return FILM_EXIT.failed;
    }
    if (exit.code === FILM_EXIT.ok) {
      const missing = this.phase === 'script' ? 'script_ready' : 'delivered';
      this.pushError('phase_incomplete', `The film command exited 0 without ${missing}.`, false);
      return FILM_EXIT.failed;
    }
    const code = exit.code ?? 128 + signalNumber(exit.signal);
    if (!this.seen.error) {
      this.pushError(
        'film_command_failed',
        `The film command exited with ${exit.code ?? exit.signal}. ${this.filmLogTail()}`,
        false,
      );
    }
    return code;
  }

  /** Posts `runner.exit`, sends what is left for up to `drainMs`, and returns `code`. */
  private async finish(code: number, started: number, signal: NodeJS.Signals | null = null) {
    for (const timer of this.timers) clearTimeout(timer);
    this.removeKeyFile();
    if (this.outbox && !this.fatal) {
      this.outbox.push({
        type: 'runner.exit',
        at: this.isoNow(),
        phase: this.phase,
        exitCode: code,
        signal,
        durationMs: Math.round(this.now() - started),
      });
      if (this.sender) await this.drain(this.options.drainMs ?? 120_000);
    }
    this.abort.abort();
    await this.sender?.catch(() => undefined);
    if (this.outbox && this.outbox.size > 0) {
      this.log(`exit: ${this.outbox.size} events were not confirmed; a relaunch resends them`);
    }
    this.log(`exit: ${code}`);
    return code;
  }

  private drain(timeoutMs: number): Promise<void> {
    return new Promise((resolveDrain) => {
      const done = () => {
        clearTimeout(timer);
        unsubscribe();
        resolveDrain();
      };
      const timer = setTimeout(done, timeoutMs);
      const unsubscribe = this.outbox.onChange(() => {
        if (this.outbox.size === 0 || this.fatal) done();
      });
      if (this.outbox.size === 0 || this.fatal) done();
      this.sender?.then(done, done);
    });
  }

  // ---------------------------------------------------------------------------------------------

  private async sendLoop(): Promise<void> {
    const { filmId, runId } = this.bootstrap;
    for (;;) {
      if (this.abort.signal.aborted) return;
      const batch = this.outbox.pending().slice(0, BATCH);
      if (batch.length === 0) {
        await this.waitForChange();
        continue;
      }
      try {
        const answer = await this.client.json<EventsAnswer>(
          'POST',
          routes.events(filmId),
          { runId, events: batch },
          { signal: this.abort.signal },
        );
        const last = batch[batch.length - 1];
        if (last) this.outbox.ack(last.seq);
        if (answer.control?.stop) this.requestStop(answer.control.reason ?? 'the website asked');
      } catch (error) {
        if (error instanceof CallAborted) return;
        if (error instanceof FatalCallError) {
          this.log(`send: ${error.message}`);
          if (error.status === 409 && error.code === 'wrong_state') {
            // The run has moved on without these. Kept aside, never resent by a later launch.
            const seqs = new Set(batch.map((event) => event.seq));
            this.quarantine((event) => seqs.has(event.seq), 'the website no longer accepts them');
          }
          this.fatal = error;
          this.requestStop(error.code);
          return;
        }
        this.log(`send: ${message(error)}`);
      }
    }
  }

  private waitForChange(): Promise<void> {
    return new Promise((resolveWait) => {
      const finish = () => {
        unsubscribe();
        this.abort.signal.removeEventListener('abort', finish);
        resolveWait();
      };
      const unsubscribe = this.outbox.onChange(finish);
      this.abort.signal.addEventListener('abort', finish, { once: true });
    });
  }

  private heartbeat() {
    if (this.outbox.has((event) => event.type === 'runner.heartbeat')) return;
    this.outbox.push({
      type: 'runner.heartbeat',
      at: this.isoNow(),
      phase: this.phase,
      filmPid: this.child?.pid ?? null,
      load1: Math.round((loadavg()[0] ?? 0) * 100) / 100,
      memUsedMb: Math.round((totalmem() - freemem()) / 1024 / 1024),
    });
  }

  // ---------------------------------------------------------------------------------------------

  private async handleLine(line: string) {
    const parsed = parseFilmEvent(line);
    if (!parsed.ok) {
      this.log(`event: skipped a line the contract refuses (${parsed.reason})`);
      return;
    }
    const event = parsed.event;
    const base = { at: event.at, phase: this.phase };
    switch (event.type) {
      case 'artifact': {
        const stored = await this.uploadOrFail(
          event.path,
          event.kind,
          event.contentType,
          event.version,
          event.variantKey,
        );
        if (!stored) return;
        this.outbox.push({
          ...base,
          type: 'artifact',
          kind: event.kind,
          fileId: stored.fileId,
          name: stored.name,
          version: event.version,
          ...(event.variantKey !== undefined ? { variantKey: event.variantKey } : {}),
          bytes: stored.bytes,
          sha256: stored.sha256,
        });
        return;
      }
      case 'script_ready': {
        const stored = await this.uploadOrFail(
          event.campaignPath,
          'campaign',
          'application/json',
          event.version,
        );
        if (!stored) return;
        this.seen.scriptReady = true;
        this.outbox.push({
          ...base,
          type: 'script_ready',
          version: event.version,
          campaignFileId: stored.fileId,
          unconfirmedClaims: event.unconfirmedClaims,
        });
        return;
      }
      case 'stage':
        this.lastStage = event.stage;
        this.outbox.push({ ...base, ...strip(event), message: this.text(event.message) });
        return;
      case 'decision':
        this.outbox.push({
          ...base,
          ...strip(event),
          message: this.text(event.message),
          ...(event.detail ? { detail: boundedDetail(event.detail) } : {}),
        });
        return;
      case 'error':
        this.seen.error = true;
        if (event.code === 'stopped') this.seen.stoppedError = true;
        this.outbox.push({
          ...base,
          ...strip(event),
          stage: event.stage ?? this.lastStage,
          message: this.text(event.message),
        });
        return;
      case 'delivered':
        this.seen.delivered = true;
        this.outbox.push({ ...base, ...strip(event) });
        return;
      case 'qc':
        this.outbox.push({
          ...base,
          ...strip(event),
          issues: event.issues
            .slice(0, 20)
            .map((issue) => ({ ...issue, message: this.text(issue.message) })),
        });
        return;
      default:
        this.outbox.push({ ...base, ...strip(event) } as Unnumbered<RunnerEvent>);
    }
  }

  private async uploadOrFail(
    relPath: string,
    kind: UploadKind,
    contentType: string,
    version: number,
    variant?: string,
  ) {
    if (this.uploadFailure || this.fatal) return undefined;
    try {
      return await this.upload(relPath, kind, contentType, version, variant);
    } catch (error) {
      if (error instanceof CallAborted) return undefined;
      if (error instanceof FatalCallError && error.exitCode !== RUNNER_EXIT.refused) {
        this.fatal = error;
        this.requestStop(error.code);
        return undefined;
      }
      const failure =
        error instanceof UploadFailed ? error : new UploadFailed('upload_failed', message(error));
      this.uploadFailure = failure;
      this.pushError(
        failure.code,
        `Could not store ${basename(relPath)}: ${failure.message}`,
        false,
      );
      this.requestStop(failure.code);
      return undefined;
    }
  }

  private async upload(
    relPath: string,
    kind: UploadKind,
    contentType: string,
    version: number,
    variant?: string,
  ) {
    const root = realpathSync(this.filmDir);
    const target = resolve(this.filmDir, relPath);
    if (!existsSync(target))
      throw new UploadFailed('artifact_missing', `${relPath} does not exist.`);
    const real = realpathSync(target);
    if (!real.startsWith(root + sep)) {
      throw new UploadFailed('artifact_outside_run_dir', `${relPath} is outside the run dir.`);
    }
    const limit = UPLOAD_KINDS[kind].maxBytes;
    const size = statSync(real).size;
    if (size > limit) {
      throw new UploadFailed(
        'file_too_large',
        `${relPath} is ${size} bytes; ${kind} allows ${limit}.`,
      );
    }
    const bytes = readFileSync(real);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const name = safeName(basename(relPath));
    const cacheKey = `${kind}|${version}|${variant ?? ''}|${relPath}|${sha256}`;
    const cached = this.uploads[cacheKey];
    if (cached) return { ...cached, name };
    const answer = await this.client.call<UploadAnswer>(
      'PUT',
      uploadPath(this.bootstrap.filmId, {
        kind,
        version,
        ...(variant !== undefined ? { variant } : {}),
        name,
      }),
      bytes,
      { attempts: 3, contentType, signal: this.abort.signal },
    );
    if (typeof answer.fileId !== 'string')
      throw new UploadFailed('upload_failed', 'No file id came back.');
    const stored = { fileId: answer.fileId, bytes: bytes.byteLength, sha256 };
    this.uploads[cacheKey] = stored;
    writeFileSync(join(this.runDir, 'uploads.json'), `${JSON.stringify(this.uploads, null, 2)}\n`);
    this.log(`upload: ${kind} ${name} (${bytes.byteLength} bytes) as ${answer.fileId}`);
    return { ...stored, name };
  }

  // ---------------------------------------------------------------------------------------------

  /** Moves unconfirmed events aside (`outbox.dropped.jsonl`), so no launch sends them. */
  private quarantine(predicate: (event: RunnerEvent) => boolean, why: string) {
    const dropped = this.outbox.drop(predicate);
    if (dropped.length > 0) {
      this.log(`outbox: set aside ${dropped.length} unconfirmed events (${why})`);
    }
  }

  private dropOtherPhases() {
    if (!this.outbox) return;
    const phase = this.phase;
    this.quarantine(
      (event) => event.phase !== null && event.phase !== phase,
      `they belong to a phase other than ${phase}`,
    );
  }

  private removeKeyFile() {
    try {
      unlinkSync(this.keyFile);
    } catch {
      // Not there.
    }
  }

  private pushError(code: string, text: string, retryable: boolean) {
    if (!this.outbox) return;
    this.outbox.push({
      type: 'error',
      at: this.isoNow(),
      phase: this.phase,
      code,
      message: this.text(text),
      stage: this.lastStage,
      retryable,
    });
  }

  private text(value: string): string {
    return clip(this.scrubber.scrub(value));
  }

  private isoNow(): string {
    return new Date(this.client ? this.client.serverMs() : this.now()).toISOString();
  }

  private readBootstrap(): Bootstrap {
    // `<home>/br-run/bootstrap.json`, where the website writes it (`BOOTSTRAP_PATH`).
    const file = join(this.runDir, basename(BOOTSTRAP_PATH));
    if (!existsSync(file)) throw new Error(`${file} is missing.`);
    const text = readFileSync(file, 'utf8');
    // Deleted before anything else, so no checkpoint of this disk holds the key.
    unlinkSync(file);
    return parseBootstrap(JSON.parse(text));
  }

  private nextLaunch(): number {
    const file = join(this.runDir, 'launches');
    let count = 0;
    try {
      count = Number.parseInt(readFileSync(file, 'utf8'), 10) || 0;
    } catch {
      count = 0;
    }
    writeFileSync(file, `${count + 1}\n`);
    return count + 1;
  }

  private readUploads() {
    try {
      return JSON.parse(readFileSync(join(this.runDir, 'uploads.json'), 'utf8'));
    } catch {
      return {};
    }
  }

  private helloEvent(launch: number): HelloEvent {
    const config = this.options.config;
    return {
      seq: this.outbox.takeSeq(),
      at: new Date(this.now()).toISOString(),
      type: 'runner.hello',
      phase: null,
      contract: CONTRACT_VERSION,
      commit: config.runnerCommit,
      filmCommit: config.filmCommit,
      adapter: config.adapter,
      node: process.version,
      freeDiskGb: freeDiskGb(this.runDir),
      swapMb: swapMb(),
      launch,
    };
  }

  private swapOn() {
    const swapfile = this.options.config.swapfile;
    if (!swapfile) return;
    try {
      if (readFileSync('/proc/swaps', 'utf8').includes(swapfile)) return;
    } catch {
      return;
    }
    const result = spawnSync('sudo', ['-n', 'swapon', swapfile], {
      encoding: 'utf8',
      timeout: 20_000,
    });
    this.log(
      result.status === 0 ? `swap: turned on ${swapfile}` : `swap: could not turn on ${swapfile}`,
    );
  }

  private filmLogTail(): string {
    try {
      const text = readFileSync(join(this.runDir, 'film.log'), 'utf8');
      return text.slice(-400).trim();
    } catch {
      return '';
    }
  }
}

const PHASES_KNOWN: readonly unknown[] = ['script', 'render', 'all'];

/** Drops the film command's own `v` and `seq`; the runner numbers events itself. */
function strip<E extends FilmEvent>(event: E): Omit<E, 'v' | 'seq'> {
  const { v: _v, seq: _seq, ...rest } = event;
  return rest;
}

function boundedDetail(detail: Record<string, unknown>): Record<string, unknown> {
  const text = JSON.stringify(detail);
  return text.length <= 4096 ? detail : { truncated: true };
}

function signalGroup(pid: number, signal: NodeJS.Signals) {
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      // Already gone.
    }
  }
}

const SIGNALS: Record<string, number> = { SIGHUP: 1, SIGINT: 2, SIGKILL: 9, SIGTERM: 15 };
const signalNumber = (signal: NodeJS.Signals | null) => (signal ? (SIGNALS[signal] ?? 0) : 0);

function freeDiskGb(path: string): number {
  try {
    const stats = statfsSync(path);
    return Math.round(((stats.bavail * stats.bsize) / 1e9) * 10) / 10;
  } catch {
    return 0;
  }
}

function swapMb(): number {
  try {
    const kb = /^SwapTotal:\s+(\d+) kB/m.exec(readFileSync('/proc/meminfo', 'utf8'))?.[1];
    return kb ? Math.round(Number(kb) / 1024) : 0;
  } catch {
    return 0;
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
