#!/usr/bin/env node
// pnpm web:logs:<env> [wrangler tail flags] — streams the live Worker's logs and errors.
// For example: pnpm web:logs:staging --status error, or --search "Unhandled API error".
import { bin, environmentArg, readEnvFile, requireCloudflare } from './lib/env.mjs';

const env = environmentArg();
const credentials = requireCloudflare(readEnvFile());
bin('wrangler', ['tail', '--env', env, '--format', 'pretty', ...process.argv.slice(3)], {
  env: credentials,
});
