import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { guardRun } from '../src/guard.ts';

class FakeStream extends EventEmitter {
  written: string[] = [];
  throws = false;
  write(chunk: string): boolean {
    if (this.throws) throw Object.assign(new Error('write EPIPE'), { code: 'EPIPE' });
    this.written.push(chunk);
    return true;
  }
}

class FakeProcess extends EventEmitter {
  ppid = 4242;
  stdout = new FakeStream();
  stderr = new FakeStream();
  exitCode: number | undefined;
  exit = vi.fn();
}

const guarded = () => {
  const proc = new FakeProcess();
  const controller = new AbortController();
  let clock = 0;
  const guard = guardRun(controller, { proc, now: () => clock, parentPollMs: 1000 });
  return { proc, controller, guard, later: (ms: number) => (clock += ms) };
};

afterEach(() => vi.useRealTimers());

describe('guardRun', () => {
  it('stops the run on a closed terminal, and never leaves without cleaning up', () => {
    const { proc, controller, guard, later } = guarded();
    for (let hangups = 0; hangups < 4; hangups += 1) {
      proc.emit('SIGHUP');
      later(2000);
    }
    expect(controller.signal.aborted).toBe(true);
    expect(proc.exit).not.toHaveBeenCalled();
    guard.dispose();
  });

  it.each(['SIGINT', 'SIGTERM', 'SIGQUIT'])('stops on %s, and leaves on the third', (signal) => {
    const { proc, controller, guard, later } = guarded();
    proc.emit(signal);
    expect(controller.signal.aborted).toBe(true);
    later(2000);
    proc.emit(signal);
    expect(proc.exit).not.toHaveBeenCalled();
    later(2000);
    proc.emit(signal);
    expect(proc.exit).toHaveBeenCalledWith(130);
    guard.dispose();
  });

  it('counts copies of one Ctrl-C that arrive together once', () => {
    const { proc, guard } = guarded();
    proc.emit('SIGINT');
    proc.emit('SIGINT');
    proc.emit('SIGINT');
    expect(proc.exit).not.toHaveBeenCalled();
    guard.dispose();
  });

  it.each(['stderr', 'stdout'] as const)(
    'stops the run when %s closes, and writes nothing after',
    (stream) => {
      const { proc, controller, guard } = guarded();
      proc[stream].emit('error', Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }));
      expect(controller.signal.aborted).toBe(true);
      const before = proc.stderr.written.length;
      if (stream === 'stderr') {
        guard.log('still cleaning up');
        expect(proc.stderr.written).toHaveLength(before);
      }
      guard.dispose();
    },
  );

  it('never throws from log, and stops the run when a write fails', () => {
    const { proc, controller, guard } = guarded();
    proc.stderr.throws = true;
    expect(() => guard.log('a line')).not.toThrow();
    expect(controller.signal.aborted).toBe(true);
    guard.dispose();
  });

  it('stops the run when its parent goes away', () => {
    vi.useFakeTimers();
    const { proc, controller, guard } = guarded();
    vi.advanceTimersByTime(3000);
    expect(controller.signal.aborted).toBe(false);
    proc.ppid = 1;
    vi.advanceTimersByTime(1000);
    expect(controller.signal.aborted).toBe(true);
    vi.advanceTimersByTime(10_000);
    expect(proc.exit).not.toHaveBeenCalled();
    guard.dispose();
  });

  it.each([
    ['an uncaught exception', 'uncaughtException', new Error('boom')],
    ['an unhandled rejection', 'unhandledRejection', new Error('boom')],
  ])('stops the run on %s, and leaves the cleanup to finish', (_name, event, error) => {
    const { proc, controller, guard } = guarded();
    proc.emit(event, error);
    expect(controller.signal.aborted).toBe(true);
    expect(proc.exitCode).toBe(1);
    expect(proc.exit).not.toHaveBeenCalled();
    guard.dispose();
  });
});

/** A child that guards a run whose cleanup writes a file, the way renderCampaign's finally does. */
const CHILD = path.join(import.meta.dirname, 'fixtures/guarded-run.ts');

function runChild(act: (child: ReturnType<typeof spawn>) => void) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'boiler-room-guard-'));
  const marker = path.join(dir, 'cleaned');
  const child = spawn(process.execPath, [CHILD, marker], { stdio: ['ignore', 'pipe', 'pipe'] });
  return new Promise<{ code: number | null; cleaned: boolean; marker: string }>((resolve) => {
    child.stderr?.once('data', () => act(child));
    child.on('close', (code) =>
      resolve({
        code,
        cleaned: existsSync(marker),
        marker: existsSync(marker) ? readFileSync(marker, 'utf8') : '',
      }),
    );
  });
}

describe('a guarded process', () => {
  it('cleans up when its stderr reader goes away', async () => {
    const result = await runChild((child) => child.stderr?.destroy());
    expect(result.cleaned).toBe(true);
    expect(result.marker).toContain('closed');
  });

  it('cleans up on SIGHUP', async () => {
    const result = await runChild((child) => child.kill('SIGHUP'));
    expect(result.cleaned).toBe(true);
    expect(result.marker).toContain('SIGHUP');
  });
});
