export type { Asset, Campaign, Claim, Scene, TextItem, TextRole } from './campaign.ts';
export {
  ASSET_KINDS,
  ASSET_PROVENANCES,
  CLAIM_STATUSES,
  campaignSchema,
  FORMATS,
  TEXT_ROLES,
} from './campaign.ts';
export { contrastRatio, readableOn } from './contrast.ts';
export type { CampaignFrames, SceneFrames } from './frames.ts';
export { sceneFrames, toFrame } from './frames.ts';
export { campaignJsonSchema } from './json-schema.ts';
export type { NameOptions } from './names.ts';
export { namesIn, namesNotQuoted } from './names.ts';
export type { NumericKind, NumericToken } from './numbers.ts';
export { extractNumericTokens, isBacked } from './numbers.ts';
export type { ResearchParts, ResearchPartsResult } from './research.ts';
export { researchPartsSchema, validateResearchParts } from './research.ts';
export { sceneRegistry } from './scene-registry.ts';
export type { Oklch, StyleFamily } from './style.ts';
export {
  DARK_BASE,
  fromOklch,
  GROUND_TINT,
  KINETIC_PLATE_MAX_L,
  LIGHT_BASE,
  mixOklch,
  NEUTRAL_CUT_MIN_L,
  oklchLightness,
  STYLE_FAMILIES,
  styleFamily,
  tintedGround,
  toOklch,
} from './style.ts';
export type {
  Issue,
  IssueCode,
  SceneLimits,
  SceneRegistry,
  ValidateOptions,
  ValidationResult,
} from './validate.ts';
export {
  DEFAULT_TEXT_LIMITS,
  ISSUE_CODES,
  MIN_CONTRAST,
  SUPERLATIVE_WORDS,
  superlativeForms,
  unbackedNumbers,
  validateCampaign,
} from './validate.ts';
