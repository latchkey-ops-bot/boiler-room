import { haltCeo, interruptHeld } from '../company/halt.ts';
import { naiveClient, scrub } from '../naive/client.ts';

/**
 * `pnpm company:halt`: the kill switch for br-ceo. Gives it a $0 budget, pauses its sweep and
 * interrupts every live br-ceo session. `pnpm company:sync --unhalt` restores it.
 *
 *   --dry-run          says what it would do, and changes nothing
 *   --held             only interrupts every company agent's budget_paused and awaiting_approval
 *                      sessions: run it before raising a budget or approving anything
 *   --unbind=<agt id>  halts, then deletes br-ceo, which is the only thing that clears the
 *                      organization's ceo_agent_id. It also deletes the sweep. Needs br-ceo's own id.
 */
const client = naiveClient();
const log = (line: string) => console.log(scrub(line));
const dryRun = process.argv.includes('--dry-run');
const unbind = process.argv.find((arg) => arg.startsWith('--unbind='))?.slice('--unbind='.length);

if (process.argv.includes('--held')) {
  const held = await interruptHeld(client, log, { dryRun });
  log(`${held.length} held session(s)${dryRun ? ', none interrupted (dry run)' : ' interrupted'}`);
} else {
  const report = await haltCeo(client, log, { dryRun, unbind: unbind ?? null });
  if (dryRun) log('dry run: nothing was changed');
  else if (!report.deleted) log('br-ceo is halted. pnpm company:sync --unhalt restores it.');
}
