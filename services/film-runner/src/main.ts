/**
 * The runner's entry point on a film's computer. Started by the website's launch command:
 *
 *   setsid -f bash -c 'exec flock -n "$HOME/br-run/lock" node src/main.ts'
 *
 * `node src/main.ts --self-test` checks the computer instead, for the snapshot build.
 *
 * Node 24 runs this TypeScript directly; the package has no runtime dependencies.
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readConfig } from './film-command.ts';
import { Runner } from './runner.ts';
import { selfTest } from './self-test.ts';

const runDir = process.env.BR_RUN_DIR ?? join(homedir(), 'br-run');
const stamp = (line: string) => console.log(`${new Date().toISOString()} ${line}`);

async function main(): Promise<number> {
  if (process.argv.includes('--self-test')) {
    return selfTest({ runDir, allowRunDir: process.argv.includes('--allow-run-dir') });
  }
  let config: ReturnType<typeof readConfig>;
  try {
    config = readConfig();
  } catch (error) {
    stamp(`config: ${error instanceof Error ? error.message : String(error)}`);
    return 20;
  }
  const runner = new Runner({ runDir, config, log: stamp });
  for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) {
    process.on(signal, () => runner.requestStop(`${signal} from the computer`));
  }
  return runner.run();
}

main().then(
  (code) => process.exit(code),
  (error) => {
    stamp(`crash: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
    process.exit(1);
  },
);
