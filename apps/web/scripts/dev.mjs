#!/usr/bin/env node
// pnpm web:dev — Next's dev server with the local D1 and R2 from wrangler.jsonc.
//
// 1. Writes .dev.vars from the env file (Clerk's development keys).
// 2. Applies the D1 migrations to the local database in .wrangler/state.
// 3. Starts `next dev` with .dev.vars in its environment.
import { readDevVars, writeDevVars } from './lib/dev-vars.mjs';
import { bin } from './lib/env.mjs';

writeDevVars();
bin('wrangler', ['d1', 'migrations', 'apply', 'DB', '--local'], { env: { CI: '1' } });
bin('next', ['dev', ...process.argv.slice(2)], { env: readDevVars() });
