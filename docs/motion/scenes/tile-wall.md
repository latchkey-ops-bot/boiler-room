# `tile-wall`

**Kind** product. **Effort** M. **Asset tier** 1 to 3. **Refs** ref A, ref F-TL, ref G.

## Purpose

Scale, from captured pages. Three rows of real tiles slide in opposed directions, decay to a slow
cruise, then ramp into a cut at peak speed.

| Template        | Frames | Job                                |
| --------------- | ------ | ---------------------------------- |
| Standard row 14 | 66     | Scale, before the colour event     |
| Long row 5      | 72     | Problem at scale, before the pivot |

## Registry entry

| Field     | Value                                                                              | Tag |
| --------- | ---------------------------------------------------------------------------------- | --- |
| `kind`    | `product`                                                                          | [D] |
| `ground`  | Neutral Cut `base`, Kinetic Plate `plate`                                          | [N] |
| `limits`  | none: the scene takes no text                                                      | [N] |
| `anchors` | `wall`: the full frame. No velocity: the rows move in opposed directions, so no T1 | [N] |
| `props`   | `motionBlur?: boolean`, default `false`                                            | [N] |

## Text and assets

| Input       | Required                   | Limit                                                                                                                                                                          |
| ----------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Tile assets | yes, 6 to 18 in `assetIds` | `kind: 'image'`, `provenance: 'captured'` or `'uploaded'`, tier 1 to 3: product images, docs, pricing, changelog and site pages from the customer's own site. Cropped to 16:10 |
| Text        | none                       |                                                                                                                                                                                |

Never a third-party logo the customer's own site does not show, and never a logo wall of
companies that are not on it [D].

## Layout

|           | 16:9                                                                                                          | 9:16                                 | 1:1                          | Tag |
| --------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ---------------------------- | --- |
| Rows      | 3, centre y at 0.19 H, 0.50 H, 0.81 H                                                                         | 4, at 0.20 H, 0.40 H, 0.60 H, 0.80 H | 3, at 0.19 H, 0.50 H, 0.81 H | [N] |
| Tile      | height 302 px (0.28 H), width 484 px (16:10), gap 32 px                                                       | height 384 px, width 614 px          | height 302 px, width 484 px  | [N] |
| Corners   | `brand.radius`, else 16 px                                                                                    |                                      |                              | [D] |
| Shadow    | soft contact or none                                                                                          |                                      |                              | [M] |
| Row strip | the row's tiles repeated in `assetIds` order, offset by row, until the strip covers `W + D(dur) + tile width` |                                      |                              | [N] |

## Motion

Row `r` moves with sign `[-1, 1, -1, 1][r]` along x. `R = dur - 26` is the ramp start.

| Phase                | Frames               | Speed `v(f)`, px/f                                                                                                            | Tag                                                           |
| -------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Entry and long decay | `f` 0 to `R - 1`     | `11 + 49 * 0.88 ** f`: 60 at `f = 0`, about 11.6 at `f = 35`                                                                  | [M] `arrive.long` k 0.88; [N] 60 px/f start                   |
| Ramp into the cut    | `f` `R` to `dur - 1` | `v(R) * 1.11 ** (f - R)`: from about 11 px/f to about 153 on the last frame (`1.11 ** 25`), and 15 times the start at the cut | [M] `depart.drag`, ref F-TL wall ramp, 11 to 165 px/f at 1920 |

Distance is the closed-form sum, so every frame is pure:
`D(f) = 11 * f + 49 * (1 - 0.88 ** f) / 0.12` for `f <= R`, then
`D(R) + v(R) * (1.11 ** (f - R) - 1) / 0.11`. Row `r` is at `x = sign_r * D(f) + phase_r`, with
`phase_r = -r * 0.37 * tileWidth` [N].

`motionBlur: true` wraps this scene alone in `CameraMotionBlur` with 5 samples. It multiplies the
scene's render cost by the sample count, so it stays off by default [D gap 9].

## Transitions

| In  | Out                                                                                                                                                   |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| T3  | T9 (pinned in Standard): a hard cut at peak speed into `colour-event`. T5 chapter (pinned in Long) into the pivot `type-card`. T7 into `colour-event` |

## Acceptance stills

| Frame         | Must show                                                                 |
| ------------- | ------------------------------------------------------------------------- |
| `f = 0`       | All rows full of tiles and moving, adjacent rows in opposite directions   |
| `f = 35`      | Rows at about 11.6 px/f                                                   |
| `f = R`       | Rows at about 11 px/f                                                     |
| `f = dur - 1` | Rows at about 153 px/f                                                    |
| every frame   | MAD at least 0.02 against the previous frame. No empty strip end in frame |
| any           | Every tile is a real capture of the customer's own site                   |
