# `cell-type`

**Kind** setpiece. **Effort** L. **Asset tier** none. **Refs** ref D, ref G.

## Purpose

A Cell World set piece. A dot lattice fills the frame, a short line of type grows out of it as
dot-matrix glyphs, then the dots around the type merge into a solid panel and the type flips to
solid glyphs (the cell threshold: the glyph shape persists, the render state changes) [M ref D
lattice-to-window].

108 frames, Long row 17, as the alternative to `iso-chain` [D]. One set piece per film [N].

## Registry entry

| Field     | Value                                     | Tag |
| --------- | ----------------------------------------- | --- |
| `kind`    | `setpiece`                                | [D] |
| `ground`  | Neutral Cut `base`, Kinetic Plate `plate` | [N] |
| `text`    | `{ headline: 16 }`                        | [N] |
| `anchors` | `panel`: the panel box                    | [N] |
| `props`   | `accent?`                                 | [D] |

## Text and assets

| Input           | Required | Limit                                                                                                |
| --------------- | -------- | ---------------------------------------------------------------------------------------------------- |
| `headline` text | yes      | 1 to 3 words, 16 characters, one line. Glyphs must be at least 7 cells tall, so it renders at `capD` |
| Assets          | none     |                                                                                                      |

## Layout

Grid pitch `p = 27` px (H / 40 at 16:9, S / 40 elsewhere). Dot centres at
`((c + 0.5) * p, (r + 0.5) * p)` [N].

|       | 16:9                                                                                            | 9:16                            | 1:1                   | Tag |
| ----- | ----------------------------------------------------------------------------------------------- | ------------------------------- | --------------------- | --- |
| Grid  | 71 x 40 cells                                                                                   | 40 x 71 cells                   | 40 x 40 cells         | [N] |
| Text  | `capD`, font size `Math.min(capDerivedSize, fitText({withinWidth: 0.8 * W}).fontSize)`, centred | width 0.86 W, centred at 0.45 H | width 0.80 W, centred | [N] |
| Panel | the text's ink box padded by 2 cells on every side, snapped to whole cells                      | same                            | same                  | [N] |
| Dots  | on cells in `ink`, off cells in `muted` at 30%                                                  |                                 |                       | [N] |

**Sampling [D].** Render the headline once to an offscreen canvas at the grid's size and read the
alpha at each dot centre: a cell is on when alpha is 0.5 or more. Memoise the on/off grid in a
module `Map` keyed by text, font and size, so it is a pure cache and not state carried across
frames.

## Motion

Dot radius `rad` is in units of `p`. Radius 0.71 covers a cell corner to corner, so dots merge.

| Phase              | Frames        | Motion                                                                                                                                                                                                                            | Tag                                                                 |
| ------------------ | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Lattice            | `f = 0`       | Every dot at `rad = 0.12`. The frame is not blank                                                                                                                                                                                 | [N]                                                                 |
| Type grows         | `f` 0 to 29   | On cells in column `c` start at `t0 = Math.round(24 * c / cols)` and grow to `rad = 0.46` with `0.12 + 0.34 * arriveN(f - t0, 0.3, 6)`                                                                                            | [M] `arrive.slam`; [N] radii and sweep                              |
| Hold as dots       | `f` 30 to 59  | Whole grid `scale(1 + 0.0013 * (f - 30))` about frame centre                                                                                                                                                                      | [M] drift rate; [N] applied here                                    |
| Lattice into panel | `f` 60 to 89  | Every dot inside the panel grows to `rad = 0.75` on `step`, `Easing.bezier(0.85, 0, 0.15, 1)`, 30 frames. Off-cell colour moves from `muted` 30% to `ink` on the same curve. Dots outside the panel shrink to 0 on the same curve | [M] `step` 30 frames; [M] ref D dots merge to a solid; [N] the rest |
| Threshold          | `f = 90`      | The panel is a solid `ink` rectangle with `brand.radius` corners. The headline renders as solid glyphs knocked out in the ground colour, at the same position and size                                                            | [M] M10 cell threshold; [N] knock-out                               |
| Hold               | `f` 90 to 107 | Panel and glyphs `scale(1 + 0.0013 * (f - 90))`                                                                                                                                                                                   | [M]                                                                 |

The scene does not step on twos. Stepped motion is a film-level flag, and a film never mixes
stepped and unstepped motion [D].

## Transitions

| In  | Out                                                        |
| --- | ---------------------------------------------------------- |
| T3  | T5 chapter into the pivot `type-card` (pinned in Long), T3 |

## Acceptance stills

| Frame       | Must show                                                                           |
| ----------- | ----------------------------------------------------------------------------------- |
| `f = 0`     | The full lattice, every dot equal                                                   |
| `f = 30`    | The headline readable as dot-matrix, also when downscaled to 360 px wide            |
| `f = 75`    | Panel dots part-merged, outside dots shrinking                                      |
| `f = 89`    | The panel solid: no ground showing between dots inside it                           |
| `f = 90`    | Solid knocked-out glyphs, the same shape and position as the dot glyphs on `f = 89` |
| every frame | MAD at least 0.02 against the previous frame                                        |
