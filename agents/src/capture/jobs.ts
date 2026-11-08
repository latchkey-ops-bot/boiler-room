import { spawn, spawnSync } from 'node:child_process';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

/**
 * Long steps run in the background, because a bash call on the agent's computer is killed after
 * about 30 seconds. `start` launches one detached job and returns at once; `wait` blocks for up to
 * 25 seconds and prints the job's summary when it is done. One job runs at a time, since one
 * browser is all a 1 GiB machine holds.
 */

export const DONE = 'BR_JOB_DONE';

interface JobFile {
  cmd: string;
  args: string[];
  pid: number;
  log: string;
  summary: string;
  started: string;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function jobPaths(base: string) {
  const dir = join(base, 'jobs');
  return { dir, current: join(dir, 'current.json') };
}

function readJob(base: string): JobFile | undefined {
  const { current } = jobPaths(base);
  if (!existsSync(current)) return undefined;
  return JSON.parse(readFileSync(current, 'utf8')) as JobFile;
}

function logDone(log: string): boolean {
  return existsSync(log) && readFileSync(log, 'utf8').includes(DONE);
}

export function startJob(
  base: string,
  script: string,
  cmd: string,
  args: string[],
  summary: string,
): void {
  const running = readJob(base);
  if (running && alive(running.pid) && !logDone(running.log)) {
    console.log(
      `A ${running.cmd} job is already running (pid ${running.pid}). Run: node ${script} wait`,
    );
    process.exitCode = 1;
    return;
  }
  // A browser left behind by an earlier job would hold most of the memory. Only on the agent's
  // own computer: on a developer machine other programs own their browsers.
  if (process.env.BR_LOCAL !== '1')
    spawnSync('pkill', ['-f', 'chrome-headless-shell'], { stdio: 'ignore' });
  const { dir, current } = jobPaths(base);
  mkdirSync(dir, { recursive: true });
  rmSync(summary, { force: true });
  const log = join(dir, `${cmd}.log`);
  const fd = openSync(log, 'w');
  const child = spawn(process.execPath, [script, '__run', cmd, ...args], {
    detached: true,
    stdio: ['ignore', fd, fd],
    cwd: base,
  });
  child.unref();
  closeSync(fd);
  const job: JobFile = {
    cmd,
    args,
    pid: child.pid ?? -1,
    log,
    summary,
    started: new Date().toISOString(),
  };
  writeFileSync(current, JSON.stringify(job, null, 1));
  console.log(`Started ${cmd} in the background (pid ${job.pid}). Now run: node ${script} wait`);
}

export async function waitJob(base: string, script: string, seconds = 25): Promise<void> {
  const job = readJob(base);
  if (!job) {
    console.log('No job has been started.');
    process.exitCode = 1;
    return;
  }
  const deadline = Date.now() + seconds * 1000;
  for (;;) {
    const text = existsSync(job.log) ? readFileSync(job.log, 'utf8') : '';
    const doneLine = text.split('\n').find((line) => line.startsWith(DONE));
    if (doneLine) {
      if (existsSync(job.summary)) console.log(readFileSync(job.summary, 'utf8'));
      else console.log(text.split('\n').slice(-40).join('\n'));
      console.log(doneLine);
      if (!/ ok$/.test(doneLine.trim())) process.exitCode = 1;
      return;
    }
    if (!alive(job.pid)) {
      console.log(text.split('\n').slice(-30).join('\n'));
      console.log(
        `${DONE} ${job.cmd} failed: the job stopped without finishing. Fix the cause above and start it again.`,
      );
      process.exitCode = 1;
      return;
    }
    if (Date.now() > deadline) {
      const tail = text.trimEnd().split('\n').slice(-3).join('\n');
      console.log(`${tail}\n${job.cmd} is still running. Run: node ${script} wait`);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
}
