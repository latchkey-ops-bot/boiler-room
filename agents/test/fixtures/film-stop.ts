/**
 * The film command as a process, with a crew whose research never ends, for the SIGTERM test in
 * `film-command.test.ts`: `tsx film-stop.ts <run dir> <events file>`. It wires its signals with
 * the command's own `stopOnSignals`, as `pnpm film --phase` does, and calls no agent.
 */
import { filmCommandArgs } from '@boiler-room/film-runner/contract';
import { parseContractArgs, runFilmCommand, stopOnSignals } from '../../src/film/command.ts';

const [runDir = '', eventsFile = ''] = process.argv.slice(2);
const args = parseContractArgs(
  filmCommandArgs({
    url: 'https://www.nova.example/',
    phase: 'script',
    runDir,
    eventsFile,
    maxUsd: 3,
  }),
);
if ('problem' in args) throw new Error(args.problem);
const controller = new AbortController();
stopOnSignals(controller);
// A live session holds the process open, as a stream from Naive does.
const never = () =>
  new Promise<never>(() => {
    setInterval(() => {}, 1000);
    console.log('research started');
  });
const crew = {
  research: never,
  direct: never,
  art: never,
  gate: never,
  render: never,
  qc: never,
  // Closing sessions on Naive takes a moment.
  stop: () => new Promise<void>((resolve) => setTimeout(resolve, 200)),
};
const code = await runFilmCommand(args, {
  crew,
  sessions: {
    sessions: {
      get: async () => ({ status: 'idle', consumed_micro_usd: 0 }),
      interrupt: async () => ({}),
      cancel: async () => ({}),
    },
  } as never,
  checkAgents: async () => [],
  signal: controller.signal,
});
process.exit(code);
