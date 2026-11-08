import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { FILM_EXIT } from '@boiler-room/film-runner/contract';
import {
  CONTRACT_USAGE,
  type ContractArgs,
  isContractCall,
  parseContractArgs,
  runFilmCommand,
  stopOnSignals,
} from '../film/command.ts';
import { NaiveCrew } from '../film/crew.ts';
import { EventLog } from '../film/events.ts';
import { FILM_FORMATS, FILM_LENGTHS, type FilmFormat, type FilmLength } from '../film/order.ts';
import {
  DEFAULT_MAX_MICRO_USD,
  type FilmManifest,
  MANIFEST_FILE,
  makeFilm,
  newRunId,
  orderProblem,
  readManifest,
  writeJson,
} from '../film/run.ts';
import { naiveClient, scrub, usd } from '../naive/client.ts';
import { siteHost } from '../researcher/text.ts';
import { checkAgents } from '../sync.ts';

const usage = `Usage: pnpm film <url> [--length short|standard] [--format 16:9] [--sample] [--max-usd 5]

  Researches the site, writes the campaign, art-directs it, renders it on Naive computers and has
  Quality Check review the film. A failure the Director or the Art Director can fix goes back to
  them, and the film is rendered and checked again: at most 2 route-backs.

  --length    short (25 s) or standard (45 s). Default short with --sample, else standard.
  --format    16:9, 9:16 or 1:1. Default 16:9.
  --sample    An outreach sample: made unasked for a lead. Short, by rule 1.
  --max-usd   The hard cap on everything the film spends: agent sessions, render computers and
              generated media, route-backs included. Default ${(DEFAULT_MAX_MICRO_USD / 1e6).toFixed(0)}.

Everything goes in out/films/<host>/<run-id>/: research/, round-<n>/, film.mp4, campaign.json,
qc-report.json, manifest.json and decisions.json.

Exit codes: 0 the film passed Quality Check, 3 a film was made but did not pass, 1 no film, 2 a
usage error.

The film runner calls it with --phase instead (src/film/command.ts):

${CONTRACT_USAGE}`;

const out = fileURLToPath(new URL('../../../out/', import.meta.url));
const say = (line: string) =>
  console.log(scrub(`${new Date().toISOString().slice(11, 19)} ${line}`));

/**
 * The film runner's call: one phase of a film in a run dir, reported to `--events`. SIGTERM and
 * SIGINT stop every live session and exit 143 within 60 s, whatever the crew is doing.
 */
async function contract(argv: string[]): Promise<never> {
  const args = parseContractArgs(argv);
  if ('problem' in args) {
    console.error(`${args.problem}\n\n${CONTRACT_USAGE}`);
    process.exit(FILM_EXIT.badInput);
  }
  const controller = new AbortController();
  stopOnSignals(controller, say);
  let client: ReturnType<typeof naiveClient>;
  try {
    // The key is read from BOILER_ROOM_ENV when it is set, and never printed or passed in argv.
    client = naiveClient();
  } catch (cause) {
    noKey(args, cause);
  }
  const crew = new NaiveCrew({
    outRoot: out,
    signal: controller.signal,
    log: say,
    renderRunner: args.render,
    agentSync: args.sync ? 'sync' : 'verify',
  });
  const code = await runFilmCommand(args, {
    crew,
    sessions: client,
    checkAgents: async (definitions) => (await checkAgents(client, definitions)).drift,
    log: say,
    signal: controller.signal,
  });
  say(`exit ${code}`);
  process.exit(code);
}

function noKey(args: ContractArgs, cause: unknown): never {
  const events = new EventLog(args.eventsFile, args.runDir);
  events.error(
    'no_naive_key',
    'The film computer has no Naive key for the crew, so nothing was started.',
    null,
    false,
  );
  events.close();
  console.error(cause instanceof Error ? cause.message : String(cause));
  process.exit(FILM_EXIT.failed);
}

