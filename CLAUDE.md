# Boiler Room

## Project rules

- Animation must be a pure function of frame. No timers, no `Math.random()`, no state that depends
  on wall-clock time.
- Never invent product claims. Every number, percentage, multiplier or money amount on screen or
  in voiceover must appear in the verbatim `quote` of a claim that text item cites.
- Content lives in `campaign.json`, motion lives in templates. Visible copy goes in `scene.text`,
  never in `scene.props`, and templates render numbers only from `scene.text`.

## Versions

- `zod` stays exact and identical to the version `@remotion/studio` pins. A second copy breaks
  Remotion schemas.
- All `remotion` and `@remotion/*` packages stay on one exact version.
- `typescript` 7 has no classic compiler API, so tools that import it, such as `typescript-eslint`,
  do not work here. Biome is the lint and format tool.
