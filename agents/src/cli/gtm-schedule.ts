import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { crontabLine, serviceUnit, TIMER_NAME, timerUnit } from '../gtm/schedule.ts';

/**
 * `pnpm gtm:schedule`: the daily dry-run schedule as a systemd user timer.
 *
 *   (no flag)   prints the two units and the crontab line, and changes nothing
 *   --install   writes the units to ~/.config/systemd/user, paused: the timer is not enabled
 *   --enable    enables and starts the timer (05:00 Pacific, every day)
 *   --disable   stops and disables it
 */
const { values } = parseArgs({
  options: {
    install: { type: 'boolean', default: false },
    enable: { type: 'boolean', default: false },
    disable: { type: 'boolean', default: false },
  },
});
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\/$/, '');
const pnpm = (() => {
  try {
    return execFileSync('which', ['pnpm'], { encoding: 'utf8' }).trim();
  } catch {
    return 'pnpm';
  }
})();
const unitDir = join(homedir(), '.config', 'systemd', 'user');
const systemctl = (...args: string[]) =>
  execFileSync('systemctl', ['--user', ...args], { stdio: 'inherit' });

if (values.install) {
  mkdirSync(unitDir, { recursive: true });
  writeFileSync(join(unitDir, `${TIMER_NAME}.service`), serviceUnit(repoRoot, pnpm));
  writeFileSync(join(unitDir, `${TIMER_NAME}.timer`), timerUnit());
  systemctl('daemon-reload');
  console.log(
    `Installed ${TIMER_NAME}.service and ${TIMER_NAME}.timer in ${unitDir}, paused. Start it with pnpm gtm:schedule --enable.`,
  );
} else if (values.enable) {
  if (!existsSync(join(unitDir, `${TIMER_NAME}.timer`))) {
    console.error('Install the units first: pnpm gtm:schedule --install');
    process.exit(1);
  }
  systemctl('enable', '--now', `${TIMER_NAME}.timer`);
  systemctl('list-timers', `${TIMER_NAME}.timer`);
} else if (values.disable) {
  systemctl('disable', '--now', `${TIMER_NAME}.timer`);
} else {
  console.log(`# ${unitDir}/${TIMER_NAME}.service\n${serviceUnit(repoRoot, pnpm)}`);
  console.log(`# ${unitDir}/${TIMER_NAME}.timer\n${timerUnit()}`);
  console.log(`# Or one crontab line:\n${crontabLine(repoRoot, pnpm)}`);
}
