import { agents } from '../definitions/index.ts';
import { naiveClient } from '../naive/client.ts';
import { syncAgents } from '../sync.ts';

/** `pnpm agents:sync`: makes the agents on Naive match the definitions in this repo. */
const client = naiveClient();
const results = await syncAgents(client, agents);
for (const result of results) {
  console.log(`${result.action.padEnd(9)} ${result.name} ${result.id} v${result.version}`);
}
