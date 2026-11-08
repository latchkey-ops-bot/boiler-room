# `proof-bars`

**Kind** proof. **Effort** M. **Asset tier** cited values. **Refs** ref E.

## Purpose

Claim, then proof. A hero claim holds centre stage, lifts to a slot as its evidence arrives,
data-true bars fill, and a verdict stamps. Repeated with one template for the film's claims.

96 frames in every template. Standard and Long run three in a row as one card group [D].

## Registry entry

| Field     | Value                                                                                                                                                         | Tag                      |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| `kind`    | `proof`                                                                                                                                                       | [D]                      |
| `ground`  | Neutral Cut `base`, Kinetic Plate `plate`                                                                                                                     | [N]                      |
| `text`    | `{ headline: 40, label: 24, subhead: 24 }`                                                                                                                    | [D] headline; [N] others |
| `anchors` | `headline`: the hero box, then the slot box. Entry and exit `{axis: 'x', sign: 1, v: 46}`. `bar-0`, `bar-1`, `bar-2`: each bar's fill box, `colour: 'accent'` | [N]                      |
| `props`   | `accent?`                                                                                                                                                     | [D]                      |

## Text and assets

| Text id role | Required    | Limit                                                                         | Claims                                            |
| ------------ | ----------- | ----------------------------------------------------------------------------- | ------------------------------------------------- |
| `headline`   | yes         | The hero claim, 2 to 6 words, 40 characters                                   | Must cite the claim whose quote states its number |
| `label`      | yes, 1 to 3 | One per bar, 24 characters: a name and one number, such as `With review: 35%` | Each cites the claim that states its number       |
| `subhead`    | no          | The verdict, 4 words, 24 characters                                           | Cite a claim for any number or superlative        |

**Data-true bars [N].** Each bar's value is the one numeric token in its `label`, read with
`extractNumericTokens` from `@boiler-room/schema`, the validator's own reader, so the template
renders numbers only from `scene.text`. The number is the label's single token (`token.raw`). The
name is the label with `token.raw` removed, trimmed of whitespace and a trailing `:`. A label with
zero tokens, or more than one, fails the layout check.

- All bars in a card share one kind and unit. A mix fails the layout check.
- Percent bars run on a 100% track: `length = value / 100 * track`. A single bar is allowed only
  for a percent.
- Any other kind needs 2 or 3 bars, scaled to the largest: `length = value / max * track`.
- The track is drawn, but never labelled with a number no claim states.
- No bar is ever drawn for a value that no cited quote states.

No assets.

## Layout

|               | 16:9                                                                                            | 9:16                           | 1:1                            | Tag                            |
| ------------- | ----------------------------------------------------------------------------------------------- | ------------------------------ | ------------------------------ | ------------------------------ |
| Hero headline | cap 101 px (`capS / 0.77`), centred at (W/2, H/2)                                               | centred at (W/2, 0.42 H)       | centred at (W/2, H/2)          | [M] scale 0.77; [N] position   |
| Slot          | centre y = H/2 - 402 = 138 px, scale 0.77, so cap 78 px                                         | centre y = 0.16 H, lift 499 px | centre y = 0.13 H, lift 400 px | [M] 402 px at 1080; [N] others |
| Bar track     | x from 0.19 W to 0.81 W (1190 px), height 54 px, radius `min(brand.radius, 27)`, `muted` at 25% | 0.86 W                         | 0.80 W                         | [N]                            |
| Bar rows      | centre y 0.36 H, 0.50 H, 0.64 H                                                                 | 0.32 H, 0.42 H, 0.52 H         | 0.38 H, 0.52 H, 0.66 H         | [N]                            |
| Bar fill      | accent                                                                                          |                                |                                | [D]                            |
| Bar label     | the name at 47 px cap above the bar's left end; the number at `capS` at the fill's right end    |                                |                                | [N]                            |
| Verdict       | `capS`, centred, baseline 0.86 H                                                                | 0.66 H                         | 0.86 H                         | [N]                            |

## Motion

| Element        | Frames                                    | Motion                                                                                                     | Tag                                         |
| -------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| Hero, T3 entry | `f` 0 to about 16                         | `wordRise(f, i, 1, 72, 0.75)`, pop                                                                         | [M]                                         |
| Hero, T5 entry | `f` 0 to 6                                | Blink and rack: ground on 0 and 1, full ink from 2                                                         | [M]                                         |
| Hero, T1 entry | `f` 0 to 13                               | `seamIn` on x                                                                                              | [M]                                         |
| Hero hold      | to `f = 22`                               | Drift `scale(1 + 0.0013 * f)`                                                                              | [M] `hold.hero` 23 frames; drift [M] ref A  |
| Lift           | `f` 23 to 33                              | `interpolate(f, [23, 34], [hero, slot])` on y and scale, `Easing.bezier(0.68, -0.06, 0.34, 1.06)`, clamped | [F] `lift`; [M] 402 px, 0.77, 11 frames     |
| Bar `j` start  | `f = 30 + [0, 4, 6][j]`                   | The first row enters at frame 7 of the lift                                                                | [M] 7 of 11; [M] offsets 0, 4, 6.25 rounded |
| Bar fill       | 24 frames from its start                  | `length * Easing.out(Easing.poly(4))((f - start) / 24)`, clamped                                           | [M] poly-4 over 24 to 25 frames             |
| Bar number     | with its bar                              | Pops at full value when its fill completes. No count-up inside bars                                        | [N]                                         |
| Verdict        | `v0 = 30 + offset[last] + 24`, at most 60 | Pops, scale `1 + 0.26 * 0.3 ** (f - v0)`                                                                   | [M] `arrive.slam`                           |
| Verdict hold   | `v0` to `v0 + 24`                         | Drift only                                                                                                 | [M] `hold.verdict` 25                       |
| T1 exit        | `f` 85 to 95                              | `seamOut` on x on the whole card                                                                           | [M]                                         |
| T6 exit        | starts at `96 - 4 - gCover`               | The last bar's fill becomes the world (T6). The verdict hold ends where the move starts                    | [D]; [N] hold cut                           |

After a T5 entry the hero is visible for 21 frames before the lift, not 23 [N]: every later frame
stays fixed so the group keeps one clock.

## Transitions

| In                                                | Out                                                                                                            |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| T5 from another `proof-bars` (exempt), T1 (x), T3 | T5 into another `proof-bars`, T5 chapter into a pivot `type-card` (pinned), T1 (x), T3, T6 into `colour-event` |

## Acceptance stills

| Frame                   | Must show                                                                                                   |
| ----------------------- | ----------------------------------------------------------------------------------------------------------- |
| `f = 0` (or 2 after T5) | The hero claim on screen                                                                                    |
| `f = 22`                | Hero at rest, centred, drifting                                                                             |
| `f = 30`                | Lift under way, first bar starting                                                                          |
| `f = 34`                | Headline at the slot: cap height 78 px, the same y on every card of the group                               |
| `f = v0`                | Every bar full. Each fill length equals its value's share of the track, within 1 px                         |
| `f = v0 + 24`           | Verdict at rest                                                                                             |
| any                     | Every number on screen equals a number in this scene's `text`, and each of those is stated in a cited quote |
