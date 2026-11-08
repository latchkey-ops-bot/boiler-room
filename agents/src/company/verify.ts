import { company, NETRC } from '../definitions/company/index.ts';
import { listAll, type Naive } from '../naive/client.ts';
import { GITHUB_OWNER, otherRepo, REPO_OF } from './github.ts';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const verifySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['netrc', 'ls_remote', 'api_auth', 'push_dry_run', 'other_push_dry_run', 'errors'],
  properties: {
    netrc: { type: 'string', description: 'Output of step 1, verbatim.' },
    ls_remote: { type: 'string', description: 'Output of step 2, verbatim.' },
    api_auth: { type: 'string', description: 'Output of step 3, verbatim.' },
    push_dry_run: { type: 'string', description: 'Output of step 4, verbatim.' },
    other_push_dry_run: { type: 'string', description: 'Output of step 5, verbatim.' },
    errors: { type: 'array', items: { type: 'string' } },
  },
} as const;

/** A dry-run push of a fresh empty commit to a new branch. It sends no objects. */
function dryRunPush(repoName: string): string {
  const url = `https://github.com/${GITHUB_OWNER}/${repoName}`;
  return `cd "$(mktemp -d)" && git init -q && git -c user.name=netrc-check -c user.email=netrc-check@invalid commit -q --allow-empty -m netrc-check && GIT_TERMINAL_PROMPT=0 timeout 25 git push --dry-run ${url} HEAD:refs/heads/netrc-check 2>&1 | tail -n 2`;
}

/**
 * The commands a verification session runs. Each holds only paths and URLs, never the token, and
 * none prints the file. Step 1 prints the file's mode and size. Step 3 prints only the HTTP status
 * of `GET /user`: 200 proves the token authenticates, nothing more. A repo's `"push"` permission
 * reports the user's role, not the token's grant, so it proves nothing about reach. Step 4 must be
 * accepted by the token's own repo, and step 5 must be refused by the other repo, because each token
 * is meant to write to one repo only.
 */
export function verifySteps(repoName: string, otherRepoName: string): string[] {
  const url = `https://github.com/${GITHUB_OWNER}/${repoName}`;
  return [
    'test -f ~/.netrc && stat -c "mode %a size %s" ~/.netrc || echo "no ~/.netrc"',
    `GIT_TERMINAL_PROMPT=0 timeout 25 git ls-remote ${url} refs/heads/dev 2>&1 | cut -c1-60`,
    'timeout 25 curl --netrc -s -o /dev/null -w "auth %{http_code}" https://api.github.com/user',
    dryRunPush(repoName),
    dryRunPush(otherRepoName),
  ];
}

function verifyMessage(repoName: string, otherRepoName: string): string {
  const steps = verifySteps(repoName, otherRepoName)
    .map((command, index) => `Step ${index + 1}. Run with bash, exactly: ${command}`)
    .join('\n');
  return `This session checks that your GitHub credential works on ${repoName} and is refused on ${otherRepoName}. It is not a card, so there is nothing to claim. Run each step as one bash call, in order, exactly once, and copy its output verbatim. Never print, cat or copy ~/.netrc, and never add -v, --verbose or GIT_TRACE to any command. Steps 4 and 5 are dry runs: they push nothing. Step 5 is expected to be refused; record the refusal and do not retry it or try another way.
${steps}
Step 6. Call submit_output with the five outputs and any errors.`;
}

/** What one verification session proved, judged from its outputs by code, not by the model. */
export interface VerifyVerdict {
  ok: boolean;
  failures: string[];
}

const PUSHED = /\[new branch\]|->\s*netrc-check/;
const REFUSED =
  /\b40[134]\b|denied|not accessible|not found|Authentication failed|could not read Username/i;

/**
 * Judges a verification session's outputs. It passes only when the file is there with mode 600,
 * the token authenticates, a dry-run push to its own repo is accepted, and a dry-run push to the
 * other repo is refused.
 */
