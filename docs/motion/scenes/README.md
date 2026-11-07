# Scene library

One file per scene type in the reference spec's priority list (section 9), in build order. Each
file says what an engineer needs to build the scene on the frame-pure core and what Quality Check
looks at. Measurements and their sources are in [../reference-spec.md](../reference-spec.md).
Transitions are in [../transitions.md](../transitions.md).

| #   | Scene                             | Kind     | Effort | Asset tier   | Used in templates    |
| --- | --------------------------------- | -------- | ------ | ------------ | -------------------- |
| 1   | [`type-card`](type-card.md)       | type     | S      | none         | all                  |
| 2   | [`end-card`](end-card.md)         | mark     | S      | logo         | all                  |
| 3   | [`logo-reveal`](logo-reveal.md)   | mark     | S      | logo         | all                  |
| 4   | [`word-slam`](word-slam.md)       | type     | M      | none         | all                  |
| 5   | [`site-hero`](site-hero.md)       | product  | M      | 1 to 3       | all                  |
| 6   | [`feature-card`](feature-card.md) | product  | M      | 1 to 4       | all                  |
| 7   | [`proof-bars`](proof-bars.md)     | proof    | M      | cited values | all                  |
| 8   | [`stat-counter`](stat-counter.md) | proof    | S      | cited value  | all                  |
| 9   | [`site-scroll`](site-scroll.md)   | product  | M      | 2 to 3       | Standard, Long       |
| 10  | [`tile-wall`](tile-wall.md)       | product  | M      | 1 to 3       | Standard, Long       |
| 11  | [`status-relay`](status-relay.md) | product  | L      | 4            | Long                 |
| 12  | [`rail-words`](rail-words.md)     | product  | M      | 4            | Long                 |
| 13  | [`colour-event`](colour-event.md) | type     | S      | brand        | all                  |
| 14  | [`cell-type`](cell-type.md)       | setpiece | L      | none         | Long, or `iso-chain` |
| 15  | [`iso-chain`](iso-chain.md)       | setpiece | L      | none         | Long, or `cell-type` |

