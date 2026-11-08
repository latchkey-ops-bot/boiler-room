import { GITHUB_OWNER, REPOS, TOKENS, type TokenName } from '../src/company/github.ts';
import { readSecret } from '../src/naive/client.ts';
import { EVAL_BRANCH_PREFIXES } from './names.ts';

/**
 * GitHub for the evals, over the REST API from this machine. A token goes in a request header only,
 * never in a command line or a log. Fixture pull requests are opened with the engineering token,
 * the account the engineers use, so the lead under test sees them as its own team's.
 */

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export type RepoName = (typeof REPOS)[keyof typeof REPOS]['name'];

export class GithubApi {
  private readonly token: string;
  private readonly fetchFn: Fetch;
  constructor(token: TokenName = 'engineering', fetchFn: Fetch = fetch) {
    this.token = readSecret(TOKENS[token]);
    this.fetchFn = fetchFn;
  }

  async call<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ status: number; data: T }> {
    const response = await this.fetchFn(`https://api.github.com${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    const data = (text ? JSON.parse(text) : null) as T;
    return { status: response.status, data };
  }

  private async ok<T>(method: string, path: string, body?: unknown): Promise<T> {
    const { status, data } = await this.call<T>(method, path, body);
    if (status >= 300) {
      const message = (data as { message?: string } | null)?.message ?? '';
      throw new Error(`GitHub ${method} ${path} answered ${status} ${message}`);
    }
    return data;
  }

  async refSha(repo: RepoName, branch: string): Promise<string | null> {
    const { status, data } = await this.call<{ object?: { sha?: string } }>(
      'GET',
      `/repos/${GITHUB_OWNER}/${repo}/git/ref/heads/${branch}`,
    );
    return status === 200 ? (data.object?.sha ?? null) : null;
  }

  async createBranch(repo: RepoName, branch: string, from: string): Promise<string> {
    assertEvalBranch(branch);
    const sha = await this.refSha(repo, from);
    if (!sha) throw new Error(`${repo} has no branch ${from}.`);
    await this.ok('POST', `/repos/${GITHUB_OWNER}/${repo}/git/refs`, {
      ref: `refs/heads/${branch}`,
      sha,
    });
    return sha;
  }

  /** Writes one file on an eval branch, as one commit. */
  async putFile(
    repo: RepoName,
    branch: string,
    path: string,
    content: string,
    message: string,
  ): Promise<string> {
    assertEvalBranch(branch);
    const existing = await this.call<{ sha?: string }>(
      'GET',
      `/repos/${GITHUB_OWNER}/${repo}/contents/${path}?ref=${encodeURIComponent(branch)}`,
    );
    const result = await this.ok<{ commit: { sha: string } }>(
      'PUT',
      `/repos/${GITHUB_OWNER}/${repo}/contents/${path}`,
      {
        message,
        branch,
        content: Buffer.from(content, 'utf8').toString('base64'),
        ...(existing.status === 200 && existing.data.sha ? { sha: existing.data.sha } : {}),
      },
    );
    return result.commit.sha;
  }

  async openPr(
    repo: RepoName,
    input: { head: string; base: string; title: string; body: string },
  ): Promise<{ number: number; url: string }> {
    assertEvalBranch(input.head);
    if (['main', 'dev'].includes(input.head))
      throw new Error('An eval never opens a PR from main or dev.');
    if (input.base === 'main') throw new Error('An eval never opens a PR into main.');
    const pr = await this.ok<{ number: number; html_url: string }>(
      'POST',
      `/repos/${GITHUB_OWNER}/${repo}/pulls`,
      input,
    );
    return { number: pr.number, url: pr.html_url };
  }

  async pr(repo: RepoName, number: number): Promise<PullRequest> {
    return this.ok('GET', `/repos/${GITHUB_OWNER}/${repo}/pulls/${number}`);
  }

  async prFiles(repo: RepoName, number: number): Promise<string[]> {
    const files = await this.ok<{ filename: string }[]>(
      'GET',
      `/repos/${GITHUB_OWNER}/${repo}/pulls/${number}/files?per_page=100`,
    );
    return files.map((file) => file.filename);
  }

  async prComments(repo: RepoName, number: number): Promise<{ user: string; body: string }[]> {
    const comments = await this.ok<{ user: { login: string }; body: string }[]>(
      'GET',
      `/repos/${GITHUB_OWNER}/${repo}/issues/${number}/comments?per_page=100`,
    );
    const reviews = await this.ok<{ user: { login: string }; body: string }[]>(
      'GET',
      `/repos/${GITHUB_OWNER}/${repo}/pulls/${number}/reviews?per_page=100`,
    );
    return [...comments, ...reviews]
      .filter((item) => item.body)
      .map((item) => ({ user: item.user.login, body: item.body }));
  }

  /** Every pull request, open or closed, whose head branch is an eval branch. */
  async evalPrs(repo: RepoName): Promise<PullRequest[]> {
    const all: PullRequest[] = [];
    for (let page = 1; page <= 5; page++) {
      const batch = await this.ok<PullRequest[]>(
        'GET',
        `/repos/${GITHUB_OWNER}/${repo}/pulls?state=all&per_page=100&sort=created&direction=desc&page=${page}`,
      );
      all.push(...batch);
      if (batch.length < 100) break;
    }
    return all.filter((pr) => isEvalBranch(pr.head.ref) || isEvalBranch(pr.base.ref));
  }

  async evalBranches(repo: RepoName): Promise<string[]> {
    const names: string[] = [];
    for (const prefix of EVAL_BRANCH_PREFIXES) {
      const refs = await this.call<{ ref: string }[] | { ref: string }>(
        'GET',
        `/repos/${GITHUB_OWNER}/${repo}/git/matching-refs/heads/${prefix}`,
      );
      if (refs.status !== 200) continue;
      const list = Array.isArray(refs.data) ? refs.data : [refs.data];
      names.push(...list.map((ref) => ref.ref.replace(/^refs\/heads\//, '')));
    }
    return names.filter(isEvalBranch);
  }

  async closePr(repo: RepoName, number: number): Promise<void> {
    await this.ok('PATCH', `/repos/${GITHUB_OWNER}/${repo}/pulls/${number}`, { state: 'closed' });
  }

  async deleteBranch(repo: RepoName, branch: string): Promise<void> {
    assertEvalBranch(branch);
    const { status } = await this.call(
      'DELETE',
      `/repos/${GITHUB_OWNER}/${repo}/git/refs/heads/${branch}`,
    );
    if (status !== 204 && status !== 422 && status !== 404) {
      throw new Error(`Deleting ${repo}:${branch} answered ${status}.`);
    }
  }
}

export interface PullRequest {
  number: number;
  html_url: string;
  state: 'open' | 'closed';
  merged?: boolean;
  merged_at: string | null;
  merge_commit_sha: string | null;
  title: string;
  body: string | null;
  user: { login: string };
  head: { ref: string; sha: string };
  base: { ref: string };
}

export function isEvalBranch(branch: string): boolean {
  return EVAL_BRANCH_PREFIXES.some((prefix) => branch.startsWith(prefix));
}

/** Every branch an eval writes is an eval branch, so `main` and `dev` can never be one. */
export function assertEvalBranch(branch: string): void {
  if (!isEvalBranch(branch)) throw new Error(`${branch} is not an eval branch.`);
}

export interface GithubCleanup {
  closed: string[];
  deleted: string[];
  errors: string[];
}

/** Closes every open eval pull request and deletes every eval branch, in both repos. */
export async function cleanGithub(api: GithubApi = new GithubApi()): Promise<GithubCleanup> {
  const report: GithubCleanup = { closed: [], deleted: [], errors: [] };
  for (const repo of [REPOS.code.name, REPOS.design.name] as RepoName[]) {
    try {
      for (const pr of await api.evalPrs(repo)) {
        if (pr.state === 'open') {
          await api.closePr(repo, pr.number);
          report.closed.push(`${repo}#${pr.number}`);
        }
      }
      for (const branch of await api.evalBranches(repo)) {
        await api.deleteBranch(repo, branch);
        report.deleted.push(`${repo}:${branch}`);
      }
    } catch (error) {
      report.errors.push(`${repo}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return report;
}
