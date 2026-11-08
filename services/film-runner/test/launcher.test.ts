import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createFilmComputer,
  deleteSnapshot,
  destroyComputer,
  exec,
  execDetached,
  filmComputerName,
  LAUNCH_COMMAND,
  launchRunner,
  MAX_EXEC_MS,
  NaiveApiError,
  naiveApi,
  pauseComputer,
  pollDetached,
  resumeComputer,
  STOP_COMMAND,
  writeBootstrap,
} from '../src/launcher.ts';
import { FILM_ID, RUN_ID, tempDir } from './helpers.ts';

interface Call {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown> | undefined;
}

function fakeNaive(
  answer: (call: Call) => { status?: number; body: unknown } = () => ({ body: {} }),
) {
  const calls: Call[] = [];
  const api = naiveApi({
    key: 'sk_live_website_scoped_key_123456',
    fetch: (async (input: string, init: RequestInit) => {
      const call: Call = {
        method: init.method ?? 'GET',
        url: String(input),
        headers: init.headers as Record<string, string>,
        body: init.body ? JSON.parse(String(init.body)) : undefined,
      };
      calls.push(call);
      const { status = 200, body } = answer(call);
      return new Response(JSON.stringify(body), { status });
    }) as typeof fetch,
  });
  return { api, calls };
}

const KEY = 'f'.repeat(64);

describe('the website’s Naive calls', () => {
  it('create the film computer from a snapshot, once per run and attempt', async () => {
    const { api, calls } = fakeNaive(() => ({ body: { id: 'cmp_1', status: 'creating' } }));
    await createFilmComputer(api, {
      env: 'staging',
      filmId: FILM_ID,
      runId: RUN_ID,
      attempt: 1,
      snapshotId: 'snp_abc',
    });
    const [call] = calls;
    expect(call?.url).toBe('https://api.vetta.sh/v1/computers');
    expect(call?.body).toEqual({
      name: `br-film-staging-${FILM_ID}`,
      vcpu: 4,
      memory_mb: 8192,
      disk_gb: 20,
      snapshot_id: 'snp_abc',
    });
    expect(call?.headers['idempotency-key']).toBe(`${RUN_ID}:1`);
    expect(call?.headers.authorization).toBe('Bearer sk_live_website_scoped_key_123456');
    expect(call?.headers['vetta-version']).toBe('2026-09-30');
    expect(() => filmComputerName('Prod!', FILM_ID)).toThrow();
  });

  it('never ask for more than 600 s on one exec', async () => {
    const { api, calls } = fakeNaive(() => ({ body: { exit_code: 0, stdout: '', stderr: '' } }));
    await exec(api, 'cmp_1', 'true', 3_600_000);
    await exec(api, 'cmp_1', 'true');
    expect(calls.map((call) => call.body?.timeout_ms)).toEqual([MAX_EXEC_MS, 30_000]);
    expect(() => exec(api, 'cmp_1', 'true', 0)).toThrow();
    expect(() => exec(api, 'cmp_1', 'true', 1.5)).toThrow();
  });

  it('send the run key only through fs/write, never in a command', async () => {
    const { api, calls } = fakeNaive((call) =>
      call.url.endsWith('/exec')
        ? { body: { exit_code: 0, stdout: 'launched\n', stderr: '' } }
        : { body: {} },
    );
    await writeBootstrap(api, 'cmp_1', '/home/naive', {
      v: 1,
      filmId: FILM_ID,
      runId: RUN_ID,
      callbackBase: 'https://site.test/api/runner/v1',
      key: KEY,
      issuedAt: 1,
    });
    await launchRunner(api, 'cmp_1');
    expect(
      calls.map((call) => call.url.replace('https://api.vetta.sh/v1/computers/cmp_1/', '')),
    ).toEqual(['fs/mkdir', 'fs/write', 'exec']);
    expect(calls[0]?.body).toEqual({ path: '/home/naive/br-run' });
    expect(calls[1]?.body?.path).toBe('/home/naive/br-run/bootstrap.json');
    expect(String(calls[1]?.body?.content)).toContain(KEY);
    expect(String(calls[2]?.body?.command)).not.toContain(KEY);
    expect(calls[2]?.body?.timeout_ms).toBe(30_000);
  });

  it('fail a launch that did not print launched', async () => {
    const { api } = fakeNaive(() => ({
      body: { exit_code: 1, stdout: '', stderr: 'flock: not found' },
    }));
    await expect(launchRunner(api, 'cmp_1')).rejects.toThrow(/did not launch/);
  });

  it('pause, resume and destroy, treating a computer or snapshot that is gone as done', async () => {
    const { api, calls } = fakeNaive((call) =>
      call.method === 'DELETE'
        ? {
            status: 404,
            body: { error: { code: 'not_found', message: 'gone', request_id: 'req_1' } },
          }
        : { body: { id: 'cmp_1', status: 'paused' } },
    );
    await pauseComputer(api, 'cmp_1');
    await resumeComputer(api, 'cmp_1');
    await destroyComputer(api, 'cmp_1');
    await deleteSnapshot(api, 'snp_1');
    expect(
      calls.map((call) => `${call.method} ${call.url.replace('https://api.vetta.sh', '')}`),
    ).toEqual([
      'POST /v1/computers/cmp_1/pause',
      'POST /v1/computers/cmp_1/resume',
      'DELETE /v1/computers/cmp_1',
      'DELETE /v1/snapshots/snp_1',
    ]);
    expect(calls.every((call) => call.method === 'GET' || call.headers['idempotency-key'])).toBe(
      true,
    );
  });

  it('pass on other errors with their code', async () => {
    const { api } = fakeNaive(() => ({
      status: 409,
      body: {
        error: { code: 'state_conflict', message: 'a live computer uses it', request_id: 'req_2' },
      },
    }));
    const error = await deleteSnapshot(api, 'snp_1').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(NaiveApiError);
    expect(error).toMatchObject({ status: 409, code: 'state_conflict', requestId: 'req_2' });
  });

  it('start long scripts detached and read their state', async () => {
    const { api, calls } = fakeNaive((call) =>
      call.url.endsWith('/exec')
        ? {
            body: {
              exit_code: 0,
              stdout: call.body?.command?.toString().includes('setsid')
                ? 'started\n'
                : 'DONE 0\nsetup: done\n',
              stderr: '',
            },
          }
        : { body: {} },
    );
    await execDetached(api, 'cmp_1', '/home/naive', 'br-build', 'setup', 'echo hi');
    expect(calls[1]?.body).toEqual({ path: '/home/naive/br-build/setup.sh', content: 'echo hi' });
    expect(String(calls[2]?.body?.command)).toContain('setsid -f');
    expect(await pollDetached(api, 'cmp_1', 'br-build', 'setup')).toEqual({
      done: true,
      exitCode: 0,
      tail: 'setup: done',
    });
  });
});

