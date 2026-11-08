#!/usr/bin/env node
// pnpm web:preview — the real Worker, built by OpenNext, on workerd at http://localhost:8787,
// with the local D1 and R2. The Playwright smoke test runs against it.
import { buildWorker } from './build.mjs';
import { writeDevVars } from './lib/dev-vars.mjs';
import { bin } from './lib/env.mjs';

writeDevVars();
bin('wrangler', ['d1', 'migrations', 'apply', 'DB', '--local'], { env: { CI: '1' } });
if (!process.argv.includes('--skip-build')) buildWorker();
bin('opennextjs-cloudflare', ['preview', '--port', process.env.PORT ?? '8787']);
