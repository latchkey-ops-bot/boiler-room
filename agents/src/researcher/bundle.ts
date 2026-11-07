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

/**
 * Bundles the capture tool, with the verifier and the schema validator inside it, into one ES
 * module the agent's computer runs with plain Node. Playwright stays external: the tool installs
 * it on that computer.
 */
export async function bundleTool(): Promise<ToolBundle> {
  const result = await build({
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
