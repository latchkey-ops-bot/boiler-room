import { syncCompany } from '../company/sync.ts';
import { naiveClient, scrub } from '../naive/client.ts';

/**
 * `pnpm company:sync`: makes the company on Naive match the definitions in this repo. `--unhalt`
 * restores a br-ceo that `company:halt` stopped; without it, sync refuses to touch one.
 */
const client = naiveClient();
await syncCompany(client, (line) => console.log(scrub(line)), {
  unhalt: process.argv.includes('--unhalt'),
});
