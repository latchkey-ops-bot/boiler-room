# `feature-card`

**Kind** product. **Effort** M. **Asset tier** 1 to 4. **Refs** ref E, ref A.

## Purpose

Breadth on a fixed clock. A fixed headline slot plus one causal micro-demo, in which one thing
visibly produces the next [D rule 6]. Cards run in groups of 2 to 5, each 72 frames, joined by a
2-frame blink.

72 frames in every template row written for it [M ref E, card spacing 71, 72, 72 and 77]. As a
substitute it takes the row's frames: 96 for a proof row, 66 for Standard's `tile-wall` row and 72
for Long's [N]. Every exit below is written against `dur`, so the build is the same at any length.

## Registry entry

| Field     | Value                                                                                            | Tag                     |
| --------- | ------------------------------------------------------------------------------------------------ | ----------------------- |
| `kind`    | `product`                                                                                        | [D]                     |
| `ground`  | Neutral Cut `base`, Kinetic Plate `plate`                                                        | [N]                     |
| `text`    | `{ headline: 40, label: 16 }`                                                                    | [D] headline; [N] label |
| `anchors` | `headline`: the fixed slot box. Entry and exit `{axis: 'x', sign: 1, v: 46}`                     | [N]                     |
| `props`   | `demo?: 'chips' \| 'crop'` (default: `'crop'` when an asset is given, else `'chips'`), `accent?` | [N]                     |

A run of `feature-card` scenes sharing the slot is one card group: up to 5 count as one unit for
the rhythm rule, and T5 between them is exempt from the 3-use limit [D].

## Text and assets

| Input           | Required    | Limit                                                                                                               |
| --------------- | ----------- | ------------------------------------------------------------------------------------------------------------------- |
| `headline` text | yes         | 2 to 6 words, 40 characters, 1 or 2 lines at `capS` (see Layout). Cite a claim for any number                       |
| `label` text    | no, up to 2 | 2 words and 16 characters each: the cause and the effect node labels                                                |
| Asset           | no, up to 2 | Tier 1 to 3 crops: `kind: 'image'`, `provenance: 'captured'` or `'uploaded'`. First is the cause, second the effect |

With no asset, the demo is tier 4: greeked grey bars and pills, no numerals [D rule 2]. Tier 4
cards must be visible to the customer at script approval [D rule 6, section 6].

## Layout

|               | 16:9                                                                                 | 9:16                             | 1:1                              | Tag                          |
| ------------- | ------------------------------------------------------------------------------------ | -------------------------------- | -------------------------------- | ---------------------------- |
| Headline slot | `capS`, centred, cap top at 0.16 H. One exact coordinate for every card in the group | cap top at 0.14 H                | cap top at 0.14 H                | [M] fixed slot; [N] position |
| Headline box  | Up to 2 lines of `min(lineBox, safe width) / (1 + 0.0013 * dur)`                     | same                             | same                             | [N]; [D] 2 lines             |
| Demo panel    | 0.56 W x 0.50 H, centred at (W/2, 0.62 H), `brand.radius`                            | 0.86 W x 0.46 H at (W/2, 0.56 H) | 0.80 W x 0.52 H at (W/2, 0.62 H) | [N]                          |
| Panel top     | Moved down, if needed, to 36 px under the slot's two lines at `dur`                  | same                             | same                             | [N]                          |
| Cause node    | left third of the panel: the first crop, or a greeked pill                           | top half of the panel            | left third                       | [N]                          |
| Effect node   | right third: the second crop, or an accent-filled pill                               | bottom half                      | right third                      | [N]                          |
| Connector     | 2 px line in `muted` from cause to effect                                            |                                  |                                  | [N]                          |
| Node labels   | 0.6 x `capS` (47 px cap), body family, under each node                               |                                  |                                  | [N]                          |

The headline is set at `capS` and never smaller: fit or fail [N]. Copy that does not fit two lines
of the headline box stops the render with `LAYOUT_UNFIT`, naming the scene and the text id, and
the Director shortens it. The box is the line box divided by the drift the headline gains by
`dur`, so no line is wider than `lineBox`, or outside the safe area, on any frame. The first real
film set 30-character headlines on one line at a 60 px cap, and their drift carried them to 69% of
the width. The panel keeps its size and moves down only as far as the slot needs: two line boxes
at `capS`, line 1's cap top on the slot, drifted to `dur`, and 36 px under them, inside the safe
area. The slot is reserved for two lines on every card, so the panel sits in one place across a
group, whatever each card's headline.

