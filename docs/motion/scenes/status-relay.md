# `status-relay`

**Kind** product. **Effort** L. **Asset tier** 4. **Refs** ref C, ref D.

## Purpose

How it works, without fake UI. One persistent actor and one status line. The line rewrites itself
word by word around the fixed actor, and abstract chips run along a rail into the actor. The
narrator is the continuity [M ref C text relay].

60 frames, three in a row in Long (rows 9 to 11) [D]. As the Standard substitute for a proof row it
takes that row's 96 frames, and holds its final state from `f = 60` [N].

## Registry entry

| Field     | Value                                                                                                                             | Tag |
| --------- | --------------------------------------------------------------------------------------------------------------------------------- | --- |
| `kind`    | `product`                                                                                                                         | [D] |
| `ground`  | Neutral Cut `base`, Kinetic Plate `plate`                                                                                         | [N] |
| `text`    | `{ headline: 40, label: 12 }`                                                                                                     | [N] |
| `anchors` | `actor`: the actor box, identical on every card. `status`: the line's slot. Entry `{axis: 'x', sign: 1, v: 46}` on the first card | [N] |
| `props`   | `accent?`                                                                                                                         | [D] |

## Text and assets

| Input           | Required      | Limit                                                                                                                  |
| --------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `headline` text | yes           | The status line, 2 to 6 words, 40 characters, one line. Rendered at `capS`, never as small text carrying the story [D] |
| `label` text    | no, up to 3   | One per chip, 2 words, 12 characters. Without labels the chips are greeked                                             |
| Actor           | none required | A CSS-drawn rounded square in the accent. An SVG from `assetIds[0]` (captured, or generated and labelled) replaces it  |

Tier 4 rules apply: chips and panels are abstract, greeked by default, with no numerals unless a
label cites a claim [D rule 2]. The scene must be visible to the customer at script approval [D].

## Layout

|             | 16:9                                                                                            | 9:16                                                | 1:1                                  | Tag                       |
| ----------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------ | ------------------------- |
| Actor       | 151 px square (0.14 H), centred at (0.30 W, 0.50 H)                                             | centred at (0.50 W, 0.38 H)                         | centred at (0.50 W, 0.36 H)          | [N]                       |
| Status line | `capS`, left-aligned from 0.38 W, vertically centred on the actor, max 0.57 W                   | centred, baseline 0.52 H, box 929 px                | centred, baseline 0.60 H, box 864 px | [N]; [M] 0.65 W cap holds |
| Rail        | 2 px `muted` line from the left frame edge to the actor's left side, on the actor's centre line | vertical, from the top edge to the actor's top side | horizontal, as 16:9                  | [N]                       |
| Chips       | pill 120 x 40 px, `muted` at 40%, label in the body family at 22 px when given                  | same                                                | same                                 | [N]                       |

## Motion

| Element               | Frames                                          | Motion                                                                                                                                                  | Tag                                                          |
| --------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| First card, T1 entry  | `f` 0 to 13                                     | Actor and line enter on x with `seamIn`                                                                                                                 | [M]                                                          |
| Later cards, T5 entry | `f` 0 to 6                                      | Blink and rack: ground only on `f` 0 and 1, so the previous card's words leave in one frame at the seam. The actor returns at the same pixel position   | [M]                                                          |
| New line develops     | from `f = 6` (`f = 0` on the first card)        | `develop` reveal: word `j` opacity `clamp((f - start - 2 * j) / 6, 0, 1)`, so the leading edge is 3 words wide and a 6-word line completes in 16 frames | [M] relay 14 to 16 frames; [E] edge 2 to 4 words; [N] values |
| Shimmer               | after the line completes                        | Opacity bands on the live line, `0.85 + 0.15 * cos(2 * PI * ((x / 313) - (f / 19)))`, bands 313 px apart at 1920                                        | [E] ref C, 175 px on a 1073 px stage, period about 19 frames |
| Chips                 | chip `c` from `f = 16 + 4 * c`                  | Travel along the rail to the actor in 30 frames on `step`, `Easing.bezier(0.85, 0, 0.15, 1)`, arriving at `f = 46 + 4 * c`                              | [M] `step` 30 to 36 frames; [M] stagger 4; [N] start         |
| Absorb                | arrival to arrival + 5                          | Chip scale to 0 over 6 frames. Neutral Cut: actor `spring.pop` from `from: 0.92` (non-type only). Kinetic Plate: `light.rim` on the actor for 8 frames  | [F] `spring.pop` shape; [N] values                           |
| Actor drift           | every frame                                     | `rotate(0.04 * f deg)`                                                                                                                                  | [N]                                                          |
| Hold                  | `f` 60 to `dur - 1`, only when `dur` is over 60 | The final state: the shimmer and the actor's drift keep running                                                                                         | [N]                                                          |
| Exit                  | at the seam                                     | Content leaves in one frame for a T5 into the next card, or for the chapter T5 into a pivot `type-card`. Last card of a group: T3                       | [M]                                                          |

The shimmer, the chips and the actor's drift keep every frame above the static threshold. The
third chip arrives at `f = 54` and is absorbed by `f = 59`, the last frame of a 60-frame card, so
a card takes at most 3 chips [N].

## Transitions

| In                                                      | Out                                                                     |
| ------------------------------------------------------- | ----------------------------------------------------------------------- |
| T1 (x) on the first card, T5 between cards (exempt), T3 | T5 into the next card, T5 chapter into a pivot `type-card` (pinned), T3 |

T10 (vertical conveyor) is reserved for a later conveyor mode. T5 keeps the actor fixed while the
ground holds, so the blink reads as rhythm, not as a cut [N].

## Acceptance stills

| Frame                              | Must show                                                                                                                     |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `f = 0`                            | First card: the actor, moving in on x. Later cards: uniform ground only, on `f` 0 and 1                                       |
| `f = 6`                            | Later cards: the actor sharp and at rest at the same pixel position as the card before, and none of the previous card's words |
| `f = 12`                           | The new line part-developed, words at different opacities. No uniform whole-line fade                                         |
| `f = 22` (or 16 on the first card) | The full line, exactly the `headline` value, cap height at least 78 px                                                        |
| `f = 50`                           | Chips on the rail, the first one absorbing. Greeked chips show no numerals                                                    |
| `f = 59`                           | Every chip absorbed                                                                                                           |
| `f = dur - 1`                      | Content present: the line shimmering and the actor drifting                                                                   |
| every frame                        | MAD at least 0.02 against the previous frame, except the blank frames of a T5 entry                                           |
