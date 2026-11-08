import { exposureLine } from '../company/seats.ts';
import { companyStatus } from '../company/status.ts';
import { naiveClient } from '../naive/client.ts';

/** `pnpm company:status`: the agents, br-ceo's roster, the board, the sweep, spend and GitHub. */
const client = naiveClient();
const status = await companyStatus(client);

console.log('Agents');
console.table(status.agents);
const { ceo } = status;
console.log(
  `Organization CEO: ${ceo.ceo_agent_id ?? 'none'}${ceo.is_br_ceo ? ' (br-ceo)' : ' (not br-ceo)'}; dashboard role ${ceo.dashboard_role ?? 'none'}; vault ${ceo.vault ?? 'none'} ${ceo.credentials.join(', ')}`,
);
console.log(
  `Control plane: ${ceo.control_plane.count} tools served; ${ceo.control_plane.unnamed.length ? `NOT named on br-ceo: ${ceo.control_plane.unnamed.join(', ')}` : 'every one named off on br-ceo'}`,
);
console.log(
  `Control plane on br-ceo as stored: ${ceo.unnamed_on_ceo.length ? `NOT named off: ${ceo.unnamed_on_ceo.join(', ')}` : 'every served tool named off'}`,
);
if (status.board_exposure.length) {
  console.log('Company board: agents offered a board tool their definition does not give them');
  for (const item of status.board_exposure) console.log(`- ${exposureLine(item)}`);
} else {
  console.log('Company board: every agent is offered only the board tools its definition gives it');
}
console.log(`Roster of br-ceo (board ${status.roster.board ? 'on' : 'off'})`);
console.table(status.roster.members);
if (status.board) {
  console.log(`Board ${status.board.id} ${JSON.stringify(status.board.counts)}`);
  if (status.board.cards.length) console.table(status.board.cards);
  for (const duplicate of status.board.duplicates) {
    console.log(
      `Duplicate title "${duplicate.title}": ${duplicate.cards.join(', ')}. Keep the oldest; close the rest with "duplicate of <id>".`,
    );
  }
} else {
  console.log('Board: none');
}
if (status.held.length) {
  console.log(
    "Sessions waiting for a person. Interrupt each one before you raise its agent's budget or approve anything: a raised budget resumes a budget_paused session from its old context.",
  );
  console.table(status.held);
} else {
  console.log('Sessions waiting for a person: none');
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
for (const line of status.github.accepted) console.log(`GitHub, accepted: ${line}`);
if (status.github.gaps.length) {
  console.log('Not ready to resume the sweep. GitHub differs from the spec:');
  for (const gap of status.github.gaps) console.log(`- ${gap}`);
} else {
  console.log(
    `GitHub matches the spec${status.github.accepted.length ? ', apart from the accepted risks above' : ''}.`,
  );
}
