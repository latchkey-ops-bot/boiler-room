# `word-slam`

**Kind** type. **Effort** M. **Asset tier** none. **Refs** ref B, ref F-BL, ref F-BR, ref F-TR.

## Purpose

The hook. One display word slams in, holds, collapses to exactly its size in the hook sentence,
and the rest of the sentence appends around it. Hook word and hook sentence are one 90-frame
scene, so the collapse happens inside one scene and a hook variant (`variants.hooks`, which
replaces the first scene) swaps the whole hook as a unit [D].

Always scene 1, frames 0 to 89, in every template [D].

## Registry entry

| Field     | Value                                            | Tag |
| --------- | ------------------------------------------------ | --- |
| `kind`    | `type`                                           | [D] |
| `ground`  | Neutral Cut `base`, Kinetic Plate `plate`        | [N] |
| `text`    | `{ headline: 40 }`                               | [D] |
| `anchors` | `headline`: the sentence block. No exit velocity | [N] |
| `props`   | `accent?`                                        | [D] |

Exempt from `card.min`: slams read at display size [D].

## Text and assets

| Text id role | Required | Words                     | Characters | Notes                                                                                                         |
| ------------ | -------- | ------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------- |
| `headline`   | yes      | 2 to 8, target 6 or fewer | 40         | The hook sentence. Its first word is the slam word. Sentence case. Cite a claim for any number or superlative |

- **Slam word.** The first word, 12 characters at most [N]. At display size it must reach
  `0.13 W` font size or more. If the slam word renders under 0.13 W, `calculateMetadata` throws a
  layout error naming the hook's text id. The Director replaces the slam word with a shorter one
  (at most 8 characters is a safe default). The opening scene is always a `word-slam` [D 0.13 W;
  N the rest]. The reference spec also allows opening with a `type-card` instead. That is dropped,
  because every template opens on a `word-slam` and a hook variant replaces it as a unit.
- **Hook variants.** Every hook variant is also a `word-slam` with the same 0 to 3 s timing. All
  variants share the slam word when the callback card echoes it [N].
- No assets.

## Layout

|              | 16:9                                                                                                                       | 9:16                      | 1:1          | Tag                  |
| ------------ | -------------------------------------------------------------------------------------------------------------------------- | ------------------------- | ------------ | -------------------- |
| Display word | cap `capD` 211 px, font size `Math.min(capDerivedSize, fitText({withinWidth: 0.8 * W}).fontSize)`, centred on frame centre | same rule, 0.8 W = 864 px | same, 864 px | [M] ratio; [D] 0.8 W |
| Sentence     | `capS` 78 px, `fitTextOnNLines({maxLines: 2, maxBoxWidth: 0.65 * W})`, lines centred, block centred on frame centre        | box 929 px                | box 864 px   | [M] 16:9; [N] others |
| Colour       | `ink`. On Kinetic Plate the type stays neutral and the plate carries saturation                                            |                           |              | [M]                  |

The collapse target is the slam word's box when it is the only visible word: one word, sentence
size, centred on the frame. Later words then extend the line and it re-centres.

## Motion

| Phase                  | Frames                               | Motion                                                                                                                                           | Tag                                                                            |
| ---------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| Slam                   | `f` 0 to 9                           | Scale about the word centre, laid out at display size: `excess = f === 0 ? 4.4 : 1.5 * 0.7 ** (f - 1)`, `s = 1 + excess`. Opacity 1 from `f = 0` | [M] ref F-BL                                                                   |
| Kinetic Plate recede   | `f` 9, the frame before the collapse | `s *= 0.98 ** (f - 8)`, floored at `sentenceCap / displayCap`. Neutral Cut skips it                                                              | [M] ref F-BL                                                                   |
| Settle before collapse | `f` 3 to 9                           | The slam curve keeps decaying, sharp. At `f = 9` the word is 8.6% over rest (`s = 1.086`), and the collapse starts from there                    | [M] `hold.display` 2 to 10 frames; [E, viewed] ref B sharp on frames 2 to 9    |
| Collapse               | `f` 10 to 22                         | From `s(9)` to `sentenceSize / displaySize` (about 0.37) over 13 frames, `Easing.bezier(0.94, 0.12, 0.34, 0.82)`                                 | [F] `collapse`; [E, viewed] ref B blurred again on 10 to 13 while scaling down |
| Append                 | from `f = 23`                        | Word `j` (j = 1 for the second word) pops in at full opacity on `f = 23 + 3 * (j - 1)`                                                           | [M] 1-frame pops, stagger in the [M] range 2 to 8; [N] 3                       |
| Re-centre              | each append                          | Each line's x offset moves to its new centre with `arriveN(f - tAppend, 0.72, 14)`, summed over appends                                          | [M] ref B                                                                      |
| Second line            | when its first word appears          | Line 1 pushes up by `travel * arrive(f - line2Start + 1, 0.4)`                                                                                   | [D]                                                                            |
| Sentence hold          | to the end                           | Drift `scale(1 + 0.0013 * (f - 23))` about frame centre, both skins                                                                              | [M] Neutral Cut; [N] Kinetic Plate                                             |
| T13 exit (pinned)      | `f` 70 to 89                         | Sentence at rest by 69. Iris close 70 to 79, dot hold 80 to 89                                                                                   | [M]                                                                            |

The display portion runs 23 frames, inside ref B's measured 23 to 31 [M]. An 8-word sentence has
its last word on screen at `f = 41` and is at rest by `f = 55`.

**Motion blur.** Velocity-gated, on the slam and the collapse only: a uniform blur of
`0.08 * currentCapPx` while `|ln(s(f) / s(f - 1))| > 0.18`, and none otherwise. `f = 0` counts as
over the gate [E] radius 5 to 10% of cap height; [N] the gate. With the slam above it blurs on
frames 0 to 2, against ref B's 0 to 1 [E]. Build it as a per-layer `filter` or SVG blur, not
`CameraMotionBlur`.

**Bleed.** Glyphs may exceed the frame while moving. The display word fits within 0.8 W at
`s = 1`, so it sits wholly inside the safe area from `s <= 1.125`, reached at `f = 8`, and stays
inside to the end: more than the required 10 frames [D] [E].

## Transitions

| In                        | Out                                                                      |
| ------------------------- | ------------------------------------------------------------------------ |
| none: frame 0 of the film | T3 into `logo-reveal` (default), T13 (pinned, with the iris close above) |

## Acceptance stills

| Frame                       | Must show                                                                                               |
| --------------------------- | ------------------------------------------------------------------------------------------------------- |
| `f = 0`                     | Not blank: the slam word at scale 5.4, bleeding off frame, blurred. This is the film's frame 0 (rule 4) |
| `f = 8`                     | The display word wholly inside the safe area, near rest, sharp                                          |
| `f = 16`                    | Mid-collapse, blurred only if above the speed gate                                                      |
| `f = 22`                    | The slam word at sentence size: cap height at least 78 px, centred                                      |
| `f = 23 + 3 * (n - 2) + 14` | The full sentence, at rest, at most 2 lines, each line at most 0.65 W wide                              |
| `f = 89`                    | Sentence present and drifting, or the iris dot on T13                                                   |
| Audio, 0 to 3 s             | Short-term loudness at or below -24 LUFS on the final mix                                               |
