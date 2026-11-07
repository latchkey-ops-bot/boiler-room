export type { Asset, Campaign, Claim, Scene, TextItem, TextRole } from './campaign.ts';
export {
  ASSET_KINDS,
  ASSET_PROVENANCES,
  CLAIM_STATUSES,
  campaignSchema,
  FORMATS,
  TEXT_ROLES,
} from './campaign.ts';
export type { CampaignFrames, SceneFrames } from './frames.ts';
export { sceneFrames, toFrame } from './frames.ts';
export { campaignJsonSchema } from './json-schema.ts';
export type { ResearchParts, ResearchPartsResult } from './research.ts';
export { researchPartsSchema, validateResearchParts } from './research.ts';
export type {
  Issue,
  IssueCode,
  SceneLimits,
  SceneRegistry,
  ValidateOptions,
  ValidationResult,
} from './validate.ts';
export { DEFAULT_TEXT_LIMITS, ISSUE_CODES, MIN_CONTRAST, validateCampaign } from './validate.ts';
