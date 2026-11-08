import type { AgentDefinition } from '../define.ts';
import { qualityCheck } from './quality-check.ts';
import { researcher } from './researcher.ts';

/** Every agent of the company. `pnpm agents:sync` makes Naive match this list. */
export const agents: readonly AgentDefinition[] = [researcher, qualityCheck];

export { qualityCheck, researcher };
