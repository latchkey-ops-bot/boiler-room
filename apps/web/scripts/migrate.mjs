#!/usr/bin/env node
// pnpm web:db:migrate:<env> — applies the SQL files in drizzle/ that the environment's D1 has not
// run yet. Run it BEFORE deploying the code that needs them; every migration must still work with
// the code that is live now (skills/engineering-deploy/SKILL.md, "D1 migrations"). In production the
// release agent passes `--release-card crd_...`, which runs only from a clean tree at origin/main.
import {
  bin,
  environmentArg,
  fail,
  guardProduction,
  readEnvFile,
  requireCloudflare,
} from './lib/env.mjs';
import { environmentConfig } from './lib/wrangler-config.mjs';

const env = environmentArg();
const credentials = requireCloudflare(readEnvFile());
const target = environmentConfig(env);
if (!target.provisioned) fail(`env.${env} has no D1 database yet. Run pnpm web:provision:${env}.`);

console.log(`D1 ${target.databaseName} (${env}): migrations not yet applied`);
bin('wrangler', ['d1', 'migrations', 'list', 'DB', '--remote', '--env', env], { env: credentials });
await guardProduction(env, 'apply D1 migrations', { step: 'migrate' });
bin('wrangler', ['d1', 'migrations', 'apply', 'DB', '--remote', '--env', env], {
  env: { ...credentials, CI: '1' },
});
console.log(`\nMigrations applied to ${target.databaseName}.`);
