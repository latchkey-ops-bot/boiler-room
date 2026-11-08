import { verifyNetrc } from '../company/verify.ts';
import { naiveClient, scrub, usd } from '../naive/client.ts';

/**
 * `pnpm company:verify`: proves each token-holding agent can still use ~/.netrc in a new session,
 * can push to its own repo, and is refused by the other one. Exits 1 if any agent fails.
 */
const client = naiveClient();
const results = await verifyNetrc(client, (line) => console.log(scrub(line)), {
  waitForPause: !process.argv.includes('--no-wait'),
});
for (const result of results) {
  const verdict = result.verdict.ok ? 'PASS' : `FAIL: ${result.verdict.failures.join('; ')}`;
  console.log(
    scrub(
      `${result.agent} ${result.repo} (must be refused by ${result.other_repo}) ${result.session_id} ${result.status} ${usd(result.consumed_micro_usd)}\n  ${verdict}\n  computer before: ${result.computer_before}\n  computer after:  ${result.computer_after}\n  ${JSON.stringify(result.output)}`,
    ),
  );
}
if (results.some((result) => !result.verdict.ok)) process.exitCode = 1;
