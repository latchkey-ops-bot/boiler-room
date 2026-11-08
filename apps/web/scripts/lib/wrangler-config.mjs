// Reads wrangler.jsonc, which has comments, and answers what the scripts need to know about one
// environment without starting wrangler.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { APP_DIR } from './env.mjs';

export const CONFIG_PATH = join(APP_DIR, 'wrangler.jsonc');
export const PLACEHOLDER_ID = 'PROVISION_ME';

/** Removes // and block comments outside strings, and trailing commas, so JSON.parse can read it. */
export function stripJsonc(text) {
  let out = '';
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];
    if (inString) {
      out += char;
      if (char === '\\') {
        out += next ?? '';
        i++;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      out += char;
    } else if (char === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
    } else if (char === '/' && next === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i++;
    } else {
      out += char;
    }
  }
  return out.replace(/,(\s*[}\]])/g, '$1');
}

export function readWranglerConfig() {
  return JSON.parse(stripJsonc(readFileSync(CONFIG_PATH, 'utf8')));
}

/** The Worker name, D1 database and R2 bucket of one environment. */
export function environmentConfig(env) {
  const config = readWranglerConfig();
  const section = config.env?.[env];
  if (!section) throw new Error(`wrangler.jsonc has no env.${env}`);
  const db = section.d1_databases?.find((binding) => binding.binding === 'DB');
  const bucket = section.r2_buckets?.find((binding) => binding.binding === 'FILMS');
  if (!db || !bucket) throw new Error(`env.${env} must bind DB and FILMS`);
  return {
    workerName: section.name,
    databaseName: db.database_name,
    databaseId: db.database_id,
    bucketName: bucket.bucket_name,
    provisioned: Boolean(db.database_id) && db.database_id !== PLACEHOLDER_ID,
    vars: section.vars ?? {},
  };
}

/** Puts `databaseId` into the D1 binding named `databaseName`, keeping everything else. */
export function replaceDatabaseId(text, databaseName, databaseId) {
  const pattern = new RegExp(
    `("database_name":\\s*"${databaseName}",[\\s\\S]*?"database_id":\\s*)"[^"]*"`,
  );
  if (!pattern.test(text)) throw new Error(`Could not find the D1 binding for ${databaseName}`);
  return text.replace(pattern, `$1"${databaseId}"`);
}

/** Writes a new database id into one environment's D1 binding, keeping the comments. */
export function writeDatabaseId(env, databaseId) {
  const { databaseName } = environmentConfig(env);
  const text = readFileSync(CONFIG_PATH, 'utf8');
  writeFileSync(CONFIG_PATH, replaceDatabaseId(text, databaseName, databaseId));
}
