export { assetUrl } from './brand/assets.ts';
export { BrandProvider, useBrand } from './brand/brand-context.tsx';
export { mix, withAlpha } from './brand/color.ts';
export type { LogoProbe, LogoRejection, ResolvedLogo } from './brand/logo.ts';
export { rejectLogo, resolveLogo } from './brand/logo.ts';
export { oklchLightness, skinOf } from './brand/skin.ts';
export type { BrandTheme } from './brand/theme.ts';
export { resolveTheme, themeFonts } from './brand/theme.ts';
export { MorphBox } from './components/morph-box.tsx';
export { RisingWords } from './components/rising-words.tsx';
export { useScene, useSceneClock } from './components/scene-runtime.tsx';
export type { Point, Pose } from './core/camera.ts';
export { imageToViewport, lerpPose, poseAt, WHOLE_IMAGE } from './core/camera.ts';
export type { MorphState, Seam } from './core/curves.ts';
export {
  arrive,
  arriveN,
  blink,
  depart,
  ease,
  filmFrames,
  framesBefore,
  inOutAt,
  liftAt,
  morphBox,
  outTravel,
  rack,
  SPEC_FPS,
  seamBetween,
  seamIn,
  seamOut,
  secondLinePush,
  specFrame,
  springPop,
  typeDrift,
  wordGapGain,
  wordRise,
} from './core/curves.ts';
export type { Phase, Presence, PresenceWindow, SceneExit, SceneTiming } from './core/presence.ts';
export { presence, sceneTiming, springAt } from './core/presence.ts';
export { staggerDelays } from './core/stagger.ts';
export { bezier, framesFor } from './core/time.ts';
export type { CampaignFilmProps, CopyFitProps } from './film/campaign-film.tsx';
export {
  CampaignFilm,
  CopyFit,
  calculateCampaignFilm,
  calculateCopyFit,
  campaignFilmSchema,
  copyFitSchema,
} from './film/campaign-film.tsx';
export { copyFitIssues, layoutRefusals } from './film/copy-fit.ts';
export type { CutSelection } from './film/cut.ts';
export { resolveCut } from './film/cut.ts';
export type { ImageSize } from './film/media.ts';
export type { FilmPlan, ScenePlan } from './film/plan.ts';
export { planFilm } from './film/plan.ts';
export type { FilmRequest, MediaProbe } from './film/prepare.ts';
export { checkImageFit, FilmRejected, prepareCopy, prepareFilm } from './film/prepare.ts';
export { filmSeams, seamScene } from './film/seams.ts';
export { groundAt, groundClock, Stage as FilmStage } from './film/stage.tsx';
export type { FilmIssue, FilmIssueCode } from './film/validate-film.ts';
export { FILM_ISSUE_CODES, validateFilm } from './film/validate-film.ts';
export type { RenderValidation } from './film/validate-render.ts';
export { validateForRender } from './film/validate-render.ts';
export type { Rect } from './layout/rect.ts';
export type { Format, Stage } from './layout/stage.ts';
export { FORMAT_SIZES, stageFor } from './layout/stage.ts';
export type {
  Anchor,
  AnchorDeclaration,
  AnchorRequest,
  Ground,
  SceneDefinition,
  SceneKind,
  Skin,
  Velocity,
} from './scenes/definition.ts';
export { anchorsOf, anchorVelocities, defineScene, groundOf } from './scenes/definition.ts';
export {
  IMPLEMENTED_SCENE_TYPES,
  renderSceneRegistry,
  sceneImplementations,
} from './scenes/registry.ts';
export * as tokens from './tokens.ts';
export type { TransitionId, TransitionName } from './transitions/catalog.ts';
export {
  isCatalogId,
  isTransition,
  qcFrames,
  TRANSITION_IDS,
  TRANSITION_NAMES,
  TRANSITIONS,
} from './transitions/catalog.ts';
export type { ResolvedSeam, SeamScene } from './transitions/resolve.ts';
export { resolveSeam, resolveSeams, velocitiesMatch } from './transitions/resolve.ts';
export {
  boxTransform,
  SeamLayer,
  seamTransform,
  useSeamTransform,
} from './transitions/seam-layer.tsx';
export type { SceneSpan, Timeline, TransitionWindow } from './transitions/timeline.ts';
export { buildTimeline } from './transitions/timeline.ts';
