#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import process from 'node:process';
import { sceneRegistry, validateCampaign } from '../src/index.ts';

/**
 * Validates one campaign file with `sceneRegistry` and prints `{ ok, issues }` as JSON on stdout.
 * Exits 0 when `ok` is true, 1 when it is false, and 2 when the file cannot be read or parsed.
 *
 *   node packages/schema/bin/validate.ts campaign.json
 */
async function main(args: readonly string[]): Promise<number> {
  const [file, ...rest] = args;
  if (!file || rest.length > 0) {
    process.stderr.write('Usage: node packages/schema/bin/validate.ts <campaign.json>\n');
    return 2;
  }

  let input: unknown;
  try {
    input = JSON.parse(await readFile(file, 'utf8'));
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    process.stderr.write(`Cannot read ${file} as JSON: ${reason}\n`);
    return 2;
  }

  const { ok, issues } = await validateCampaign(input, { sceneRegistry });
  process.stdout.write(`${JSON.stringify({ ok, issues }, null, 2)}\n`);
  return ok ? 0 : 1;
}

process.exitCode = await main(process.argv.slice(2));
