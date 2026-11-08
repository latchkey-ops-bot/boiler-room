#!/usr/bin/env node
// pnpm web:secrets:sync:<env> — copies the Worker's secrets from the env file to Cloudflare.
// Each value goes to `wrangler secret put` on stdin, never on the command line. For staging, a
// value named STAGING_<NAME> wins over <NAME>. Production takes only PRODUCTION_<NAME>, and refuses
// a Clerk development key unless env.production.vars.CLERK_INSTANCE in wrangler.jsonc is
// "development", as it is by the founder's decision of 2026-11-08.
//
// Staging also gets the real-film secrets (scripts/lib/runner-secrets.mjs), each from its STAGING_
// name only. The website's Naive key is checked with Naive first: it must hold exactly
// computers:write and billing:read, and it must not be the admin key. The runner's key, when there
// is one, must hold exactly the seven scopes of RUNNER_KEY_SCOPES. Production gets none.
import {
  bin,
  ENV_FILE,
  environmentArg,
  fail,
  guardProduction,
  readEnvFile,
  refuseDevelopmentKeys,
  requireCloudflare,
  valueFor,
  WORKER_SECRETS,
} from './lib/env.mjs';
import { checkRunnerKey, checkWebKey, runnerSecretsFor } from './lib/runner-secrets.mjs';
import { environmentConfig } from './lib/wrangler-config.mjs';

const env = environmentArg();
const vars = readEnvFile();
const credentials = requireCloudflare(vars);
const values = WORKER_SECRETS.map((name) => [name, valueFor(vars, name, env)]);
const missing = values.filter(([, value]) => value === null).map(([name]) => name);
if (missing.length > 0) {
  const names = env === 'production' ? missing.map((name) => `PRODUCTION_${name}`) : missing;
  fail(`${names.join(', ')} missing from ${ENV_FILE} for ${env}.`);
}
refuseDevelopmentKeys(env, values, environmentConfig(env).vars.CLERK_INSTANCE);

const runner = runnerSecretsFor(vars, env);
if (runner.problems.length > 0) fail(`Real-film secrets: ${runner.problems.join(' ')}`);
const webKey = runner.values.find(([name]) => name === 'NAIVE_WEB_KEY')?.[1];
if (webKey) {
  const problem = await checkWebKey(webKey);
  if (problem) fail(problem);
}
const runnerKey = runner.values.find(([name]) => name === 'NAIVE_RUNNER_KEY')?.[1];
if (runnerKey) {
  const problem = await checkRunnerKey(runnerKey);
  if (problem) fail(problem);
}
if (env === 'staging' && runner.values.length === 0) {
  console.log('No STAGING_NAIVE_WEB_KEY or STAGING_RUNNER_SIGNING_SECRET: real films stay off.');
} else if (runner.skipped.length > 0) {
  console.log(`Not set, so left as they are: ${runner.skipped.join(', ')}.`);
}
values.push(...runner.values);

await guardProduction(env, `replace ${values.length} secrets`, { step: 'secrets' });
for (const [name, value] of values) {
  console.log(`Setting ${name} on ${env}`);
  bin('wrangler', ['secret', 'put', name, '--env', env], { env: credentials, input: value });
}
console.log(`\n${values.length} secrets set on ${env}. They take effect on the next request.`);
