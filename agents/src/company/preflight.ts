import { readSecret } from '../naive/client.ts';
import { GITHUB_OWNER, REPO_OF, REPOS, TOKENS, type TokenName } from './github.ts';

/**
 * What the spec needs from GitHub before the company runs on its own, checked from this machine:
 * each token writes to its own repo (docs/company/README.md section 6), and `main` and `dev` of both
 * repos carry the section 5 C rules. Agents hold the tokens with bash and open egress, so a token
 * that reaches both repos, or a branch with no rules, is bounded by prompts alone. The first is an
 * accepted risk (`OTHER_REPO_REACH_ACCEPTED`); the second is a gap.
 *
 * Nothing here changes GitHub. A token cannot fix either gap: re-minting a token and adding a ruleset
 * are the founder's, in GitHub's settings.
 */

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

/** The rule types of the `protect-main` and `protect-dev` rulesets (spec section 5 C). */
export const REQUIRED_RULES = ['deletion', 'non_fast_forward', 'pull_request'] as const;
export const PROTECTED_BRANCHES = ['main', 'dev'] as const;

/**
 * Branches whose pull requests need a person's approval. None: by the founder's ruling of
 * 2026-11-07, releases are autonomous, so `main` and `dev` both take pull requests with 0 approvals.
 * The `pull_request` rule still leaves a pull request behind for every change.
 */
export const APPROVAL_BRANCHES = [] as const;

/**
 * Both tokens can push to both repos. The founder decided to accept that risk rather than re-mint
 * the tokens per repo, so a token that reaches the other company repo is reported as accepted, not
 * as a gap. It is still checked and still printed on every run: prompts are what keep engineering
 * off the design repo and design off the code repo. A token that cannot reach its own repo, or
 * whose reach GitHub does not prove, stays a gap.
 */
export const OTHER_REPO_REACH_ACCEPTED = true;

export interface TokenReach {
  token: TokenName;
  repo: string;
  /** `null` when GitHub's answer proved neither. */
  can_push: boolean | null;
  expected: boolean;
}

export interface BranchRules {
  repo: string;
  branch: string;
  /** Required rule types the branch lacks, or `null` when the rules could not be read. */
  missing: string[] | null;
  /**
   * Approvals its `pull_request` rule requires, the highest when several rulesets apply, or `null`
   * when it has no such rule or the rules could not be read.
   */
  approvals: number | null;
}

export interface GithubReport {
  reach: TokenReach[];
  rules: BranchRules[];
  /** One line per way GitHub differs from the spec. Empty means ready. */
  gaps: string[];
  /**
   * One line per rule read that failed after every retry. Unknown is not a gap: the rulesets may be
   * intact, and GitHub's answer proved nothing either way. Run the check again.
   */
  unknown: string[];
  /** One line per known difference the founder accepted. Printed, never a gap. */
  accepted: string[];
}

/**
 * Whether a token can push to a repo. GitHub serves the `git-receive-pack` ref advertisement, which
 * every push starts with, only to a credential that can write; anyone else gets 401, 403 or 404.
 * The token goes in a request header, never in a command line or a log.
 */
export async function canPush(
  token: string,
  repoName: string,
  fetchFn: Fetch = fetch,
): Promise<boolean | null> {
  const url = `https://github.com/${GITHUB_OWNER}/${repoName}.git/info/refs?service=git-receive-pack`;
  const basic = Buffer.from(`${GITHUB_OWNER}:${token}`).toString('base64');
  const response = await fetchFn(url, {
    headers: { Authorization: `Basic ${basic}` },
    redirect: 'manual',
  });
  const body = await response.text();
  if (response.status === 200 && body.includes('report-status')) return true;
  if ([401, 403, 404].includes(response.status)) return false;
  return null;
}

interface Rule {
  type?: string;
  parameters?: { required_approving_review_count?: number };
}

/**
 * How long to wait before each retry of a rules read, in milliseconds: four tries in all. The
 * endpoint is read without a token, and `company:status` could not read it on 3 of 10 runs on
 * 2026-11-08 while the rulesets were intact, so one failed answer proves nothing.
 */
export const RULES_RETRY_MS = [1_000, 3_000, 9_000] as const;

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export type RulesRead =
  | ({ ok: true } & Omit<BranchRules, 'repo' | 'branch'>)
  | { ok: false; tries: number; reason: string };

/** Why one answer of the rules endpoint was not the rules. */
function failure(response: Response): string {
  const remaining = response.headers.get('x-ratelimit-remaining');
  const reset = Number(response.headers.get('x-ratelimit-reset'));
  if (remaining === '0' && reset > 0) {
    return `HTTP ${response.status}, GitHub's rate limit for unauthenticated reads is used up until ${new Date(reset * 1000).toISOString()}`;
  }
  return `HTTP ${response.status}`;
}

/**
 * The rules on a branch, from GitHub's public rules endpoint: the required rule types it lacks, and
 * how many approvals its `pull_request` rule requires. A failed read, a thrown fetch or any answer
 * other than 200 with a list, is tried again after each of `delays`, and reported with its last
 * reason when every try failed.
 */
