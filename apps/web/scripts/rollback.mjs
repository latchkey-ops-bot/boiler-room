#!/usr/bin/env node
// pnpm web:rollback:<env> [version-id] — makes an earlier Worker version live again.
// Without a version id, wrangler rolls back to the version before the live one. It lists the recent
// versions first, so you can see what you are going back to. D1 is not rolled back: that is why
// every migration must work with the code before it.
import {
  bin,
  environmentArg,
  guardProduction,
  readEnvFile,
  requireCloudflare,
} from './lib/env.mjs';
import { environmentConfig } from './lib/wrangler-config.mjs';

const env = environmentArg();
const versionId = process.argv[3];
const vars = readEnvFile();
const credentials = requireCloudflare(vars);
const { workerName } = environmentConfig(env);

console.log(`Recent versions of ${workerName}:`);
bin('wrangler', ['versions', 'list', '--env', env], { env: credentials });
await guardProduction(env, `roll back ${workerName}${versionId ? ` to ${versionId}` : ''}`);
bin(
  'wrangler',
  [
    'rollback',
    ...(versionId ? [versionId] : []),
    '--env',
    env,
    '--message',
    `Rollback by scripts/rollback.mjs${versionId ? ` to ${versionId}` : ''}`,
  ],
  { env: { ...credentials, CI: '1' } },
);
bin('wrangler', ['deployments', 'status', '--env', env], { env: credentials, allowFail: true });
console.log(`\nRolled back ${workerName}. Now run: pnpm web:smoke <url of ${env}>`);