const hasTools = spawnSync('sh', ['-c', 'command -v setsid && command -v flock']).status === 0;

describe.skipIf(!hasTools)('the launch command, in a real shell', () => {
  function fakeHome() {
    const home = tempDir('runner-home-');
    mkdirSync(join(home, 'film-runner', 'src'), { recursive: true });
    // A runner that holds the lock for a while and says it ran.
    writeFileSync(
      join(home, 'film-runner', 'src', 'main.ts'),
      "require('node:fs').appendFileSync(process.env.HOME + '/br-run/ran', 'x'); setTimeout(() => {}, 1500);\n",
    );
    return home;
  }

  const run = (home: string, command: string) =>
    new Promise<{ ms: number; stdout: string }>((resolve) => {
      const started = Date.now();
      const child = spawn('bash', ['-c', command], {
        env: { ...process.env, HOME: home },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      child.stdout.on('data', (chunk) => {
        stdout += String(chunk);
      });
      child.on('exit', () => resolve({ ms: Date.now() - started, stdout }));
    });

  it('returns at once while the runner keeps going, and a second launch is refused by the lock', async () => {
    const home = fakeHome();
    const first = await run(home, LAUNCH_COMMAND);
    expect(first.stdout.trim()).toBe('launched');
    expect(first.ms).toBeLessThan(1000);
    await new Promise((resolve) => setTimeout(resolve, 300));
    const second = await run(home, LAUNCH_COMMAND);
    expect(second.stdout.trim()).toBe('launched');
    await new Promise((resolve) => setTimeout(resolve, 1800));
    expect(readFileSync(join(home, 'br-run', 'ran'), 'utf8')).toBe('x');
    expect(existsSync(join(home, 'br-run', 'runner.log'))).toBe(true);
  });

  it('stop.sh says so when no runner is running', async () => {
    const home = tempDir('runner-home-');
    mkdirSync(join(home, 'film-runner', 'bin'), { recursive: true });
    writeFileSync(
      join(home, 'film-runner', 'bin', 'stop.sh'),
      readFileSync(new URL('../bin/stop.sh', import.meta.url), 'utf8'),
    );
    const result = await run(home, STOP_COMMAND);
    expect(result.stdout.trim()).toBe('no runner');
  });
});