export async function readBranchRules(
  repoName: string,
  branch: string,
  fetchFn: Fetch = fetch,
  delays: readonly number[] = RULES_RETRY_MS,
  sleep: (ms: number) => Promise<void> = wait,
): Promise<RulesRead> {
  const url = `https://api.github.com/repos/${GITHUB_OWNER}/${repoName}/rules/branches/${branch}`;
  let reason = 'no answer';
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    if (attempt > 0) await sleep(delays[attempt - 1] ?? 0);
    try {
      const response = await fetchFn(url, { headers: { Accept: 'application/vnd.github+json' } });
      if (response.status !== 200) {
        reason = failure(response);
        continue;
      }
      const rules = (await response.json()) as unknown;
      if (!Array.isArray(rules)) {
        reason = 'an answer that is not a list of rules';
        continue;
      }
      const types = new Set((rules as Rule[]).map((rule) => rule.type));
      const counts = (rules as Rule[])
        .filter((rule) => rule.type === 'pull_request')
        .map((rule) => rule.parameters?.required_approving_review_count ?? 0);
      return {
        ok: true,
        missing: REQUIRED_RULES.filter((type) => !types.has(type)),
        approvals: counts.length ? Math.max(...counts) : null,
      };
    } catch (error) {
      reason = error instanceof Error ? error.message : String(error);
    }
  }
  return { ok: false, tries: delays.length + 1, reason };
}

/** `readBranchRules`, as the rules alone, or `null` when they could not be read. */
export async function branchRules(
  repoName: string,
  branch: string,
  fetchFn: Fetch = fetch,
  delays: readonly number[] = RULES_RETRY_MS,
): Promise<Omit<BranchRules, 'repo' | 'branch'> | null> {
  const read = await readBranchRules(repoName, branch, fetchFn, delays);
  return read.ok ? { missing: read.missing, approvals: read.approvals } : null;
}

/** The required rule types a branch lacks, or `null` when the rules could not be read. */
export async function missingRules(
  repoName: string,
  branch: string,
  fetchFn: Fetch = fetch,
  delays: readonly number[] = RULES_RETRY_MS,
): Promise<string[] | null> {
  return (await branchRules(repoName, branch, fetchFn, delays))?.missing ?? null;
}

/** Checks both tokens against both repos, and the rules on `main` and `dev` of both repos. */
export async function githubPreflight(
  read: (name: string) => string = readSecret,
  fetchFn: Fetch = fetch,
  delays: readonly number[] = RULES_RETRY_MS,
): Promise<GithubReport> {
  const repos = Object.values(REPOS).map((repo) => repo.name);
  const reach: TokenReach[] = [];
  for (const token of Object.keys(TOKENS) as TokenName[]) {
    const value = read(TOKENS[token]);
    for (const repo of repos) {
      const can_push = await canPush(value, repo, fetchFn).catch(() => null);
      reach.push({ token, repo, can_push, expected: REPO_OF[token].name === repo });
    }
  }
  const rules: BranchRules[] = [];
  const unknown: string[] = [];
  for (const repo of repos) {
    for (const branch of PROTECTED_BRANCHES) {
      const read = await readBranchRules(repo, branch, fetchFn, delays);
      rules.push({
        repo,
        branch,
        missing: read.ok ? read.missing : null,
        approvals: read.ok ? read.approvals : null,
      });
      if (!read.ok) {
        unknown.push(
          `UNKNOWN: the rules on ${repo} ${branch} could not be read after ${read.tries} tries (${read.reason}). Not a gap: run it again.`,
        );
      }
    }
  }

  const gaps: string[] = [];
  const accepted: string[] = [];
  for (const item of reach) {
    const name = TOKENS[item.token];
    if (item.can_push === null)
      gaps.push(`could not tell whether ${name} can push to ${item.repo}`);
    else if (item.can_push && !item.expected) {
      if (OTHER_REPO_REACH_ACCEPTED) {
        accepted.push(
          `${name} can push to ${item.repo} as well as ${REPO_OF[item.token].name}: an accepted risk, by the founder's decision. Prompts keep it off ${item.repo}.`,
        );
      } else {
        gaps.push(
          `${name} can push to ${item.repo}; it must reach ${REPO_OF[item.token].name} only. Re-mint it with "Only select repositories".`,
        );
      }
    } else if (!item.can_push && item.expected) gaps.push(`${name} cannot push to ${item.repo}`);
  }
  for (const item of rules) {
    if (item.missing === null) continue;
    if (item.missing.length) {
      gaps.push(
        `${item.repo} ${item.branch} has no ${item.missing.join(', ')} rule. Add the protect-${item.branch} ruleset.`,
      );
    }
    const needsApproval = (APPROVAL_BRANCHES as readonly string[]).includes(item.branch);
    if (needsApproval && item.approvals !== null && item.approvals < 1) {
      gaps.push(
        `${item.repo} ${item.branch} merges a pull request with ${item.approvals} approvals, so any agent token can merge into it. Require at least 1 approval from a person who holds no agent token, with no bypass for the bot.`,
      );
    }
  }
  return { reach, rules, gaps, accepted, unknown };
}
