#!/usr/bin/env node
// pnpm web:rollback:<env> [version-id] — makes an earlier Worker version live again.
// Without a version id, wrangler rolls back to the version before the live one. It lists the recent
// versions first, so you can see what you are going back to. D1 is not rolled back: that is why
// every migration must work with the code before it. In production the release agent passes
// `--release-card crd_...`, on the RELEASE card whose production checks failed.
import {
  bin,
  environmentArg,
  guardProduction,
  readEnvFile,
  requireCloudflare,
  scriptArgs,
} from './lib/env.mjs';
import { environmentConfig } from './lib/wrangler-config.mjs';

const env = environmentArg();
const versionId = scriptArgs().positionals[1];
const vars = readEnvFile();
const credentials = requireCloudflare(vars);
const { workerName } = environmentConfig(env);

console.log(`Recent versions of ${workerName}:`);
bin('wrangler', ['versions', 'list', '--env', env], { env: credentials });
const card = await guardProduction(
  env,
  `roll back ${workerName}${versionId ? ` to ${versionId}` : ''}`,
  { step: 'rollback' },
);
bin(
  'wrangler',
  [
    'rollback',
    ...(versionId ? [versionId] : []),
    '--env',
    env,
    '--message',
    `Rollback by scripts/rollback.mjs${versionId ? ` to ${versionId}` : ''}${card ? ` release-card:${card}` : ''}`,
  ],
  { env: { ...credentials, CI: '1' } },
);
bin('wrangler', ['deployments', 'status', '--env', env], { env: credentials, allowFail: true });
console.log(`\nRolled back ${workerName}. Now run: pnpm web:smoke <url of ${env}>`);
