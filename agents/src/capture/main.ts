import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { checkResearch, formatFailures } from '../researcher/gate.ts';
import { pagesBundleSchema } from '../researcher/verify.ts';
import { DONE, startJob, waitJob } from './jobs.ts';
import { capture, discover, setup } from './run.ts';

/**
 * The Researcher's capture tool. It runs on the agent's own computer as one bundled file next to
 * its `node_modules`, and does every page load, measurement and check the agent relies on:
 *
 *   setup                     install Playwright and Chromium, turn on swap (background job)
 *   discover <url>            load the home page, probe for product UI, suggest pages (background)
 *   capture <url> <pages...>  capture the chosen pages and build the bundle (background)
 *   wait                      wait up to 25 s for the running job and print its summary
 *   verify <result.json>      check a result against the stored text before submitting it
 */

const script = resolve(process.argv[1] ?? 'br-research.mjs');
const base = dirname(script);
const [command, ...args] = process.argv.slice(2);
const JOB_LIMIT_MS = 15 * 60_000;

const usage = `Usage: node ${script} setup | discover <url> | capture <url> [page urls...] | wait | verify <result.json>`;

function requireUrl(value: string | undefined): string {
  if (!value || !/^https?:\/\//i.test(value))
    throw new Error(`Expected an http(s) address. ${usage}`);
  return value;
}

async function runJob(name: string, jobArgs: string[]): Promise<void> {
  const limit = setTimeout(() => {
    console.log(`${DONE} ${name} failed: stopped after ${JOB_LIMIT_MS / 60_000} minutes`);
    process.exit(2);
  }, JOB_LIMIT_MS);
  limit.unref();
  try {
    if (name === 'setup') setup(base);
    else if (name === 'discover') await discover(base, requireUrl(jobArgs[0]), script);
    else if (name === 'capture')
      await capture(base, requireUrl(jobArgs[0]), jobArgs.slice(1), script);
    else throw new Error(`Unknown job ${name}`);
    console.log(`${DONE} ${name} ok`);
  } catch (cause) {
    console.log(
      `${DONE} ${name} failed: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  } finally {
    process.exit(0);
  }
}

async function verify(path: string | undefined): Promise<void> {
  if (!path || !existsSync(path)) throw new Error(`Give the path of your result JSON. ${usage}`);
  const pagesPath = join(dirname(resolve(path)), 'pages.json');
  if (!existsSync(pagesPath))
    throw new Error(`${pagesPath} is missing. Keep result.json in the capture output folder.`);
  const bundle = pagesBundleSchema.parse(JSON.parse(readFileSync(pagesPath, 'utf8')));
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (cause) {
    console.log(
      `VERIFY FAILED: ${path} is not valid JSON: ${cause instanceof Error ? cause.message : cause}`,
    );
    process.exitCode = 1;
    return;
  }
  const { failures, output } = await checkResearch(raw, bundle);
  if (failures.length === 0) {
    console.log(
      `VERIFY OK: ${output?.claims.length ?? 0} claims checked against the stored text of ${bundle.pages.length} pages.`,
    );
    console.log('Now call submit_output with exactly the contents of this file.');
    return;
  }
  console.log(
    `VERIFY FAILED: ${failures.length} problem(s). Fix every one, then run verify again.\n`,
  );
  console.log(formatFailures(failures));
  process.exitCode = 1;
}

async function main(): Promise<void> {
  switch (command) {
    case '__run':
      await runJob(args[0] ?? '', args.slice(1));
      return;
    case 'setup':
      startJob(base, script, 'setup', [], join(base, 'jobs', 'setup-summary.txt'));
      return;
    case 'discover':
      startJob(
        base,
        script,
        'discover',
        [requireUrl(args[0])],
        join(base, 'jobs', 'discover-summary.txt'),
      );
      return;
    case 'capture':
      startJob(
        base,
        script,
        'capture',
        [requireUrl(args[0]), ...args.slice(1)],
        join(base, 'jobs', 'capture-summary.txt'),
      );
      return;
    case 'wait':
      await waitJob(base, script);
      return;
    case 'verify':
      await verify(args[0]);
      return;
    default:
      console.log(usage);
      process.exitCode = command ? 1 : 0;
  }
}

main().catch((cause) => {
  console.log(cause instanceof Error ? cause.message : String(cause));
  process.exitCode = 1;
});
