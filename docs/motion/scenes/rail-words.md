# `rail-words`

**Kind** product. **Effort** M. **Asset tier** 4. **Refs** ref G.

## Purpose

Breadth, fast. Oversized words ride two rails in opposite directions with one UI element passing
through the centre. Display words may bleed off the frame while moving [D].

63 frames, two in a row in Long (rows 15 and 16) [D].

## Registry entry

| Field     | Value                                                                | Tag |
| --------- | -------------------------------------------------------------------- | --- |
| `kind`    | `product`                                                            | [D] |
| `ground`  | Neutral Cut `base`, Kinetic Plate `plate`                            | [N] |
| `limits`  | `headline: 14`, `subhead: 14`                                        | [N] |
| `anchors` | `rails`: the top rail. Entry and exit `{axis: 'x', sign: -1, v: 46}` | [N] |
| `props`   | `accent?`                                                            | [D] |

## Text and assets

| Input           | Required          | Limit                                                                                                     |
| --------------- | ----------------- | --------------------------------------------------------------------------------------------------------- |
| `headline` text | yes               | Top rail: 1 or 2 words, 14 characters                                                                     |
| `subhead` text  | yes               | Bottom rail: 1 or 2 words, 14 characters                                                                  |
| Centre element  | no, `assetIds[0]` | A tier 1 to 3 crop (`captured` or `uploaded`). Without it, a tier 4 greeked panel: grey bars, no numerals |

Numbers need a cited claim, as everywhere. Both rails read together as one phrase for the
validator's combined check.

## Layout

|             | 16:9                                                                                                           | 9:16                          | 1:1                           | Tag                                |
| ----------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------- | ----------------------------- | ---------------------------------- |
| Top rail    | `capD` 211 px, font size `Math.min(capDerivedSize, fitText({withinWidth: 0.8 * W}).fontSize)`, centre y 0.22 H | width 0.86 W, centre y 0.26 H | width 0.80 W, centre y 0.20 H | [M] size; [D] 0.8 W; [N] positions |
| Bottom rail | same size, centre y 0.78 H                                                                                     | 0.74 H                        | 0.80 H                        | [N]                                |
| Centre band | element height 0.28 H, centred at (W/2, H/2), `brand.radius`, `light.rim` on it                                | height 0.24 H                 | height 0.24 H                 | [N]; [E] rim values                |

## Motion

Rail speed `v(f) = 6 + 40 * 0.72 ** f` px/f: 46 on the first frame, decaying to a 6 px/f cruise
[M] `arrive.fast` k 0.72 and the 46 px/f lateral seam; [N] cruise. Distance
`D(f) = 6 * f + 40 * (1 - 0.72 ** f) / 0.28`.

| Element          | Frames                                 | Motion                                                                                       | Tag                                        |
| ---------------- | -------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------ |
| Top rail word    | every frame                            | Centre x `W/2 - (D(f) - D(22))`, moving left. Its centre crosses frame centre at `f = 22`    | [N]                                        |
| Bottom rail word | every frame                            | Centre x `W/2 + (D(f) - D(22))`, moving right                                                | [N]                                        |
| Centre element   | `f` 0 to 13, then on                   | Enters from `+0.3 W` with `arriveN(f, 0.72, 14)`, then drifts left at 1.3 x cruise, 7.8 px/f | [M] `arrive.fast`; [E] parallax 1.2 to 1.5 |
| Glyph scale      | never                                  | None on rails                                                                                | [M]                                        |
| Blur             | while a rail moves faster than 30 px/f | Horizontal blur of `0.08 * capD`. Type only, entry and whip exit only                        | [E] radius; [N] gate                       |
| T1 exit          | `f` 52 to 62                           | `seamOut` on both rails, top `-1`, bottom `+1`, on top of the cruise                         | [M]                                        |

**Bleed check.** A word up to 0.8 W wide crosses the centre at `f = 22`. It sits wholly inside
the 16:9 safe area while its centre is within 96 px of frame centre, which at these speeds is
`f` 14 to 34: more than the required 10 frames [D] [E].

## Transitions

| In                                                        | Out                                   |
| --------------------------------------------------------- | ------------------------------------- |
| T1 (x) from the previous `rail-words` or `proof-bars`, T3 | T1 (x) into the next `rail-words`, T3 |

## Acceptance stills

| Frame        | Must show                                                            |
| ------------ | -------------------------------------------------------------------- |
| `f = 0`      | Both words on screen and moving in opposite directions, at 46 px/f   |
| `f = 22`     | Each rail word wholly inside the safe area, centred, at display size |
| `f` 14 to 34 | Both words wholly inside the safe area on every frame                |
| `f = 40`     | The centre element at rest in the band, one rim lit, no other light  |
| any          | Glyph scale 1 on every frame. Greeked panels show no numerals        |
