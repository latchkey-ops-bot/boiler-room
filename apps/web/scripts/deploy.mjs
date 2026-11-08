#!/usr/bin/env node
// pnpm web:deploy:<env> — builds and deploys the Worker, then runs the smoke check.
//
// Staging deploys the commit at the tip of origin/dev; production deploys the tip of origin/main.
// `--any-commit` lets staging deploy another commit, such as a hotfix branch, for a test.
// It refuses to deploy while D1 has migrations the new code may need: migrate first.
import { buildWorker } from './build.mjs';
import {
  bin,
  environmentArg,
  fail,
  git,
  guardProduction,
  readEnvFile,
  requireCloudflare,
  runTee,
} from './lib/env.mjs';
import { environmentConfig } from './lib/wrangler-config.mjs';
import { smoke } from './smoke.mjs';

const env = environmentArg();
const anyCommit = process.argv.includes('--any-commit');
const vars = readEnvFile();
const credentials = requireCloudflare(vars);
const target = environmentConfig(env);
if (!target.provisioned) fail(`env.${env} has no D1 database yet. Run pnpm web:provision:${env}.`);

// 1. The commit: clean, pushed, and the tip of the branch this environment follows.
if (git(['status', '--porcelain']))
  fail('The working tree has changes. Deploy only committed code.');
git(['fetch', 'origin', '--quiet']);
const head = git(['rev-parse', 'HEAD']);
const branch = env === 'production' ? 'main' : 'dev';
const tip = git(['rev-parse', `origin/${branch}`]);
if (head !== tip) {
  if (env === 'production' || !anyCommit) {
    fail(
      `HEAD is not origin/${branch}. ${env} deploys origin/${branch} only.` +
        (env === 'staging' ? ' Add --any-commit to test another commit on staging.' : ''),
    );
  }
  console.log(`Deploying ${head} to staging, which is not origin/dev. Redeploy dev after testing.`);
}

await guardProduction(env, `deploy ${head.slice(0, 12)}`);

// 2. Migrations come first. Wrangler prints "No migrations to apply" when D1 is up to date.
const pending = bin('wrangler', ['d1', 'migrations', 'list', 'DB', '--remote', '--env', env], {
  env: credentials,
  capture: true,
});
if (!pending.stdout.includes('No migrations to apply')) {
  console.log(pending.stdout);
  fail(`D1 has migrations to apply. Run pnpm web:db:migrate:${env} first, then deploy.`);
}

// 3. Build for this environment and deploy. The version carries the commit as its tag.
const sha = buildWorker(env);
const result = await runTee(
  'pnpm',
  [
    'exec',
    'opennextjs-cloudflare',
    'deploy',
    '--env',
    env,
    '--tag',
    sha,
    '--message',
    `${env}-${sha}`,
  ],
  { env: credentials },
);
if (result.status !== 0) fail('Deploy failed. The live version is unchanged.');

// 4. Smoke check the live Worker.
const url =
  vars.get(`BR_${env.toUpperCase()}_URL`) ||
  result.stdout.match(/https:\/\/[^\s]+\.workers\.dev/)?.[0];
if (!url) fail(`Deployed, but no URL was found. Run pnpm web:smoke <url> by hand.`);
console.log(`\nSmoke check: ${url}`);
const ok = await smoke(url, { expectVersion: sha });
if (!ok) {
  fail(
    `Deployed ${sha} to ${env}, but the smoke check failed. Roll back: pnpm web:rollback:${env}`,
  );
}
console.log(`\nDeployed ${sha} to ${env}: ${url}`);
