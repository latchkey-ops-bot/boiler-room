import { companyStatus } from '../company/status.ts';
import { naiveClient } from '../naive/client.ts';

/** `pnpm company:status`: the agents, br-ceo's roster, the board, the sweep, spend and GitHub. */
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
console.log('GitHub: token reach');
console.table(status.github.reach);
console.log('GitHub: rules on main and dev');
console.table(
  status.github.rules.map((item) => ({ ...item, missing: item.missing?.join(', ') ?? 'unknown' })),
);
if (status.github.gaps.length) {
  console.log('Not ready to resume the sweep. GitHub differs from the spec:');
  for (const gap of status.github.gaps) console.log(`- ${gap}`);
} else {
  console.log('GitHub matches the spec.');
}
