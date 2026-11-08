import { TIMEZONE } from './config.ts';

/**
 * The daily schedule. Until the hosted executor exists (S2: a Cloudflare Worker on a 15-minute
 * cron), `pnpm gtm:day --dry-run` runs once a day at 05:00 Pacific from a systemd user timer. No
 * Naive deployment is used for GTM: a deployment's fire opens a `Recurring:` standing card that the
 * GTM agents, which hold no board tools, could never close.
 *
 * `pnpm gtm:schedule --install` writes the two units below with `enabled` off, so the schedule is
 * created paused; `--enable` starts it. The units always run a dry run: a live day needs the
 * hosted executor and the activation checklist.
 */

export const TIMER_NAME = 'boiler-room-gtm-day';
/** The hosted executor's cron (S2). Cloudflare cron reads UTC; each tick reads the Pacific clock. */
export const WORKER_CRON = '*/15 * * * *';
export const DAILY_AT = '05:00';

export function serviceUnit(repoRoot: string, pnpm: string): string {
  return `[Unit]
Description=Boiler Room GTM day (dry run)
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
WorkingDirectory=${repoRoot}
ExecStart=${pnpm} gtm:day --dry-run
TimeoutStartSec=2h
Nice=10
`;
}

export function timerUnit(): string {
  return `[Unit]
Description=Run the Boiler Room GTM day at ${DAILY_AT} Pacific

[Timer]
OnCalendar=*-*-* ${DAILY_AT}:00 ${TIMEZONE}
Persistent=true
Unit=${TIMER_NAME}.service

[Install]
WantedBy=timers.target
`;
}

/** The same schedule as one crontab line, for a machine without systemd. */
export const crontabLine = (repoRoot: string, pnpm: string) =>
  `CRON_TZ=${TIMEZONE}\n0 5 * * * cd ${repoRoot} && ${pnpm} gtm:day --dry-run >> out/gtm/cron.log 2>&1`;