export function judgeVerify(output: Record<string, unknown> | null): VerifyVerdict {
  if (!output) return { ok: false, failures: ['the session returned no output'] };
  const text = (key: string) => (typeof output[key] === 'string' ? (output[key] as string) : '');
  const failures: string[] = [];
  if (!/mode 600\b/.test(text('netrc'))) failures.push('~/.netrc is missing or not mode 600');
  if (!/^auth 200$/m.test(text('api_auth').trim())) {
    failures.push('the token did not authenticate to the REST API');
  }
  const own = text('push_dry_run');
  if (!PUSHED.test(own) || REFUSED.test(own)) {
    failures.push('a dry-run push to its own repo was not accepted');
  }
  const other = text('other_push_dry_run');
  if (PUSHED.test(other)) {
    failures.push('a dry-run push to the other repo was accepted: the token reaches both repos');
  } else if (!REFUSED.test(other)) {
    failures.push('a dry-run push to the other repo was not clearly refused');
  }
  return { ok: failures.length === 0, failures };
}

export interface VerifyResult {
  agent: string;
  repo: string;
  other_repo: string;
  session_id: string;
  status: string;
  computer_before: string | null;
  computer_after: string | null;
  output: Record<string, unknown> | null;
  verdict: VerifyVerdict;
  consumed_micro_usd: number;
}

/**
 * `pnpm company:verify`: one session per agent with a token, started after its computer has gone
 * idle, proves that `~/.netrc` is still there in a later session, that the token authenticates and
 * can push to its own repo, and that the other repo refuses it.
 */
export async function verifyNetrc(
  client: Naive,
  log: (line: string) => void = () => undefined,
  { waitForPause = true }: { waitForPause?: boolean } = {},
): Promise<VerifyResult[]> {
  const existing = await listAll((query) => client.agents.list(query));
  const targets = Object.entries(NETRC).map(([name, token]) => {
    const agent = existing.find((item) => item.name === name);
    const definition = company.find((item) => item.name === name);
    if (!agent || !definition) throw new Error(`${name} is not synced. Run company:sync first.`);
    return { agent, definition, repo: REPO_OF[token].name, other: otherRepo(token).name };
  });

  const computerOf = async (agentId: string) => {
    const computer = await client.agents.computer(agentId);
    return computer ? `${computer.id} ${computer.status}` : null;
  };
  if (waitForPause) {
    // A card-started session usually finds the computer paused, so check from there.
    const started = Date.now();
    for (;;) {
      const states = await Promise.all(targets.map((target) => computerOf(target.agent.id)));
      log(`computers ${states.join(', ')}`);
      if (states.every((state) => state?.endsWith('paused')) || Date.now() - started > 6 * 60_000) {
        break;
      }
      await sleep(20_000);
    }
  }

  return Promise.all(
    targets.map(async ({ agent, definition, repo, other }) => {
      const before = await computerOf(agent.id);
      const session = await client.sessions.create({
        agent_id: agent.id,
        budget_micro_usd: definition.session.budget_micro_usd,
        output_schema: verifySchema,
        structured_output_required: true,
        metadata: { purpose: 'company:verify', agent: definition.name },
        message: verifyMessage(repo, other),
      });
      log(`session   ${definition.name} ${session.id}`);
      const started = Date.now();
      let current = await client.sessions.get(session.id);
      while (['running', 'queued'].includes(current.status) && Date.now() - started < 6 * 60_000) {
        await sleep(4000);
        current = await client.sessions.get(session.id);
      }
      if (['running', 'queued'].includes(current.status)) {
        await client.sessions.interrupt(session.id).catch(() => undefined);
      }
      const output = (current.structured_output as Record<string, unknown> | null) ?? null;
      return {
        agent: definition.name,
        repo,
        other_repo: other,
        session_id: session.id,
        status: `${current.status}/${current.stop_reason ?? ''}`,
        computer_before: before,
        computer_after: await computerOf(agent.id),
        output,
        verdict: judgeVerify(output),
        consumed_micro_usd: current.consumed_micro_usd ?? 0,
      };
    }),
  );
}
