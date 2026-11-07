import { verifyNetrc } from '../company/verify.ts';
import { naiveClient, scrub, usd } from '../naive/client.ts';

/** `pnpm company:verify`: proves each token-holding agent can still use ~/.netrc in a new session. */
const client = naiveClient();
const results = await verifyNetrc(client, (line) => console.log(scrub(line)), {
  waitForPause: !process.argv.includes('--no-wait'),
});
for (const result of results) {
  console.log(
    scrub(
      `${result.agent} ${result.repo} ${result.session_id} ${result.status} ${usd(result.consumed_micro_usd)}\n  computer before: ${result.computer_before}\n  computer after:  ${result.computer_after}\n  ${JSON.stringify(result.output)}`,
    ),
  );
}
