import { verifyCeoTools, verifyNetrc } from '../company/verify.ts';
import { naiveClient, scrub, usd } from '../naive/client.ts';

/**
 * `pnpm company:verify`: proves each token-holding agent can still use ~/.netrc in a new session,
 * can push to its own repo, and is refused by the other one, and that the bound br-ceo is offered
 * nothing from the control plane. `--ceo` runs only the br-ceo check. Exits 1 if any check fails.
 */
const client = naiveClient();
const log = (line: string) => console.log(scrub(line));
let failed = false;

if (!process.argv.includes('--ceo')) {
  const results = await verifyNetrc(client, log, {
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
  failed ||= results.some((result) => !result.verdict.ok);
}

const ceo = await verifyCeoTools(client, log);
const verdict = ceo.verdict.ok ? 'PASS' : `FAIL: ${ceo.verdict.failures.join('; ')}`;
console.log(
  scrub(
    `br-ceo tools ${ceo.session_id} ${ceo.status} ${usd(ceo.consumed_micro_usd)}\n  ${verdict}\n  offered: ${JSON.stringify(ceo.offered)}\n  called:  ${JSON.stringify(ceo.called)}`,
  ),
);
failed ||= !ceo.verdict.ok;
if (failed) process.exitCode = 1;
