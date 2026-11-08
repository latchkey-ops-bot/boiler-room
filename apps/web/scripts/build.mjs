#!/usr/bin/env node
// Builds the Worker with OpenNext: `node scripts/build.mjs [staging|production]`.
// With no environment it builds for local preview. OpenNext runs the package's `build` script,
// which must stay `next build`: pointing it back at this file would recurse. The Clerk publishable key is inlined by Next,
// so it is read from the env file into the build's environment here, never from a command line.
import {
  BUILD_VARS,
  bin,
  ENV_FILE,
  fail,
  git,
  readEnvFile,
  refuseDevelopmentKeys,
  valueFor,
} from './lib/env.mjs';
import { environmentConfig } from './lib/wrangler-config.mjs';

export function buildWorker(env) {
  const vars = readEnvFile();
  const buildEnv = { BR_BUILD_SHA: git(['rev-parse', '--short=12', 'HEAD']) ?? 'unknown' };
  for (const name of BUILD_VARS) {
    const value = valueFor(vars, name, env ?? 'development');
    if (value === null) {
      fail(`${env === 'production' ? `PRODUCTION_${name}` : name} is missing from ${ENV_FILE}.`);
    }
    buildEnv[name] = value;
  }
  refuseDevelopmentKeys(
    env,
    BUILD_VARS.map((name) => [name, buildEnv[name]]),
    env ? environmentConfig(env).vars.CLERK_INSTANCE : undefined,
  );
  bin('wrangler', ['types', '--env-interface', 'CloudflareEnv', 'cloudflare-env.d.ts']);
  bin('opennextjs-cloudflare', ['build', ...(env ? ['--env', env] : [])], { env: buildEnv });
  return buildEnv.BR_BUILD_SHA;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const env = process.argv[2];
  if (env && !['staging', 'production'].includes(env)) fail('Build for staging or production.');
  buildWorker(env);
}
