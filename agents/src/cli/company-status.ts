import { companyStatus } from '../company/status.ts';
import { naiveClient } from '../naive/client.ts';

/** `pnpm company:status`: the agents, br-ceo's roster, the board, the sweep and spend. */
const client = naiveClient();
const status = await companyStatus(client);

console.log('Agents');
console.table(status.agents);
console.log(`Roster of br-ceo (board ${status.roster.board ? 'on' : 'off'})`);
console.table(status.roster.members);
if (status.board) {
  console.log(`Board ${status.board.id} ${JSON.stringify(status.board.counts)}`);
  if (status.board.cards.length) console.table(status.board.cards);
} else {
  console.log('Board: none');
}
console.log('Sweep');
console.table(status.deployments);
console.log(
  `Spend: company ${status.spend.company_total} in all, from the ledger; org balance ${status.spend.org_balance}`,
);
