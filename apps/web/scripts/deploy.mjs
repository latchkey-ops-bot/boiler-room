#!/usr/bin/env node
// pnpm web:deploy:<env> — builds and deploys the Worker, then runs the smoke check.
//
// Staging deploys the commit at the tip of origin/dev; production deploys the tip of origin/main.
// `--any-commit` lets staging deploy another commit, such as a hotfix branch, for a test.
// It refuses to deploy while D1 has migrations the new code may need: migrate first.
//
// Production asks a person to type "production". The release agent has no terminal, so it passes
// `--release-card crd_...` instead (guardProduction in lib/env.mjs). On that path a failed smoke
// check rolls production back to the version that was live before, by itself.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildWorker } from './build.mjs';
import {
  bin,
  environmentArg,
  fail,
  git,
  guardProduction,
  liveVersionId,
  migrationsPending,
  REPO_DIR,
  readEnvFile,
  requireCloudflare,
  runTee,
  scriptArgs,
  settleRelease,
} from './lib/env.mjs';
import { CONTRACT_FILE, contractDrift } from './lib/runner-secrets.mjs';
import { environmentConfig } from './lib/wrangler-config.mjs';
import { smoke } from './smoke.mjs';

const env = environmentArg();
const anyCommit = scriptArgs().flags['any-commit'] === true;
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

// The runner in the base snapshot must speak the contract this commit deploys.
const drift = contractDrift(
  target.vars,
  readFileSync(join(REPO_DIR, CONTRACT_FILE), 'utf8'),
  (commit, path) => git(['show', `${commit}:${path}`]),
);
if (drift) fail(drift);

const card = await guardProduction(env, `deploy ${head.slice(0, 12)}`, { step: 'deploy' });

// 2. Migrations come first. Wrangler prints "No migrations to apply" when D1 is up to date.
const pending = bin('wrangler', ['d1', 'migrations', 'list', 'DB', '--remote', '--env', env], {
  env: credentials,
  capture: true,
});
if (migrationsPending(pending.stdout)) {
  console.log(pending.stdout);
  fail(
    `D1 has migrations to apply. Run pnpm web:db:migrate:${env}${card ? ` --release-card ${card}` : ''} first, then deploy.`,
  );
}

// A release remembers what is live now, so a failed smoke check can go back to it.
const previous = card
  ? liveVersionId(
      bin('wrangler', ['deployments', 'status', '--env', env, '--json'], {
        env: credentials,
        capture: true,
        allowFail: true,
      }).stdout,
    )
  : null;
if (card) console.log(`Live before this release: ${previous ?? 'nothing (first deploy)'}`);

// 3. Build for this environment and deploy. The version carries the commit as its tag, and a
// release's message names its card.
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
    card ? `${env}-${sha} release-card:${card}` : `${env}-${sha}`,
  ],
  { env: credentials },
);
if (result.status !== 0) fail('Deploy failed. The live version is unchanged.');

// 4. Smoke check the live Worker.
const url =
  vars.get(`BR_${env.toUpperCase()}_URL`) ||
  result.stdout.match(/https:\/\/[^\s]+\.workers\.dev/)?.[0];
if (card) {
  if (url) console.log(`\nSmoke check: ${url}`);
  const outcome = await settleRelease({
    smokeOk: url ? await smoke(url, { expectVersion: sha }) : false,
    url,
    previous,
    rollBack: async (versionId) =>
      bin(
        'wrangler',
        [
          'rollback',
          versionId,
          '--env',
          env,
          '--yes',
          '--message',
          `Automatic rollback of ${sha}: smoke check failed. release-card:${card}`,
        ],
        { env: { ...credentials, CI: '1' }, allowFail: true },
      ).status === 0,
    smokeAgain: () => smoke(url),
  });
  if (!outcome.ok) fail(`${sha} on ${env}: ${outcome.message}`);
  console.log(`\nReleased ${sha} to ${env} on ${card}: ${url}`);
} else {
  if (!url) fail(`Deployed, but no URL was found. Run pnpm web:smoke <url> by hand.`);
  console.log(`\nSmoke check: ${url}`);
  const ok = await smoke(url, { expectVersion: sha });
  if (!ok) {
    fail(
      `Deployed ${sha} to ${env}, but the smoke check failed. Roll back: pnpm web:rollback:${env}`,
    );
  }
  console.log(`\nDeployed ${sha} to ${env}: ${url}`);
}
