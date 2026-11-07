import { syncCompany } from '../company/sync.ts';
import { naiveClient, scrub } from '../naive/client.ts';

/** `pnpm company:sync`: makes the company on Naive match the definitions in this repo. */
const client = naiveClient();
await syncCompany(client, (line) => console.log(scrub(line)));
