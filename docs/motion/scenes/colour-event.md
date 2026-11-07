# `colour-event`

**Kind** type. **Effort** S. **Asset tier** brand. **Refs** ref C, ref A, ref F-TL.

## Purpose

The payoff. One full-bleed moment in the brand's colour with a frosted or simple card. On Neutral
Cut it is the film's single saturated event [M].

| Template | Starts at | Frames | Share of runtime at start |
| -------- | --------- | ------ | ------------------------- |
| Short    | 525       | 39     | 70%                       |
| Standard | 1098      | 42     | 81%                       |
| Long     | 1698      | 42     | 87%                       |

Neutral Cut: one full-bleed shot of at most 2.3 s (69 frames), past 60% of runtime [M] [D].

## Registry entry

| Field     | Value                                                    | Tag                                  |
| --------- | -------------------------------------------------------- | ------------------------------------ |
| `kind`    | `type`                                                   | [D]                                  |
| `ground`  | `event` in both skins: full-bleed `brand.colors.primary` | [D] `event` token; [N] Kinetic Plate |
| `limits`  | `headline: 20`                                           | [N]                                  |
| `anchors` | `card`: the card box                                     | [N]                                  |
| `props`   | `card?: 'simple' \| 'frosted'`, default `'simple'`       | [N]                                  |

Exempt from `card.min`: it reads at display size [D].

## Text and assets

| Input           | Required          | Limit                                                                                                                                 |
| --------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `headline` text | yes               | 1 to 3 words, 20 characters, one line. Cite a claim for any number or superlative                                                     |
| Field asset     | no, `assetIds[0]` | Only when the Art Director replaced a primary that reads as nothing: a generated field from the plate ramp, `provenance: 'generated'` |

## Layout

|                 | 16:9                                                                                                                                                       | 9:16            | 1:1             | Tag                              |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- | --------------- | -------------------------------- |
| Event ground    | full frame, `primary`, or the field asset                                                                                                                  | same            | same            | [D]                              |
| Headline        | `capD`, font size `Math.min(capDerivedSize, fitText({withinWidth: 0.6 * W}).fontSize)`, centred                                                            | width 0.80 W    | width 0.70 W    | [M] `capD`; [N] widths           |
| Headline colour | `readableOn(behind)`: black or white, whichever clears 4.5:1 on what sits behind the type                                                                  |                 |                 | [D] the validator's `readableOn` |
| Simple card     | no box. Type straight on the event ground                                                                                                                  |                 |                 | [N]                              |
| Frosted card    | 0.50 W x 0.36 H, centred, `brand.radius`. `backdrop-filter: blur(24px)` over the event ground, white at 18% on a dark primary, black at 18% on a light one | 0.86 W x 0.30 H | 0.76 W x 0.40 H | [N]                              |

The accent is the ground here, so no accent phrase is allowed on this scene's text [D light
budget].

## Motion

| Element   | Frames      | Motion                                                                     | Tag                           |
| --------- | ----------- | -------------------------------------------------------------------------- | ----------------------------- |
| Card      | `f` 0 to 7  | `y = 60 * (1 - arriveN(f, 0.5, 8))`                                        | [M] `arrive.snap`; [N] travel |
| Headline  | `f` 0 to 5  | Pops at full opacity, slam scale `1 + 0.26 * 0.3 ** f`                     | [M] `arrive.slam`             |
| Drift     | every frame | Headline and card `scale(1 + 0.0013 * f)`                                  | [M]                           |
| After T16 | `f` 0 to 14 | The dip covers the first 15 frames. Entry motion runs underneath unchanged | [D]                           |

## Transitions

Both boundaries change ground, so only the ground-change set applies, plus a pinned T9 cut.

| In                                                                                               | Out                                   |
| ------------------------------------------------------------------------------------------------ | ------------------------------------- |
| T6 from `proof-bars` (a bar in the accent fill), T7 or a pinned T9 cut from `tile-wall`, T16, T3 | T3 into the callback `type-card`, T16 |

Lock this scene's first frame to a cue on the track: it is one of the film's 3 to 6 hero moments
[D].

## Acceptance stills

| Frame                  | Must show                                                                                                                            |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `f = 0`                | The event colour over at least 95% of the frame outside the card, and the headline on screen                                         |
| `f = 8`                | Card and headline at rest. Text contrast at least 4.5:1 against what is behind it                                                    |
| `f = dur - 1`          | Content present, drifting                                                                                                            |
| Film-wide, Neutral Cut | This is the only full-bleed saturated stretch. Its start frame is at least 60% of the film's frames, and it lasts 69 frames or fewer |
