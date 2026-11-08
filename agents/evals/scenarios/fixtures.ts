import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GITHUB_OWNER, REPOS } from '../../src/company/github.ts';
import { GithubApi } from '../github.ts';

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

/**
 * The only variables a pull request's checks get. They run code an eval agent wrote, so they get
 * nothing from this shell, where the founder's keys live: `PATH` to find git, node and pnpm, a
 * `HOME` in the scratch folder (so `~` holds no credential file and pnpm's store and cache start
 * empty there), `CI` and `GIT_TERMINAL_PROMPT=0` so nothing waits on a prompt, and
 * `npm_config_manage_package_manager_versions=false`, which stops pnpm from downloading and running
 * whatever pnpm version the pull request's `packageManager` names.
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

/** One command of the checks: what it is called in the report, the program and its arguments. */
export interface CheckStep {
  step: string;
  command: string;
  args: string[];
}

/**
 * The checks, in order, on pull request `number`. The install runs no lifecycle script: pnpm 10
 * already skips dependency build scripts unless a package is allowed, esbuild is ignored in
 * `pnpm-workspace.yaml`, and the one other script in the tree, workerd's, only the web app's tests
 * need; these checks run motion's tests, its typecheck and Biome. `--ignore-scripts` makes that
 * hold for the workspace's own packages too. The changed files come from the pull request, so they
 * follow `--` and can never be read as options.
 */
export function checkSteps(
  number: number,
  files: readonly string[],
  url = `https://github.com/${GITHUB_OWNER}/${REPOS.code.name}`,
): CheckStep[] {
  if (!Number.isInteger(number) || number < 1) throw new Error(`Not a pull request: ${number}`);
  return [
    {
      step: 'clone',
      command: 'git',
      args: ['clone', '--quiet', '--depth', '50', '--branch', 'dev', '--', url, '.'],
    },
    {
      step: 'fetch the pull request',
      command: 'git',
      args: ['fetch', '--quiet', 'origin', `pull/${number}/head:pr`],
    },
    { step: 'check out its head', command: 'git', args: ['checkout', '--quiet', 'pr'] },
    {
      step: 'install',
      command: 'pnpm',
      args: ['install', '--frozen-lockfile', '--ignore-scripts', '--silent'],
    },
    { step: 'motion tests', command: 'pnpm', args: ['--filter', '@boiler-room/motion', 'test'] },
    {
      step: 'motion typecheck',
      command: 'pnpm',
      args: ['--filter', '@boiler-room/motion', 'typecheck'],
    },
    {
      step: 'biome on the changed files',
      command: 'pnpm',
      args: ['exec', 'biome', 'check', '--', ...files],
    },
  ];
}

type Exec = (
  command: string,
  args: readonly string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; timeout: number },
) => string;

const execChecked: Exec = (command, args, options) =>
  execFileSync(command, args, {
    ...options,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

/**
 * Runs the motion tests, the motion typecheck and Biome on a pull request's head, in a fresh
 * clone on this machine, because the repo has no CI. Nothing here holds a token, and the checks see
 * only `checkEnvironment`. Each run starts with an empty pnpm store in its scratch `HOME`, so the
 * install fetches every package; that is the price of not sharing a store with this machine.
 */
export function checkPullRequest(
  number: number,
  files: readonly string[],
  exec: Exec = execChecked,
): LocalChecks {
  const scratch = mkdtempSync(join(tmpdir(), 'br-eval-pr-'));
  const home = join(scratch, 'home');
  const dir = join(scratch, 'repo');
  mkdirSync(home);
  mkdirSync(dir);
  const env = checkEnvironment(home);
  const steps: LocalChecks['steps'] = [];
  const run = ({ step, command, args }: CheckStep) => {
    try {
      const out = exec(command, args, { cwd: dir, env, timeout: 8 * 60_000 });
      steps.push({ step, pass: true, tail: out.trim().split('\n').slice(-3).join(' | ') });
      return true;
    } catch (error) {
      const failure = error as { stdout?: string; stderr?: string; message?: string };
      const tail = `${failure.stdout ?? ''}\n${failure.stderr ?? failure.message ?? ''}`.trim();
      steps.push({ step, pass: false, tail: tail.split('\n').slice(-6).join(' | ') });
      return false;
    }
  };
  try {
    const ok = checkSteps(number, files).every(run);
    return { pass: ok, steps };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
