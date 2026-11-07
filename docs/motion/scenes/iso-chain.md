# `iso-chain`

**Kind** setpiece. **Effort** L. **Asset tier** none. **Refs** ref G.

## Purpose

A Cell World set piece and a projection morph. A row of flat squares tilts into rhombi, extrudes
into three-tone cubes, and the hero cube opens into a hexagon. Projection does the morph, so
there are no shape keys [F ref G].

108 frames, Long row 17, as the alternative to `cell-type` [D]. One set piece per film [N].

## Registry entry

| Field     | Value                                                                                                                                   | Tag |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------- | --- |
| `kind`    | `setpiece`                                                                                                                              | [D] |
| `ground`  | Neutral Cut `base`, Kinetic Plate `plate`                                                                                               | [N] |
| `text`    | `{ headline: 32, label: 16 }`                                                                                                           | [N] |
| `anchors` | `chain`: the chain's box                                                                                                                | [N] |
| `props`   | `count?: 3 \| 4 \| 5` (default 3), `hero?: number` (default the middle object), `hues?: number[]`, one categorical hue index per object | [N] |

## Text and assets

| Input           | Required                   | Limit                                                                                                                                                        |
| --------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `label` text    | no, one per object up to 3 | 2 words, 16 characters. Each binds one concept to one hue for the whole film                                                                                 |
| `headline` text | no                         | 5 words, 32 characters, at `capS` above the chain                                                                                                            |
| Hero texture    | no, `assetIds[0]`          | `kind: 'image'`. One hero object per film may carry an image on its faces: `provenance: 'generated'` (tier 5) or `'captured'`. Never on any other object [D] |

**Categorical mode [D].** Up to 3 extra hues besides the primary, each bound to one named concept
for the whole film, derived in OKLCH from `brand.primary` at matched lightness, and introduced the
first time with a label and a swatch square. A hue is never reused for a different concept.

## Layout

|            | 16:9                                                                                                                                             | 9:16                                                     | 1:1                                                       | Tag                              |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------- | --------------------------------------------------------- | -------------------------------- |
| Objects    | `count` squares, side 230 px (0.12 W), gap 77 px (0.04 W), in one row, centred at (W/2, 0.56 H) before projection                                | at most 3, side 216 px (0.2 W), centred at (W/2, 0.50 H) | at most 4, side 151 px (0.14 W), centred at (W/2, 0.56 H) | [N]                              |
| Projection | CSS 3D on the chain container, no `perspective` (orthographic)                                                                                   |                                                          |                                                           | [D]                              |
| Tones      | top face: the object's hue. Left face: `color-mix(in oklch, hue, black 12%)`. Right face: black 24%. Three solid tones, no lighting, no gradient |                                                          |                                                           | [D] three tones; [N] mix amounts |
| Labels     | body family, 47 px cap, each under its object with a 24 px swatch square in its hue                                                              |                                                          |                                                           | [N]; [M] ref G label and swatch  |
| Headline   | `capS`, centred, baseline at 0.18 H                                                                                                              | 0.16 H                                                   | 0.16 H                                                    | [N]                              |

## Motion

| Phase          | Frames                                      | Motion                                                                                                                                                                                                           | Tag                                          |
| -------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| Face-on to iso | `f` 0 to 25                                 | Container `rotateX(a) rotateZ(b)`: `a` 0 to 63.6 deg, `b` 0 to 45 deg, `camera.skew`, `Easing.bezier(0.66, 0.25, 0.04, 0.98)`, 26 frames. The curve starts with nonzero slope, so the chain is moving at `f = 0` | [F] curve and angles, ref G rail axis 24 deg |
| Extrude        | object `i` from `f = 26 + 4 * i`, 30 frames | Side faces grow from 0 to the side length on `step`, `Easing.bezier(0.85, 0, 0.15, 1)`                                                                                                                           | [M] `step`; [M] cube stagger 4               |
| Labels         | object `i` from `f = 56 + 4 * i`            | `wordRise(f - start, j, 1, 26, 0.5)`, swatch pops with it                                                                                                                                                        | [M] short rise; [N] start                    |
| Headline       | from `f = 6`                                | `wordRise(f - 6, j, 1, 72, 0.75)`                                                                                                                                                                                | [M]                                          |
| Open into hex  | `f` 72 to 97                                | Container `a` from 63.6 to 54.7 deg (true isometric: a cube's silhouette becomes a regular hexagon) on `camera.skew`, 26 frames                                                                                  | [F] [D] angles                               |
| Point aperture | `f` 76 to 95                                | Hero top face: the texture (or the accent, without one) grows from a dot at the face centre, `clip-path: circle()` radius `faceDiagonal / 2 * arriveN(f - 76, 0.72, 14)`                                         | [D] M11; [M] `arrive.fast`; [N] timing       |
| Hold           | `f` 98 to 107                               | Container `rotateZ(45 + 0.05 * (f - 98) deg)`                                                                                                                                                                    | [N]                                          |

With `count` 5, the last cube finishes extruding at `f = 72`, as the hex phase starts.

## Transitions

| In  | Out                                                        |
| --- | ---------------------------------------------------------- |
| T3  | T5 chapter into the pivot `type-card` (pinned in Long), T3 |

## Acceptance stills

| Frame       | Must show                                                                                                     |
| ----------- | ------------------------------------------------------------------------------------------------------------- |
| `f = 0`     | Flat squares, face-on, already turning                                                                        |
| `f = 25`    | Rhombi at the iso angle: `rotateX(63.6deg) rotateZ(45deg)`                                                    |
| `f = 72`    | Every object a cube in exactly three solid tones. No gradient, no shading, no lighting                        |
| `f = 97`    | The hero cube's silhouette a regular hexagon, its top face open to the texture or accent                      |
| any         | Only the hero carries a texture. Each label has its swatch, and each hue keeps one concept for the whole film |
| every frame | MAD at least 0.02 against the previous frame                                                                  |
