#!/usr/bin/env node
// pnpm web:secrets:sync:<env> — copies the Worker's secrets from the env file to Cloudflare.
// Each value goes to `wrangler secret put` on stdin, never on the command line. For staging, a
// value named STAGING_<NAME> wins over <NAME>; for production, PRODUCTION_<NAME> does.
import {
  bin,
  ENV_FILE,
  environmentArg,
  fail,
  guardProduction,
  readEnvFile,
  requireCloudflare,
  valueFor,
  WORKER_SECRETS,
} from './lib/env.mjs';

const env = environmentArg();
const vars = readEnvFile();
const credentials = requireCloudflare(vars);
const values = WORKER_SECRETS.map((name) => [name, valueFor(vars, name, env)]);
const missing = values.filter(([, value]) => value === null).map(([name]) => name);
if (missing.length > 0) fail(`${missing.join(', ')} missing from ${ENV_FILE} for ${env}.`);

await guardProduction(env, `replace ${WORKER_SECRETS.length} secrets`);
for (const [name, value] of values) {
  console.log(`Setting ${name} on ${env}`);
  bin('wrangler', ['secret', 'put', name, '--env', env], { env: credentials, input: value });
}
console.log(`\n${values.length} secrets set on ${env}. They take effect on the next request.`);
