import { company, NETRC } from '../definitions/company/index.ts';
import { listAll, type Naive } from '../naive/client.ts';
import { GITHUB_OWNER, REPOS, type TokenName } from './github.ts';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The repo each token writes to. */
const REPO_OF: Record<TokenName, (typeof REPOS)[keyof typeof REPOS]> = {
  engineering: REPOS.code,
  design: REPOS.design,
};

export const verifySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['netrc', 'ls_remote', 'api_push', 'push_dry_run', 'errors'],
  properties: {
    netrc: { type: 'string', description: 'Output of step 1, verbatim.' },
    ls_remote: { type: 'string', description: 'Output of step 2, verbatim.' },
    api_push: { type: 'string', description: 'Output of step 3, verbatim.' },
    push_dry_run: { type: 'string', description: 'Output of step 4, verbatim.' },
    errors: { type: 'array', items: { type: 'string' } },
  },
} as const;

/**
 * The commands a verification session runs. Each holds only paths and URLs, never the token, and
 * none prints the file: step 1 prints its mode and size, step 3 only the `push` permission GitHub
 * reports for the credential, which it reports only to an authenticated caller.
 */
export function verifySteps(repoName: string): string[] {
  const url = `https://github.com/${GITHUB_OWNER}/${repoName}`;
  return [
    'test -f ~/.netrc && stat -c "mode %a size %s" ~/.netrc || echo "no ~/.netrc"',
    `GIT_TERMINAL_PROMPT=0 timeout 25 git ls-remote ${url} refs/heads/dev 2>&1 | cut -c1-60`,
    `timeout 25 curl --netrc -s https://api.github.com/repos/${GITHUB_OWNER}/${repoName} | grep -o '"push": *[a-z]*' || echo "no push permission reported"`,
    `cd "$(mktemp -d)" && git init -q && git -c user.name=netrc-check -c user.email=netrc-check@invalid commit -q --allow-empty -m netrc-check && GIT_TERMINAL_PROMPT=0 timeout 25 git push --dry-run ${url} HEAD:refs/heads/netrc-check 2>&1 | tail -n 2`,
  ];
}

function verifyMessage(repoName: string): string {
  const steps = verifySteps(repoName)
    .map((command, index) => `Step ${index + 1}. Run with bash, exactly: ${command}`)
    .join('\n');
  return `This session checks that your GitHub credential works. It is not a card, so there is nothing to claim. Run each step as one bash call, in order, and copy its output verbatim. Never print, cat or copy ~/.netrc, and never add -v, --verbose or GIT_TRACE to any command. Step 4 is a dry run: it pushes nothing.
${steps}
Step 5. Call submit_output with the four outputs and any errors.`;
}

export interface VerifyResult {
  agent: string;
  repo: string;
  session_id: string;
  status: string;
  computer_before: string | null;
  computer_after: string | null;
  output: Record<string, unknown> | null;
  consumed_micro_usd: number;
}

/**
 * `pnpm company:verify`: one session per agent with a token, started after its computer has gone
 * idle, proves that `~/.netrc` is still there in a later session and that git and the REST API
 * authenticate with it.
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
    return { agent, definition, repo: REPO_OF[token].name };
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
    targets.map(async ({ agent, definition, repo }) => {
      const before = await computerOf(agent.id);
      const session = await client.sessions.create({
        agent_id: agent.id,
        budget_micro_usd: definition.session.budget_micro_usd,
        output_schema: verifySchema,
        structured_output_required: true,
        metadata: { purpose: 'company:verify', agent: definition.name },
        message: verifyMessage(repo),
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
      return {
        agent: definition.name,
        repo,
        session_id: session.id,
        status: `${current.status}/${current.stop_reason ?? ''}`,
        computer_before: before,
        computer_after: await computerOf(agent.id),
        output: (current.structured_output as Record<string, unknown> | null) ?? null,
        consumed_micro_usd: current.consumed_micro_usd ?? 0,
      };
    }),
  );
}
