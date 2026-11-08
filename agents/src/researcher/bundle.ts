import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

export const TOOL_NAME = 'br-research.mjs';

const ENTRY = fileURLToPath(new URL('../capture/main.ts', import.meta.url));

export interface ToolBundle {
  name: string;
  code: string;
  sha256: string;
}

export interface BundleOptions {
  /**
   * Hosts this build may load although they resolve to a private address. Only the
   * prompt-injection test sets one, for the fixture it serves on the agent's loopback. It is
   * compiled in, so it changes the file's digest, and nothing at run time can add to it.
   */
  allowPrivateHosts?: readonly string[];
}

/**
 * Bundles the capture tool, with the verifier and the schema validator inside it, into one ES
 * module the agent's computer runs with plain Node. Playwright stays external: the tool installs
 * it on that computer.
 */
export async function bundleTool(options: BundleOptions = {}): Promise<ToolBundle> {
  const result = await build({
    define: {
      __BR_ALLOW_PRIVATE_HOSTS__: JSON.stringify(options.allowPrivateHosts ?? []),
    },
    entryPoints: [ENTRY],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    external: ['playwright'],
    write: false,
    legalComments: 'none',
    banner: {
      js: '// Boiler Room Researcher capture tool. Generated from agents/src/capture; do not edit.',
    },
  });
  const code = result.outputFiles[0]?.text;
  if (!code) throw new Error('esbuild produced no output for the capture tool');
  return { name: TOOL_NAME, code, sha256: createHash('sha256').update(code).digest('hex') };
}
