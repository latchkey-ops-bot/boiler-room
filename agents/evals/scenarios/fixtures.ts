import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { GITHUB_OWNER, REPOS } from '../../src/company/github.ts';
import { GithubApi, type PullRequest } from '../github.ts';

/** The helper an engineer adds, and the lead reviews: tiny, pure, and easy to test. */
export const HELPER_PATH = 'packages/motion/src/core/clamp-unit.ts';
export const HELPER_TEST_PATH = 'packages/motion/test/clamp-unit.test.ts';

export const HELPER = `/** Clamps a value to the unit interval: below 0 is 0, above 1 is 1. Pure, for any frame. */
export function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}
`;

/** The same helper with its lower bound missing, so its own test fails. */
export const BROKEN_HELPER = `/** Clamps a value to the unit interval: below 0 is 0, above 1 is 1. Pure, for any frame. */
export function clampUnit(value: number): number {
  return value > 1 ? 1 : value;
}
`;

export const HELPER_TEST = `import { describe, expect, it } from 'vitest';
import { clampUnit } from '../src/core/clamp-unit.ts';

describe('clampUnit', () => {
  it('keeps a value inside the unit interval', () => {
    expect(clampUnit(0.25)).toBe(0.25);
    expect(clampUnit(0)).toBe(0);
    expect(clampUnit(1)).toBe(1);
  });

  it('clamps a value below 0 or above 1', () => {
    expect(clampUnit(-0.5)).toBe(0);
    expect(clampUnit(1.5)).toBe(1);
  });
});
`;

/**
 * A pull request as an engineer would open it, into a practice base branch cut from `dev`, so a
 * merge by the lead under test lands on the practice base and never on `dev`.
 */
export async function helperPullRequest(input: {
  run: string;
  slug: string;
  helper: string;
  cardTitle: string;
}): Promise<Record<string, string>> {
  const api = new GithubApi('engineering');
  const base = `eval/${input.run}-dev`;
  const head = `feat/${input.slug}-1`;
  await api.createBranch(REPOS.code.name, base, 'dev');
  await api.createBranch(REPOS.code.name, head, base);
  await api.putFile(
    REPOS.code.name,
    head,
    HELPER_PATH,
    input.helper,
    'feat(motion): add clampUnit',
  );
  const sha = await api.putFile(
    REPOS.code.name,
    head,
    HELPER_TEST_PATH,
    HELPER_TEST,
    'test(motion): cover clampUnit',
  );
  const pr = await api.openPr(REPOS.code.name, {
    head,
    base,
    title: 'feat(motion): add the clampUnit helper',
    body: `Card: ${input.cardTitle}\n\nAdds \`clampUnit\` in \`${HELPER_PATH}\` and its test in \`${HELPER_TEST_PATH}\`.\n\nChecks: pnpm lint, pnpm typecheck and pnpm test pass.`,
  });
  return {
    pr_url: pr.url,
    pr_number: String(pr.number),
    pr_head: head,
    pr_base: base,
    pr_sha: sha,
  };
}

/** A spec on its own branch of the design repo, with an open pull request into `dev`. */
export async function specPullRequest(input: {
  slug: string;
  content: string;
}): Promise<Record<string, string>> {
  const api = new GithubApi('design');
  const head = `spec/${input.slug}`;
  await api.createBranch(REPOS.design.name, head, 'dev');
  const sha = await api.putFile(
    REPOS.design.name,
    head,
    `specs/${input.slug}.md`,
    input.content,
    `spec: ${input.slug}`,
  );
  const pr = await api.openPr(REPOS.design.name, {
    head,
    base: 'dev',
    title: `spec: ${input.slug}`,
    body: `The spec for ${input.slug}.`,
  });
  return { spec_pr_url: pr.url, spec_commit: sha, spec_branch: head };
}

export interface LocalChecks {
  pass: boolean;
  steps: { step: string; pass: boolean; tail: string }[];
}

/** The repo whose own branches the harness runs checks on. A fork's branch never qualifies. */
export const CODE_REPO = `${GITHUB_OWNER}/${REPOS.code.name}`;

/**
 * Whether the harness may run a pull request's code at all: its head is a branch of the code repo
 * itself, not of a fork, and it was opened by `login`, the account the engineering token belongs
 * to. Both repos are public, so anyone can open a pull request from a fork with the same branch
 * name as an eval's, and GitHub serves a fork's head at `pull/<n>/head` like any other.
 */
export function ownPullRequest(pr: PullRequest, login: string): boolean {
  return Boolean(login) && pr.head.repo?.full_name === CODE_REPO && pr.user.login === login;
}

