/**
 * A stand-in for `pnpm render`: it guards a run that logs while it waits, and whose cleanup writes a
 * file, the way renderCampaign's `finally` destroys the computers. Run with plain `node`.
 *
 *   node guarded-run.ts <marker file>
 */
import { writeFileSync } from 'node:fs';
import { guardRun } from '../../src/guard.ts';

const marker = process.argv[2] as string;
const controller = new AbortController();
const guard = guardRun(controller);
const ticker = setInterval(() => guard.log('working'), 20);
try {
  await new Promise((_resolve, reject) => {
    controller.signal.addEventListener('abort', () => reject(controller.signal.reason), {
      once: true,
    });
  });
} catch {
  // The run stopped, which is what the test does to it.
} finally {
  clearInterval(ticker);
  const reason = controller.signal.reason as Error | undefined;
  writeFileSync(marker, reason?.message ?? 'not stopped');
  guard.dispose();
}
