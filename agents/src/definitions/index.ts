import type { AgentDefinition } from '../define.ts';
import { artDirector } from './art-director.ts';
import { director } from './director.ts';
import { qualityCheck } from './quality-check.ts';
import { researcher } from './researcher.ts';

/** Every agent of the company. `pnpm agents:sync` makes Naive match this list. */
export const agents: readonly AgentDefinition[] = [researcher, director, artDirector, qualityCheck];

export { artDirector, director, qualityCheck, researcher };
