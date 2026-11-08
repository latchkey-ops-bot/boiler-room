/**
 * `node src/main.ts --self-test`: what the base snapshot must hold before it is snapshotted, and
 * what a fork must still hold. Prints one JSON line and exits 0 only when every check passes.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { deriveRunKey, sha256Hex, signCanonical, verifyCanonical } from './contract.ts';
import { readConfig, STANDIN_PATH } from './film-command.ts';

interface Check {
  name: string;
  ok: boolean;
  detail?: string;
}

const has = (tool: string) =>
  spawnSync('sh', ['-c', `command -v ${tool}`], { encoding: 'utf8' }).status === 0;

export async function selfTest({
  runDir,
  allowRunDir,
}: {
  runDir: string;
  allowRunDir: boolean;
}): Promise<number> {
  const checks: Check[] = [];
  const add = (name: string, ok: boolean, detail?: string) =>
    checks.push({ name, ok, ...(detail ? { detail } : {}) });

  const major = Number(process.versions.node.split('.')[0]);
  add('node 24 or later', major >= 24, process.version);
  add('flock', has('flock'));
  add('setsid', has('setsid'));

  let configOk = false;
  try {
    const config = readConfig();
    configOk = true;
    add(
      'config',
      true,
      `adapter ${config.adapter}, runner ${config.runnerCommit.slice(0, 12)}, film ${config.filmCommit.slice(0, 12)}`,
    );
    if (config.adapter === 'standin') {
      add('stand-in film command', existsSync(STANDIN_PATH));
    } else {
      let script = false;
      try {
        const pkg = JSON.parse(readFileSync(join(config.filmDir, 'package.json'), 'utf8'));
        script = typeof pkg.scripts?.film === 'string';
      } catch {
        script = false;
      }
      add('film command (pnpm film)', script);
      add('pnpm', has('pnpm'));
    }
    if (existsSync(config.envFile)) {
      const mode = statSync(config.envFile).mode & 0o777;
      add('key file is private', (mode & 0o077) === 0, mode.toString(8));
    } else {
      add(
        'key file',
        config.adapter === 'standin',
        config.adapter === 'standin' ? 'absent; the stand-in needs none' : 'missing',
      );
    }
    if (config.swapfile) {
      let on = false;
      try {
        on = readFileSync('/proc/swaps', 'utf8').includes(config.swapfile);
      } catch {
        on = false;
      }
      add('swap file', existsSync(config.swapfile), on ? 'on' : 'off; the runner turns it on');
    }
  } catch (error) {
    add('config', false, error instanceof Error ? error.message : String(error));
  }
  if (!configOk) add('config readable', false);

  add('no run dir yet', allowRunDir || !existsSync(runDir), runDir);

  // WebCrypto, as the contract uses it.
  const key = await deriveRunKey(
    'x'.repeat(43),
    'flm_00000000000000000000',
    'run_00000000000000000000',
  );
  const canonical = await sha256Hex('self-test');
  add('signing', await verifyCanonical(key, canonical, await signCanonical(key, canonical)));

  const ok = checks.every((check) => check.ok);
  console.log(JSON.stringify({ selfTest: ok ? 'pass' : 'fail', checks }));
  return ok ? 0 : 1;
}
