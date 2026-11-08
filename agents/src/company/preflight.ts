import { readSecret } from '../naive/client.ts';
import { GITHUB_OWNER, REPO_OF, REPOS, TOKENS, type TokenName } from './github.ts';

/**
 * What the spec needs from GitHub before the company runs on its own, checked from this machine:
 * each token writes to its own repo and no other (docs/company/README.md section 6), and `main` and
 * `dev` of both repos carry the section 5 C rules. Agents hold the tokens with bash and open egress,
 * so a token that reaches both repos, or a branch with no rules, is bounded by prompts alone.
 *
 * Nothing here changes GitHub. A token cannot fix either gap: re-minting a token and adding a ruleset
 * are the founder's, in GitHub's settings.
 */

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

/** The rule types of the `protect-main` and `protect-dev` rulesets (spec section 5 C). */
export const REQUIRED_RULES = ['deletion', 'non_fast_forward', 'pull_request'] as const;
export const PROTECTED_BRANCHES = ['main', 'dev'] as const;

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
}

export interface GithubReport {
  reach: TokenReach[];
  rules: BranchRules[];
  /** One line per way GitHub differs from the spec. Empty means ready. */
  gaps: string[];
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

/** The required rule types a branch lacks, from GitHub's public rules endpoint. */
export async function missingRules(
  repoName: string,
  branch: string,
  fetchFn: Fetch = fetch,
): Promise<string[] | null> {
  const url = `https://api.github.com/repos/${GITHUB_OWNER}/${repoName}/rules/branches/${branch}`;
  const response = await fetchFn(url, { headers: { Accept: 'application/vnd.github+json' } });
  if (response.status !== 200) return null;
  const rules = (await response.json()) as { type?: string }[];
  const types = new Set(rules.map((rule) => rule.type));
  return REQUIRED_RULES.filter((type) => !types.has(type));
}

/** Checks both tokens against both repos, and the rules on `main` and `dev` of both repos. */
export async function githubPreflight(
  read: (name: string) => string = readSecret,
  fetchFn: Fetch = fetch,
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
  for (const repo of repos) {
    for (const branch of PROTECTED_BRANCHES) {
      rules.push({
        repo,
        branch,
        missing: await missingRules(repo, branch, fetchFn).catch(() => null),
      });
    }
  }

  const gaps: string[] = [];
  for (const item of reach) {
    const name = TOKENS[item.token];
    if (item.can_push === null)
      gaps.push(`could not tell whether ${name} can push to ${item.repo}`);
    else if (item.can_push && !item.expected) {
      gaps.push(
        `${name} can push to ${item.repo}; it must reach ${REPO_OF[item.token].name} only. Re-mint it with "Only select repositories".`,
      );
    } else if (!item.can_push && item.expected) gaps.push(`${name} cannot push to ${item.repo}`);
  }
  for (const item of rules) {
    if (item.missing === null) gaps.push(`could not read the rules on ${item.repo} ${item.branch}`);
    else if (item.missing.length) {
      gaps.push(
        `${item.repo} ${item.branch} has no ${item.missing.join(', ')} rule. Add the protect-${item.branch} ruleset.`,
      );
    }
  }
  return { reach, rules, gaps };
}
