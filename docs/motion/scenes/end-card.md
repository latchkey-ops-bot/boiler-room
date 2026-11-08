# `end-card`

**Kind** mark. **Effort** S. **Asset tier** logo. **Refs** ref A, ref B, ref C, ref D, ref E, ref G.

## Purpose

The last scene: lockup, call to action and URL, then a quiet static hold while the music fades.

| Template       | Frames | Build | Hold | Tag                     |
| -------------- | ------ | ----- | ---- | ----------------------- |
| Short          | 95     | 26    | 69   | [D]                     |
| Standard, Long | 113    | 44    | 69   | [D] build is `dur - 69` |

`hold.end` is 69 frames, range 53 to 89 [M, median about 2.2 to 2.3 s across 7 films].

## Registry entry

| Field     | Value                                                 | Tag |
| --------- | ----------------------------------------------------- | --- |
| `kind`    | `mark`                                                | [D] |
| `ground`  | Neutral Cut `base`, Kinetic Plate `plate`             | [N] |
| `text`    | `{ cta: 24, label: 38 }`                              | [N] |
| `anchors` | `logo`: entry velocity `{axis: 'y', sign: -1, v: 36}` | [N] |
| `props`   | `urlReveal?: 'decode' \| 'type'`, default `'decode'`  | [N] |

It is always the last scene, so it has no `transitionOut`.

## Text and assets

| Text id role | Required | Limit                                                                    | Notes                                                                                                                  |
| ------------ | -------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `cta`        | yes      | 4 words, 24 characters                                                   | The first `variants.ctas` label. A CTA variant swaps this value at render time [N]. No numbers unless a claim is cited |
| `label`      | no       | The URL as shown, no scheme. Short: 20 characters. Standard and Long: 38 | Decoded letters only. Characters that are not `[a-zA-Z]` show their final glyph from the first frame [D]               |

| Asset               | Required | Limit                                                                       |
| ------------------- | -------- | --------------------------------------------------------------------------- |
| `brand.logoAssetId` | yes      | SVG preferred. A raster logo never renders above its natural pixel size [D] |

## Layout

|           | 16:9                                                                                              | 9:16                             | 1:1                              | Tag |
| --------- | ------------------------------------------------------------------------------------------------- | -------------------------------- | -------------------------------- | --- |
| Logo box  | fits within 0.36 W x 0.20 H, centred at (W/2, 0.40 H)                                             | 0.70 W x 0.12 H at (W/2, 0.40 H) | 0.60 W x 0.20 H at (W/2, 0.38 H) | [N] |
| CTA       | `capS` 78 px, display family, centred, baseline at 0.66 H                                         | baseline 0.58 H                  | baseline 0.64 H                  | [N] |
| URL label | 39 px cap (0.5 x `capS`), body family, `muted` if it clears 4.5:1, else `ink`, baseline at 0.76 H | 0.65 H                           | 0.75 H                           | [N] |

Under `capS` only: the end-card URL, the `site-hero`/`site-scroll` address pill, `feature-card`
node labels, `proof-bars` bar names, `iso-chain` labels and `status-relay` chip labels. None of
these carries the story, and each repeats words already shown at `capS`. Here the CTA carries it
[D Never list].

## Motion

| Element            | Frames                           | Motion                                                                                                                                            | Tag                           |
| ------------------ | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| Logo, native entry | `f` 0 to 22                      | `y = 200 * (1 - arriveN(f, 0.82, 23))`, opacity 1 from `f = 0`                                                                                    | [M] `arrive.slow`; [N] travel |
| Logo, T1 entry     | `f` 0 to 13                      | `seamIn` on y. No separate rise                                                                                                                   | [M]                           |
| CTA words          | from `f = 4`                     | `wordRise(f - 4, j, 1, 26, 0.5)`, pop                                                                                                             | [M] short rise; [N] start     |
| URL, decode        | from `f = 6`                     | Letters start shifted +3 code points within their case (x becomes a). The character at index `i` of line `L` resolves at `6 + 2L + (len - 1 - i)` | [M] ref G; [D] letters only   |
| URL, type          | from `f = 6`                     | `chars = Math.min(n, Math.floor((f - 6) * 18 / 40))`, caret 0.075 em x 0.78 em in the accent, always on                                           | [M] ref D                     |
| Hold               | `f` from `dur - 69` to `dur - 1` | Nothing moves. No drift                                                                                                                           | [M] static end hold           |

Everything must be at rest by `f = dur - 70`. That is why the URL limit is 20 characters on Short
(`6 + 19 = 25`) and 38 on Standard and Long. Typing is slower than decoding (18 characters in 40
frames), so the `type` reveal fits only Standard and Long URLs of 16 characters or fewer [N].

## Transitions

| In                                                       | Out  |
| -------------------------------------------------------- | ---- |
| T1 (y) from the name `type-card`, T3, T13 bloom (pinned) | none |

## Acceptance stills

`B = dur - 69`, the first hold frame.

| Frame                     | Must show                                                                      |
| ------------------------- | ------------------------------------------------------------------------------ |
| `f = 0`                   | Logo visible and displaced below its rest position, moving. Not a blank frame  |
| `f = 6`                   | CTA words appearing. URL letters shifted, punctuation and digits already final |
| `f = B - 1`               | Logo at rest. CTA complete. URL text exactly equal to the `label` value        |
| `f = B` and `f = dur - 1` | Identical frames: MAD below 0.02 on every frame between them                   |
| any                       | Raster logo at or below natural size. CTA cap height at least 78 px            |
