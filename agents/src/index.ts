export type { AgentDefinition, SkillDefinition, Toolset } from './define.ts';
export { agents, researcher } from './definitions/index.ts';
export type { GateFailure } from './researcher/gate.ts';
export {
  checkProvenance,
  checkResearch,
  withMeasuredColors,
  withoutClaims,
} from './researcher/gate.ts';
export type { Brief, MeasuredColor, NeedUpload, ResearchOutput } from './researcher/output.ts';
export {
  COLOR_TOKENS,
  fileIdOf,
  LOGO_PLACEMENTS,
  measuredColorSchema,
  NAIVE_FILE_PREFIX,
  naiveFileSrc,
  researchOutputJsonSchema,
  researchOutputSchema,
} from './researcher/output.ts';
export type { Failure, PagesBundle, StoredPage } from './researcher/verify.ts';
export { pagesBundleSchema, unmeasuredColors, verifyResearch } from './researcher/verify.ts';
export { syncAgents } from './sync.ts';