/**
 * The variables git gets on this machine for the clone, fetch and checkout. Git runs none of the
 * pull request's code: hooks and config are never cloned. `PATH` to find git, a `HOME` in the
 * scratch folder (so no global git config or credential file is read), `CI` and
 * `GIT_TERMINAL_PROMPT=0` so nothing waits on a prompt, and
 * `npm_config_manage_package_manager_versions=false`, which stops pnpm from downloading and running
 * whatever pnpm version the pull request's `packageManager` names. The docker client gets the same.
 */
export function checkEnvironment(home: string, path = process.env.PATH ?? ''): NodeJS.ProcessEnv {
  return {
    PATH: path,
    HOME: home,
    CI: '1',
    GIT_TERMINAL_PROMPT: '0',
    npm_config_manage_package_manager_versions: 'false',
  };
}

/**
 * The image the pull request's code runs in: the repo's Node and its pinned pnpm, and nothing else.
 * Built once on this machine, from a base pinned by digest, and reused by its tag.
 */
export const PNPM_VERSION = '10.30.3';
export const CHECK_IMAGE = `br-eval-checks:node24-pnpm${PNPM_VERSION}`;
export const CHECK_IMAGE_DOCKERFILE = [
  'FROM node:24-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e',
  `RUN npm install --global pnpm@${PNPM_VERSION} && npm cache clean --force`,
  '',
].join('\n');

/** The only variables the container gets. Its `HOME` is in the scratch folder, as is everything it can see. */
export const SANDBOX_ENV: Readonly<Record<string, string>> = {
  HOME: '/work/home',
  CI: '1',
  npm_config_manage_package_manager_versions: 'false',
};

/** One command of the checks: what it is called in the report, the program and its arguments. */
export interface CheckStep {
  step: string;
  command: string;
  args: string[];
  /**
   * `host` is git on this machine, which runs none of the pull request's code. `sandbox` is the
   * pull request's code, which runs only in a throwaway container (`sandboxArgs`).
   */
  where: 'host' | 'sandbox';
  /** A sandbox step that may reach the network: only the install, which fetches packages. */
  network?: boolean;
}

/** The pull request to check, as the harness vetted it: its number, head branch and head commit. */
export interface CheckTarget {
  number: number;
  branch: string;
  sha: string;
}

/**
 * The checks, in order, on one pull request's head commit. The clone, fetch and checkout are git on
 * this machine; it fetches the head branch of the code repo itself, never a `pull/<n>/head` ref,
 * which also serves forks, and checks out the head commit the harness vetted. Everything after
 * runs the pull request's code, so it runs in the sandbox. The install runs no lifecycle script
 * (`--ignore-scripts`) and no `.pnpmfile.cjs` (`--ignore-pnpmfile`, which pnpm otherwise runs even
 * with scripts off); it is the one step with a network, to fetch packages. The tests, typecheck
 * and Biome have none. The changed files come from the pull request, so they follow `--` and can
 * never be read as options.
 */
export function checkSteps(
  target: CheckTarget,
  files: readonly string[],
  url = `https://github.com/${CODE_REPO}`,
): CheckStep[] {
  const { number, branch, sha } = target;
  if (!Number.isInteger(number) || number < 1) throw new Error(`Not a pull request: ${number}`);
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(branch) || branch.includes('..')) {
    throw new Error(`Not a branch name to fetch: ${branch}`);
  }
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error(`Not a commit: ${sha}`);
  return [
    {
      step: 'clone',
      command: 'git',
      args: ['clone', '--quiet', '--depth', '50', '--branch', 'dev', '--', url, '.'],
      where: 'host',
    },
    {
      step: 'fetch the pull request',
      command: 'git',
      args: [
        'fetch',
        '--quiet',
        'origin',
        `+refs/heads/${branch}:refs/remotes/origin/pr-${number}`,
      ],
      where: 'host',
    },
    {
      step: 'check out its head',
      command: 'git',
      args: ['checkout', '--quiet', '--detach', sha],
      where: 'host',
    },
    {
      step: 'install',
      command: 'pnpm',
      args: ['install', '--frozen-lockfile', '--ignore-scripts', '--ignore-pnpmfile', '--silent'],
      where: 'sandbox',
      network: true,
    },
    {
      step: 'motion tests',
      command: 'pnpm',
      args: ['--filter', '@boiler-room/motion', 'test'],
      where: 'sandbox',
    },
    {
      step: 'motion typecheck',
      command: 'pnpm',
      args: ['--filter', '@boiler-room/motion', 'typecheck'],
      where: 'sandbox',
    },
    {
      step: 'biome on the changed files',
      command: 'pnpm',
      args: ['exec', 'biome', 'check', '--', ...files],
      where: 'sandbox',
    },
  ];
}

