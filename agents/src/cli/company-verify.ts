import {
  verifyCeoTools,
  verifyDeployKeys,
  verifyLockdown,
  verifyNetrc,
} from '../company/verify.ts';
import { naiveClient, scrub, usd } from '../naive/client.ts';

/**
 * `pnpm company:verify`: first the lockdown check, read-only and free: no agent is offered a board
 * tool its definition does not give it, and br-ceo as stored names every served control-plane tool
 * off. Then, also free, that the Cloudflare token is active and that only the engineering lead's
 * computer holds it, in ~/.boiler-room.env with mode 600. Then it proves each token-holding agent can
 * still use ~/.netrc in a new session and can push to its own repo, and records whether the other
 * repo accepts it too (an accepted risk), and that the bound br-ceo is offered nothing from the
 * control plane. `--lockdown` runs only the first check, `--deploy` only it and the Cloudflare
 * check, `--ceo` only it and the br-ceo check. Exits 1 if any check fails.
 */
const client = naiveClient();
const log = (line: string) => console.log(scrub(line));
let failed = false;

const lockdown = await verifyLockdown(client);
console.log(
  scrub(
    `lockdown  ${lockdown.verdict.ok ? 'PASS' : 'FAIL'}: ${lockdown.exposure.length} agent(s) offered a board tool they should not have, ${lockdown.unnamed_on_ceo.length} control-plane tool(s) not named off on br-ceo${lockdown.verdict.failures.map((failure) => `\n  - ${failure}`).join('')}`,
  ),
);
failed ||= !lockdown.verdict.ok;
const only = (flag: string) => process.argv.includes(flag);

if (!only('--ceo') && !only('--lockdown')) {
  const deploy = await verifyDeployKeys(client);
  console.log(
    scrub(
      `cloudflare ${deploy.verdict.ok ? 'PASS' : 'FAIL'}: token active ${deploy.token_active}${deploy.computers
        .map(
          (item) =>
            `\n  ${item.agent} (${item.wanted ? 'must have' : 'must not have'} ~/.boiler-room.env) ${item.computer ?? 'no computer'}: ${item.stat}${item.stat !== 'absent' && item.names ? `, keys ${item.names}` : ''}`,
        )
        .join('')}${deploy.verdict.failures.map((failure) => `\n  - ${failure}`).join('')}`,
    ),
  );
  failed ||= !deploy.verdict.ok;
}

if (!only('--ceo') && !only('--lockdown') && !only('--deploy')) {
  const results = await verifyNetrc(client, log, {
    waitForPause: !process.argv.includes('--no-wait'),
  });
  for (const result of results) {
    const verdict = result.verdict.ok ? 'PASS' : `FAIL: ${result.verdict.failures.join('; ')}`;
    const accepted = (result.verdict.accepted ?? [])
      .map((line) => `\n  ACCEPTED: ${line}`)
      .join('');
    console.log(
      scrub(
        `${result.agent} ${result.repo} (other repo: ${result.other_repo}) ${result.session_id} ${result.status} ${usd(result.consumed_micro_usd)}\n  ${verdict}${accepted}\n  computer before: ${result.computer_before}\n  computer after:  ${result.computer_after}\n  ${JSON.stringify(result.output)}`,
      ),
    );
  }
  failed ||= results.some((result) => !result.verdict.ok);
}

if (!only('--lockdown') && !only('--deploy')) {
  const ceo = await verifyCeoTools(client, log);
  const verdict = ceo.verdict.ok ? 'PASS' : `FAIL: ${ceo.verdict.failures.join('; ')}`;
  console.log(
    scrub(
      `br-ceo tools ${ceo.session_id} ${ceo.status} ${usd(ceo.consumed_micro_usd)}\n  ${verdict}\n  offered: ${JSON.stringify(ceo.offered)}\n  called:  ${JSON.stringify(ceo.called)}`,
    ),
  );
  failed ||= !ceo.verdict.ok;
}
if (failed) process.exitCode = 1;
