#!/usr/bin/env node
// pnpm web:provision:<env> — creates the environment's D1 database and R2 bucket if they do not
// exist, and writes the database id into wrangler.jsonc. Commit that change by pull request.
// Safe to run again: it only creates what is missing.
import {
  bin,
  environmentArg,
  fail,
  guardProduction,
  readEnvFile,
  requireCloudflare,
} from './lib/env.mjs';
import { environmentConfig, writeDatabaseId } from './lib/wrangler-config.mjs';

const env = environmentArg();
const credentials = requireCloudflare(readEnvFile());
const target = environmentConfig(env);
await guardProduction(env, 'create D1 and R2 resources');

// D1. `--update-config=false`: this script writes the id itself, into the right environment.
const listDatabases = () =>
  JSON.parse(bin('wrangler', ['d1', 'list', '--json'], { env: credentials, capture: true }).stdout);
let database = listDatabases().find((db) => db.name === target.databaseName);
if (database) {
  console.log(`D1 ${target.databaseName} exists: ${database.uuid}`);
} else {
  bin('wrangler', ['d1', 'create', target.databaseName, '--update-config=false'], {
    env: credentials,
  });
  database = listDatabases().find((db) => db.name === target.databaseName);
  if (!database) fail(`D1 ${target.databaseName} was not created.`);
  console.log(`Created D1 ${target.databaseName}: ${database.uuid}`);
}
if (!database.uuid) fail('Could not read the D1 database id.');
if (target.databaseId !== database.uuid) {
  writeDatabaseId(env, database.uuid);
  console.log(`Wrote the database id into wrangler.jsonc env.${env}. Commit it by pull request.`);
}

// R2
const buckets = bin('wrangler', ['r2', 'bucket', 'list'], {
  env: credentials,
  capture: true,
}).stdout;
if (new RegExp(`name:\\s+${target.bucketName}\\b`).test(buckets)) {
  console.log(`R2 ${target.bucketName} exists`);
} else {
  bin('wrangler', ['r2', 'bucket', 'create', target.bucketName], { env: credentials });
}

console.log(
  `\nNext: pnpm web:secrets:sync:${env}, pnpm web:db:migrate:${env}, pnpm web:deploy:${env}`,
);
