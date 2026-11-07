# `logo-reveal`

**Kind** mark. **Effort** S. **Asset tier** logo. **Refs** ref C, ref D, ref G, ref B.

## Purpose

The mark resolves from a mask, blur, tiles or an iris bloom, holds while drifting, and leaves on
an accelerating curve. It carries rule 2's deadline: the mark is legible by 3.5 s.

| Template       | Starts at | Frames | Tag |
| -------------- | --------- | ------ | --- |
| Short          | 90        | 60     | [D] |
| Standard, Long | 90        | 90     | [D] |

**Mark deadline.** `from + markLegibleAt <= 105` [D]. The templates start the reveal at frame 90,
so every mode must resolve in 15 frames or fewer.

## Registry entry

| Field           | Value                                                            | Tag                                |
| --------------- | ---------------------------------------------------------------- | ---------------------------------- |
| `kind`          | `mark`                                                           | [D]                                |
| `ground`        | Neutral Cut `base`, Kinetic Plate `plate`                        | [N]                                |
| `text`          | `{ subhead: 32 }`                                                | [N]                                |
| `anchors`       | `logo`: exit velocity `{axis: 'y', sign: -1, v: 36}`             | [N], inside the [M] range 30 to 46 |
| `markLegibleAt` | by mode: `mask` 13, `blur` 8, `tiles` 7, `iris` 10               | [N], from the tokens below         |
| `props`         | `mode?: 'mask' \| 'blur' \| 'tiles' \| 'iris'`, default `'mask'` | [N]                                |

## Text and assets

| Input               | Required | Limit                                                                                                                     |
| ------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------- |
| `brand.logoAssetId` | yes      | SVG preferred. A raster logo never renders above natural size. `tiles` and `iris` work on any logo; `mask` and `blur` too |
| `subhead` text      | no       | A tagline taken from the site, 6 words, 32 characters. Cite a claim for any number                                        |

## Layout

|          | 16:9                                               | 9:16                             | 1:1                           | Tag |
| -------- | -------------------------------------------------- | -------------------------------- | ----------------------------- | --- |
| Logo box | fits within 0.36 W x 0.22 H, centred at (W/2, H/2) | 0.70 W x 0.14 H at (W/2, 0.45 H) | 0.60 W x 0.24 H at (W/2, H/2) | [N] |
| Tagline  | `capS`, centred, baseline 0.70 H                   | baseline 0.58 H                  | baseline 0.72 H               | [N] |

## Motion

| Mode    | Frames                      | Motion                                                                                                                                                                               | Tag                                                     |
| ------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| `mask`  | `f` 0 to 12                 | T11 soft mask: `p = -8 + 116 * arriveN(f + 1, 0.72, 14)`, edge softness 8%. The `+ 1` puts part of the logo on screen at `f = 0`. Legible at 13                                      | [E] softness; [M] `arrive.fast`; [N] mapping and offset |
| `blur`  | `f` 0 to 7                  | `filter: blur(12 * (1 - arriveN(f, 0.5, 8)) px)`. Opacity 1 from `f = 0`. Legible at 8                                                                                               | [M] `arrive.snap`; [N] 12 px                            |
| `tiles` | `f` 0 to 7                  | Logo box cut into square cells, 1/12 of the box width. Cells shown in order of distance from the box centre, coverage 2.4, 5.5, 11, 19, 35, 54, 78, 100% on `f` 0 to 7. Legible at 7 | [M] T7 series; [E] last two; [N] cell size              |
| `iris`  | `f` 0 to 9                  | T13 bloom: the close of the outgoing scene played backwards. Legible at 10                                                                                                           | [M]                                                     |
| Tagline | from `markLegibleAt + 6`    | `wordRise(f - start, j, 1, 26, 0.5)`                                                                                                                                                 | [M] short rise; [N] start                               |
| Drift   | from `markLegibleAt`        | `scale(1 + 0.0013 * (f - markLegibleAt))` about frame centre                                                                                                                         | [M] ref A type drift; [N] applied to a logo             |
| T1 exit | `f` `dur - 11` to `dur - 1` | `seamOut` on y, `-1`: logo and tagline leave upward on an accelerating curve                                                                                                         | [M] ref A wordmark exit, `depart.long`                  |

Reversible: because the scene is a pure function of frame, a closing bookend can render it with
`frame = d - f` [M ref C, ref D time-reversal bookend].

## Transitions

| In                                      | Out                         |
| --------------------------------------- | --------------------------- |
| T3 from `word-slam`, T13 bloom (pinned) | T1 (y) into `site-hero`, T3 |

## Acceptance stills

`ML = markLegibleAt`.

| Frame         | Must show                                                                                            |
| ------------- | ---------------------------------------------------------------------------------------------------- |
| `f = 0`       | Something visible: part of the mask, a blurred logo, the first tiles, or the bloom's dot             |
| `f = ML`      | Logo at full scale, unmasked, unblurred, every tile present. Absolute frame `90 + ML` is 105 or less |
| `f = ML + 12` | Logo larger than at `ML` (drift). Tagline, if any, fully risen                                       |
| `f = dur - 1` | On T1, the logo above its rest position and moving up                                                |
| any           | Raster logo at or below natural size                                                                 |
