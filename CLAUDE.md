# Boiler Room

## Project rules

- Animation must be a pure function of frame. No timers, no `Math.random()`, no state that depends
  on wall-clock time.
- Never invent product claims. Every number, percentage, multiplier or money amount on screen or
  in voiceover must appear in the verbatim `quote` of a claim that text item cites.
- Render only a campaign that `validateCampaign` passed. The `schema` prop on `<Composition>` is
  not a gate: it drives Studio, and `remotion render` does not check it. Call `validateCampaign` in
  `calculateMetadata` and throw on `!ok`, which stops both `remotion render` and `remotion still`.
- Content lives in `campaign.json`, motion lives in templates. Visible copy goes in `scene.text`,
  never in `scene.props`, and templates render numbers only from `scene.text`.
- Take every frame number from `sceneFrames`, or `toFrame` for a single time such as a sound
  effect. Never write `seconds * fps` in a template or the render step: it is rarely a whole
  number, Remotion refuses a fractional `durationInFrames`, and scenes drift off their boundaries.
- Transitions take no timeline time. `scene.start` and `scene.end` stay true, so a transition is
  overlaid on the boundary. Remotion's `TransitionSeries` shortens the video by each transition's
  length, so do not map scenes onto it directly.

## Versions

- `zod` stays exact and identical to the version `@remotion/studio` pins, so the workspace
  resolves one copy.
- All `remotion` and `@remotion/*` packages stay on one exact version.
- `typescript` 7 has no classic compiler API, so tools that import it, such as `typescript-eslint`,
  do not work here. Biome is the lint and format tool.