Before any scene, the library needs `curves.ts`, `Stage`, the seam wrapper, `wordRise`, `MorphBox`
and the anchor contract [D]. The formulas for all of them are in
[../transitions.md](../transitions.md#shared-primitives).

## Evidence tags

Every parameter carries a tag.

| Tag | Meaning                                                                                                                                                                |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [M] | Measured from the reference films                                                                                                                                      |
| [F] | Fitted to a measured series                                                                                                                                            |
| [E] | Estimated by eye or inferred                                                                                                                                           |
| [D] | A decision already in the reference spec                                                                                                                               |
| [U] | Unverified in the reference spec                                                                                                                                       |
| [N] | New in these scene files. A build default chosen so the scene can be built without questions. Not measured, not in the reference spec, and free to change after review |

9:16 and 1:1 have no evidence at all: every reference is 16:9. Every 9:16 and 1:1 layout below is
[N] and unvalidated, and stays so until a vertical film passes review.

## Frame and layout units

| Symbol                                 | 16:9                                            | 9:16                                            | 1:1             | Tag                                                                                         |
| -------------------------------------- | ----------------------------------------------- | ----------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------- |
| `W x H`                                | 1920 x 1080                                     | 1080 x 1920                                     | 1080 x 1080     | schema formats                                                                              |
| `S = min(W, H)`                        | 1080                                            | 1080                                            | 1080            | [N]                                                                                         |
| `u = S / 1080`                         | 1                                               | 1                                               | 1               | [N]. Every px value in these files is at `u = 1`. Multiply by `u` for a 4K export (`u = 2`) |
| `capS`, sentence cap height            | 78 px (7.2% of H)                               | 78 px                                           | 78 px           | [M] at 16:9; [N] other formats use 7.2% of `S`                                              |
| `capD`, display cap height             | 211 px                                          | 211 px                                          | 211 px          | [M] 2.7 x `capS`                                                                            |
| `lineBox`, widest static sentence line | 0.65 W = 1248 px                                | 0.86 W = 929 px                                 | 0.80 W = 864 px | [M] at 16:9; [N] others                                                                     |
| Safe area inset                        | 96 px left and right, 54 px top and bottom (5%) | 54 px left and right, 192 px top, 288 px bottom | 54 px all round | [N]                                                                                         |
| Line height                            | 1.1                                             | 1.1                                             | 1.1             | [N], inside the [M] range 0.96 to 1.2                                                       |
| Tracking                               | -0.01 em                                        | -0.01 em                                        | -0.01 em        | [N] for "tight tracking" [E]                                                                |

Font size comes from cap height, never the other way round:
`fontSize = capPx * unitsPerEm / sCapHeight`, read from the loaded font's OS/2 table, or from the
canvas-measured ink of "H" once per font [D]. Load fonts with `@remotion/fonts` `loadFont` under
`delayRender`, and call `measureText` and `fitTextOnNLines` with `validateFontIsLoaded: true`.
Memoise measurements in a module `Map` keyed by text, family, weight and size [D].

**Fit or fail [N].** A scene lays out its copy with `fitTextOnNLines` at its stated cap height and
box. If the copy does not fit, `calculateMetadata` throws a layout error naming the scene and text
id. A scene never shrinks type below `capS` to make copy fit. The Director shortens the copy.

## Frame variables

| Name          | Meaning                                                                                 |
| ------------- | --------------------------------------------------------------------------------------- |
| `f`           | Scene-local frame, `useCurrentFrame() - PRE`. 0 is the scene's first frame              |
| `dur`         | `sceneFrames(campaign).scenes[i].durationInFrames`                                      |
| `abs`         | Absolute frame, `from + f`. Shared clocks and the plate read it                         |
| `inT`, `outT` | The resolved transition ids into and out of this scene, passed by the `Stage`           |
| `seam`        | The `Seam` object for a T1 boundary, passed by the `Stage`                              |
| `b`           | Blank frames at the start of the scene: 2 after a T5, 5 after a chapter T5, otherwise 0 |

Every frame number comes from `sceneFrames` or `toFrame`. Never `seconds * fps`.

## What every scene does

- **Entry by transition.** A scene implements each entry it lists: its native entry (used after
  T3 and T4), the T5 blink and rack, and the T1 `seamIn` on its declared anchor. T16 and T6 are
  drawn by the `Stage` and the outgoing scene, so the incoming scene uses its native entry under
  them.
- **Exit by transition.** On T1 the scene applies `seamOut` to its exit anchor for `f` in
  `[dur - n, dur - 1]`. On T3, T5 and T16 it keeps drifting to its last frame and does nothing
  else. Other exits are listed in the scene file.
- **Never static mid-film.** No run of more than 30 frames with MAD below 0.02 [D]. Type drifts
  `scale(1 + 0.0013 * f)` about frame centre on Neutral Cut [M ref A]. Product layers are never
  held [M ref A].
- **Copy and numbers.** Every visible word comes from `scene.text` by text id. Numbers render only
  from `scene.text`. Props hold parameters, never copy.
- **Accent.** `scene.props.accent = {textId, from, to}` marks one phrase of one text item, word
  indices with an exclusive end, in the accent colour [D]. At most one per text item.
- **Reveal.** Type enters by `pop` (full opacity on its first frame) or `develop` (a left-to-right
  opacity ramp per word, leading edge 2 to 4 words wide [E]). Never a uniform whole-line crossfade.
- **No overshoot on type.** No spring, bounce or overshoot on any type layer [M].

## Registry entry

Each scene file gives the values for its entry in `sceneRegistry`. The fields are [D] from the
reference spec except where marked.

| Field           | Meaning                                                                                                                                |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `kind`          | `type`, `proof`, `product`, `mark` or `setpiece`, for the rhythm rule                                                                  |
| `ground`        | Per skin: `'base' \| 'plate' \| 'event' \| 'black'`. The `Stage` derives the ground timeline from it                                   |
| `limits`        | `SceneLimits.text`, the character limit per role that `validateCampaign` enforces                                                      |
| `anchors`       | The `Anchor` objects the scene exposes: id, `box(f)` from props, text and font measurements only, and optional entry and exit velocity |
| `markLegibleAt` | `logo-reveal` only: the local frame where the logo is at full scale, unmasked and unblurred                                            |
| `props`         | The keys the scene reads from `scene.props`, with their types [N]                                                                      |

## Acceptance stills

Each scene file lists the local frames Quality Check renders and what each must show. Absolute
frame = `sceneFrames(...).scenes[i].from + f`. Stills are taken from the rendered film itself, not
from Studio or a mock. Every scene is also covered by the film-wide checks in
[`skills/quality-check/SKILL.md`](../../../skills/quality-check/SKILL.md).