if (isContractCall(process.argv.slice(2))) await contract(process.argv.slice(2));

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    length: { type: 'string' },
    format: { type: 'string', default: '16:9' },
    sample: { type: 'boolean', default: false },
    'max-usd': { type: 'string' },
    // Set by LocalFilmOrder, so it knows the film's folder before the film starts.
    'run-id': { type: 'string' },
    'order-id': { type: 'string' },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

const fail = (text: string): never => {
  console.error(text);
  process.exit(2);
};

const url = positionals[0];
if (values.help || !url || positionals.length > 1) {
  console.log(usage);
  process.exit(values.help ? 0 : 2);
}
const sample = values.sample ?? false;
const length = (values.length ?? (sample ? 'short' : 'standard')) as FilmLength;
if (!FILM_LENGTHS.includes(length)) fail(`--length must be one of ${FILM_LENGTHS.join(', ')}.`);
const format = values.format as FilmFormat;
if (!FILM_FORMATS.includes(format)) fail(`--format must be one of ${FILM_FORMATS.join(', ')}.`);
const maxUsd =
  values['max-usd'] === undefined ? DEFAULT_MAX_MICRO_USD / 1e6 : Number(values['max-usd']);
if (!(maxUsd > 0 && maxUsd <= 25))
  fail('--max-usd must be a number of dollars above 0 and at most 25.');
const given = values['run-id'];
if (given !== undefined && !/^[a-z0-9-]{4,64}$/.test(given))
  fail('--run-id must be a lowercase slug.');
const runId = given ?? newRunId(new Date());
const maxMicroUsd = Math.round(maxUsd * 1e6);
const problem = orderProblem({ url, length, sample, maxMicroUsd });
if (problem) fail(problem);

const controller = new AbortController();
const crew = new NaiveCrew({ outRoot: out, signal: controller.signal, log: say });

// Ctrl-C or SIGTERM (a withdrawn order): stop the render, close every session, mark the film.
let stopping = false;
const onSignal = (signal: string) => {
  if (stopping) return;
  stopping = true;
  say(`${signal}: stopping the film`);
  controller.abort();
  void crew.stop().finally(() => {
    const dir = join(out, 'films', siteHost(url), runId);
    const manifest: FilmManifest | undefined = readManifest(dir);
    if (manifest && manifest.state === 'working') {
      writeJson(join(dir, MANIFEST_FILE), {
        ...manifest,
        state: manifest.film ? 'ready' : 'failed',
        failure: `interrupted by ${signal}`,
        pid: null,
        finishedAt: new Date().toISOString(),
      });
    }
    process.exit(130);
  });
};
process.on('SIGINT', () => onSignal('SIGINT'));
process.on('SIGTERM', () => onSignal('SIGTERM'));

const manifest = await makeFilm(
  {
    url,
    length,
    format,
    sample,
    maxMicroUsd,
    outRoot: join(out, 'films'),
    runId,
    ...(values['order-id'] ? { order: { orderId: values['order-id'] } } : {}),
  },
  { crew, sessions: naiveClient(), log: say, signal: controller.signal },
);

const dir = join(out, 'films', manifest.host, manifest.runId);
const spend = manifest.spend;
console.log('');
console.log(
  `FILM ${manifest.host} ${manifest.runId}: ${manifest.state}, Quality Check ${manifest.qc}`,
);
if (manifest.failure) console.log(`  why: ${manifest.failure}`);
for (const stage of manifest.stages) {
  console.log(
    `  round ${stage.round} ${stage.step.padEnd(13)} ${stage.outcome.padEnd(7)} ${String(stage.seconds).padStart(7)} s  ${usd(stage.cost.totalMicroUsd)}${stage.sessionIds.length ? `  ${stage.sessionIds.join(', ')}` : ''}`,
  );
}
console.log(
  `  spent ${usd(spend.totalMicroUsd)} of ${usd(spend.capMicroUsd)}: model ${usd(spend.modelMicroUsd)}, compute ${usd(spend.computeMicroUsd)}, media ${usd(spend.mediaMicroUsd)}; ${manifest.routeBacks} route-back(s)`,
);
console.log(`  ${dir}`);
process.exit(manifest.state === 'ready' ? (manifest.qc === 'pass' ? 0 : 3) : 1);