## Motion

| Element                                 | Frames                                                   | Motion                                                                                                                                                                                                                     | Tag                                 |
| --------------------------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| T5 entry (inside a group)               | `f` 0 to 6                                               | Ground only on 0 and 1. Headline at full ink from 2, blur 6, 3, 1.2, 0 px, y 13, 7, 4, 1, 0 px                                                                                                                             | [M] y and blanks; [E] blur          |
| T1 entry (first card)                   | `f` 0 to 13                                              | Headline and panel enter together with `seamIn` on x. The headline is never carried from the outgoing scene's anchor, and is drawn above the panel                                                                         | [M]; [N] no carry, layer order      |
| T3 entry                                | `f` 0 to 5                                               | The rack above with no blank frames: headline at full ink, blurred, from `f = 0`                                                                                                                                           | [N]                                 |
| Panel                                   | `f` 6 to 13                                              | `y = 40 * (1 - arriveN(f - 6, 0.5, 8))`, opacity 1 from 6                                                                                                                                                                  | [M] `arrive.snap`; [N] travel       |
| Cause lights                            | `f` 14 to 25                                             | `light.sweep` across the cause node, 12 frames                                                                                                                                                                             | [E] 10 to 20 frames                 |
| Connector draws                         | `f` 20 to 26                                             | Stroke length `arriveN(f - 20, 0.5, 8)`                                                                                                                                                                                    | [N]                                 |
| Effect appears                          | `f = 26`                                                 | Neutral Cut: `spring.pop` on the effect node (non-type only): `spring({frame: f - 26 + 2, fps: 30, config: {mass: 1, damping: 26, stiffness: 550}, from: 0.46, to: 1})`. Kinetic Plate: scale `1 + 0.26 * 0.3 ** (f - 26)` | [F] `spring.pop`; [M] `arrive.slam` |
| Labels                                  | cause from `f = 14`, effect from `f = 30`                | `wordRise(f - start, j, 1, 26, 0.5)`                                                                                                                                                                                       | [M] short rise; [N] start           |
| Drift                                   | every frame                                              | Headline `scale(1 + 0.0013 * f)`. Demo nodes carry a slow `translateX(0.3 * f px)`                                                                                                                                         | [M]; [N] node drift                 |
| Hold                                    | `f = 40` to `dur - 12` (to `dur - 1` on a T5 or T3 exit) | The build is done by `f = 40`. Hold the final state with the drift above                                                                                                                                                   | [N]                                 |
| Exit into the next card, or the chapter |                                                          | Content leaves in one frame at the seam (the next card, or the pivot, draws the blink)                                                                                                                                     | [M]                                 |
| T1 exit (last card)                     | `f` `dur - 11` to `dur - 1`                              | `seamOut` on x on headline and panel together                                                                                                                                                                              | [M]                                 |

`spring.pop` never touches type. Overshoot is allowed on the effect node only, because it is not
type [D].

## Transitions

| In                                                  | Out                                                                                                                                           |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| T5 from another `feature-card` (exempt), T1 (x), T3 | T5 into another `feature-card`, T5 chapter into a pivot `type-card` (pinned), T1 (x), T3, T6 when the effect node is a CSS fill in the accent |

## Acceptance stills

| Frame                       | Must show                                                                                          |
| --------------------------- | -------------------------------------------------------------------------------------------------- |
| `f = 0`, `f = 1` (after T5) | Uniform ground only                                                                                |
| `f = 0` (after T1)          | Headline at its slot and the panel, both displaced along x and moving. Nothing covers the headline |
| `f = 2`                     | Headline at full ink, soft                                                                         |
| `f = 6`                     | Headline sharp and at rest, at the same pixel position as every other card in the group            |
| `f = 20`                    | The cause node lit, nothing else lit                                                               |
| `f = 32`                    | Effect node and its label present. The demo reads as cause, then effect                            |
| `f = dur - 1`               | Content present: drifting, or on T1 displaced along x and moving                                   |
| any                         | Tier 4 panels show no numerals. Every numeral on screen comes from `scene.text`                    |
