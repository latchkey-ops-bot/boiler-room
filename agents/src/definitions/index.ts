import type { AgentDefinition } from '../define.ts';
import { artDirector } from './art-director.ts';
import { researcher } from './researcher.ts';

/** Every agent of the company. `pnpm agents:sync` makes Naive match this list. */
export const agents: readonly AgentDefinition[] = [researcher, artDirector];

export { artDirector, researcher };
