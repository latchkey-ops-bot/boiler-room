import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

const versionOf = (pkg: string): string =>
  (JSON.parse(readFileSync(require.resolve(`${pkg}/package.json`), 'utf8')) as { version: string })
    .version;

/** The renderer the computers install is the one this package resolves, so the two never differ. */
export const REMOTION_VERSION = versionOf('@remotion/renderer');

const MOTION_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.resolve('@boiler-room/motion'))),
  '..',
);

export interface TemplateVersion {
  package: string;
  version: string;
  /** The last commit that touched the templates, when this is a git checkout. */
  commit: string | null;
  /** Whether the templates have changes that are not committed. */
  modified: boolean | null;
}

export function templateVersion(): TemplateVersion {
  const pkg = JSON.parse(readFileSync(path.join(MOTION_DIR, 'package.json'), 'utf8')) as {
    name: string;
    version: string;
  };
  const git = (args: string[]) =>
    execFileSync('git', args, {
      cwd: MOTION_DIR,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  let commit: string | null = null;
  let modified: boolean | null = null;
  try {
    commit = git(['log', '-1', '--format=%H', '--', '.']) || null;
    modified = git(['status', '--porcelain', '--', '.']) !== '';
  } catch {
    // Not a git checkout, or no git: the bundle hash still identifies the templates.
  }
  return { package: pkg.name, version: pkg.version, commit, modified };
}
