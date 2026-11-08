import { readFileSync } from 'node:fs';
import type { Campaign } from '../src/index.ts';

const skill = new URL('../../../skills/director/SKILL.md', import.meta.url);

/**
 * A fresh copy of the worked example in the Director skill, read from its one fenced JSON block,
 * so the tests check the file agents actually read.
 */
export function directorExample(): Campaign {
  const body = readFileSync(skill, 'utf8');
  const blocks = [...body.matchAll(/^```json\n([\s\S]*?)^```$/gm)];
  const [block, ...others] = blocks;
  if (!block?.[1] || others.length > 0) {
    throw new Error('skills/director/SKILL.md must hold exactly one fenced JSON block');
  }
  return JSON.parse(block[1]) as Campaign;
}
