import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getPlatformProxy } from 'wrangler';
import { type Bindings, createContext, type Principal } from '../src/server/api/context.ts';

const APP_DIR = join(import.meta.dirname, '..');

/** A real local D1 and R2 in workerd, fresh for each test file, with every migration applied. */
export async function startWorkerEnv() {
  const proxy = await getPlatformProxy<CloudflareEnv>({
    configPath: join(APP_DIR, 'wrangler.jsonc'),
    persist: false,
  });
  const dir = join(APP_DIR, 'drizzle');
  for (const file of readdirSync(dir)
    .filter((name) => name.endsWith('.sql'))
    .sort()) {
    const sql = readFileSync(join(dir, file), 'utf8');
    for (const statement of sql.split('--> statement-breakpoint')) {
      if (statement.trim()) await proxy.env.DB.prepare(statement).run();
    }
  }
  return proxy;
}

/** A clock the test moves by hand. */
export function testClock(start = '2026-11-07T12:00:00.000Z') {
  let now = new Date(start).getTime();
  return {
    now: () => new Date(now),
    advance(seconds: number) {
      now += seconds * 1000;
    },
  };
}

export function contextFor(
  principal: Principal,
  env: CloudflareEnv,
  clock: () => Date,
  pipeline: 'simulated' | 'naive' = 'simulated',
) {
  const bindings: Bindings = { DB: env.DB, FILMS: env.FILMS, PIPELINE: pipeline };
  return createContext(principal, bindings, clock);
}