/**
 * The `docker run` arguments for one sandbox step. The container sees the scratch folder at `/work`
 * and nothing else of this machine: not the home folder, so not `~/.boiler-room.env`, whatever path
 * the code tries. It runs as this machine's user (so the scratch folder can be removed after),
 * with every capability dropped, no privilege gain, no network unless the step is the install,
 * bounded memory and processes, and only `SANDBOX_ENV`.
 */
export function sandboxArgs(
  step: CheckStep,
  scratch: string,
  name: string,
  user = `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`,
): string[] {
  if (step.where !== 'sandbox') throw new Error(`${step.step} does not run in the sandbox.`);
  if (!/^\/[A-Za-z0-9._/-]+$/.test(scratch)) throw new Error(`Not a scratch folder: ${scratch}`);
  return [
    'run',
    '--rm',
    '--init',
    '--name',
    name,
    '--user',
    user,
    '--network',
    step.network ? 'bridge' : 'none',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges',
    '--memory',
    '4g',
    '--pids-limit',
    '1024',
    '--mount',
    `type=bind,source=${scratch},target=/work`,
    '--workdir',
    '/work/repo',
    ...Object.entries(SANDBOX_ENV).flatMap(([key, value]) => ['--env', `${key}=${value}`]),
    CHECK_IMAGE,
    step.command,
    ...step.args,
  ];
}

type Exec = (
  command: string,
  args: readonly string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; timeout: number; input?: string },
) => string;

const execChecked: Exec = (command, args, options) =>
  execFileSync(command, args, {
    ...options,
    encoding: 'utf8',
    stdio: [options.input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
  });

/**
 * Runs the motion tests, the motion typecheck and Biome on a pull request's head, because the repo
 * has no CI. Only a pull request `ownPullRequest` accepts is run at all; any other is refused
 * before anything is cloned. The pull request's code runs only in the sandbox; if docker is not
 * there, the checks fail, and nothing runs on this machine instead. Each run starts with an empty
 * pnpm store in its scratch `HOME`, so the install fetches every package; that is the price of
 * not sharing a store with this machine.
 */
export function checkPullRequest(
  pr: PullRequest,
  files: readonly string[],
  login: string,
  exec: Exec = execChecked,
): LocalChecks {
  if (!ownPullRequest(pr, login)) {
    return {
      pass: false,
      steps: [
        {
          step: 'refused',
          pass: false,
          tail: `not run: its head is ${pr.head.repo?.full_name ?? 'a deleted fork'}:${pr.head.ref} by ${pr.user.login}, not a branch of ${CODE_REPO} by ${login || 'the engineering account'}`,
        },
      ],
    };
  }
  const target = { number: pr.number, branch: pr.head.ref, sha: pr.head.sha };
  const scratch = mkdtempSync(join(tmpdir(), 'br-eval-pr-'));
  const home = join(scratch, 'home');
  const dir = join(scratch, 'repo');
  mkdirSync(home);
  mkdirSync(dir);
  const env = checkEnvironment(home);
  const steps: LocalChecks['steps'] = [];
  const names: string[] = [];
  const attempt = (step: string, command: string, args: readonly string[], input?: string) => {
    try {
      const out = exec(command, args, { cwd: dir, env, timeout: 8 * 60_000, input });
      steps.push({ step, pass: true, tail: out.trim().split('\n').slice(-3).join(' | ') });
      return true;
    } catch (error) {
      const failure = error as { stdout?: string; stderr?: string; message?: string };
      const tail = `${failure.stdout ?? ''}\n${failure.stderr ?? failure.message ?? ''}`.trim();
      steps.push({ step, pass: false, tail: tail.split('\n').slice(-6).join(' | ') });
      return false;
    }
  };
  const run = (step: CheckStep) => {
    if (step.where === 'host') return attempt(step.step, step.command, step.args);
    const name = `${basename(scratch)}-${names.length}`.toLowerCase();
    names.push(name);
    return attempt(step.step, 'docker', sandboxArgs(step, scratch, name));
  };
  const image = () => {
    try {
      exec('docker', ['image', 'inspect', '--format', '{{.Id}}', CHECK_IMAGE], {
        cwd: dir,
        env,
        timeout: 60_000,
      });
      return true;
    } catch {
      return attempt(
        'build the sandbox image',
        'docker',
        ['build', '--quiet', '--tag', CHECK_IMAGE, '-'],
        CHECK_IMAGE_DOCKERFILE,
      );
    }
  };
  try {
    const all = checkSteps(target, files);
    const ok = image() && all.every(run);
    return { pass: ok, steps };
  } finally {
    if (names.length > 0) {
      try {
        exec('docker', ['rm', '--force', ...names], { cwd: dir, env, timeout: 60_000 });
      } catch {
        // `--rm` removed each container that exited; this only stops one a timeout left running.
      }
    }
    rmSync(scratch, { recursive: true, force: true });
  }
}
