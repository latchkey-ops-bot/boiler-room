# `type-card`

**Kind** type. **Effort** S. **Asset tier** none. **Refs** ref A, ref D, ref E, ref F-TL.

## Purpose

One or two lines of sentence-size type: value lines, problem lines, the callback to the hook, the
brand name and the pivot. Words pop and rise, a second line pushes the first up, the block drifts,
and it leaves on an exit ramp or a dead stop.

| Variant | `props.variant` | Job                                                        | Frames in templates |
| ------- | --------------- | ---------------------------------------------------------- | ------------------- |
| Default | absent          | Value line, problem, callback                              | 48, 51, 54          |
| Name    | `'name'`        | The brand name, before the end card                        | 43                  |
| Pivot   | `'pivot'`       | The film's one breath. Entered only by a pinned chapter T5 | 54                  |

Duration range 43 to 79 frames [M ref A, 1.43 to 2.63 s].

## Registry entry

| Field     | Value                                                                                                                                        | Tag                             |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| `kind`    | `type`                                                                                                                                       | [D]                             |
| `ground`  | Neutral Cut `base`, Kinetic Plate `plate`                                                                                                    | [N]                             |
| `limits`  | `headline: 40`, `subhead: 40`                                                                                                                | [D] headline; [N] subhead       |
| `anchors` | `headline`: the text block box. Entry and exit velocity `{axis: 'x', sign: 1, v: 46}`. The name variant exits `{axis: 'y', sign: -1, v: 36}` | [M] 46 px/f ref A; [N] the rest |
| `props`   | `variant?: 'name' \| 'pivot'`, `accent?`                                                                                                     | [N]                             |

## Text and assets

| Text id role | Required | Words                     | Characters | Lines                 | Claims                                     |
| ------------ | -------- | ------------------------- | ---------- | --------------------- | ------------------------------------------ |
| `headline`   | yes      | see below                 | 40         | 1 or 2                | Cite a claim for any number or superlative |
| `subhead`    | no       | counted with the headline | 40         | 1, under the headline | as above                                   |

- **Words.** Headline plus subhead, whitespace-counted, at most 8 [M], target 2 to 6, and never
  more than `card.min` allows: `dur >= max(43, ceil(6.5 * words))` [D]. That gives at most 6 words
  at 43 frames, 7 at 48 and 51, 8 at 54 and up.
- **Name variant.** `headline` is `brand.name`. Optional `subhead` descriptor, 4 words at most
  [N].
- **Pivot variant.** At most 4 words, one line [D rule 11].
- **Lines.** At most 2 in total. With a subhead the headline takes one line.
- No assets.

## Layout

|                                        | 16:9                                                                                              | 9:16                      | 1:1                       | Tag                                            |
| -------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------- | ------------------------- | ---------------------------------------------- |
| Text box                               | max width 1248 px (0.65 W), 2 lines                                                               | max width 929 px, 2 lines | max width 864 px, 2 lines | [M] 16:9; [N] others                           |
| Block centre (the fixed headline slot) | (W/2, H/2)                                                                                        | (W/2, 0.45 H)             | (W/2, H/2)                | [N]                                            |
| Alignment                              | centred                                                                                           | centred                   | centred                   | [N]                                            |
| Cap height                             | `capS` 78 px. Name variant 117 px (1.5 x `capS`)                                                  | same                      | same                      | [M] `capS`; [N] name size                      |
| Headline colour                        | `ink`                                                                                             |                           |                           | [D]                                            |
| Subhead                                | Same size as the headline, in `brand.colors.muted` when it clears 4.5:1 on the ground, else `ink` |                           |                           | [N]; hierarchy by colour, not weight [M ref E] |

Line 1 is first laid out alone on the slot. Line 2's rest position is its place in the final
2-line block centred on the slot.

## Motion

All frames are scene-local `f`.

| Element                         | Frames                                                             | Motion                                                                                                                                                     | Tag                                         |
| ------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| Headline word `i`, native entry | from `f = i`                                                       | `wordRise(f, i, 1, 72, 0.75)`: visible from `f = i` at opacity 1, `y = 72 * 0.75 ** (f - i)`                                                               | [M] ref A long rise, 1-frame stagger        |
| Line 2                          | from `line2Start = n1 + 4`, where `n1` is the word count of line 1 | Line 2 words rise as above, indexed from `line2Start`. Line 1 moves up by `travel * arrive(f - line2Start + 1, 0.4)`, `travel = lineHeight * fontSize / 2` | [D] push; [N] `line2Start`                  |
| Subhead word `j`                | from `f = nH + 3 + j`, `nH` the headline word count                | `wordRise(f - nH - 3, j, 1, 26, 0.5)`                                                                                                                      | [M] ref A short rise 24 to 28 px; [N] start |
| Block drift                     | every frame                                                        | `scale(1 + 0.0013 * f)` about frame centre, unclamped `f`, both skins                                                                                      | [M] Neutral Cut; [N] Kinetic Plate          |
| Name variant, native entry      | `f` 0 to 35                                                        | Whole name as one unit, `y = 72 * (1 - arriveN(f, 0.88, 35))`                                                                                              | [M] ref A name card k 0.88                  |
| T1 entry                        | `f` 0 to 13                                                        | All words visible at `f = 0`. Each word's x offset is `seamIn(f, seam) * gain(i)` (word-gap variant in T1). No rise                                        | [M] ref A; [N] gain                         |
| T5 entry                        | `f` 0 to `b + 4`                                                   | Ground only for `f < b`. Then all words at full ink, blur 6, 3, 1.2, 0 px and y 13, 7, 4, 1, 0 px from `f = b`                                             | [M] y; [E] blur                             |
| T1 exit                         | `f` `dur - 11` to `dur - 1`                                        | `seamOut` on the block: x, `+1`, `vPeak` from the resolver, `n` 11, `r` 1.4. Name variant: y, `-1`                                                         | [M]                                         |
| Other exits                     |                                                                    | Drift continues to the last frame                                                                                                                          | [D]                                         |

Pivot variant: only the chapter T5 entry (`b = 5`). The block is sharp at `f = 8`.

## Transitions

| In                                            | Out                                                          |
| --------------------------------------------- | ------------------------------------------------------------ |
| T1 (x), T3, T5 (group or pinned chapter), T16 | T1 (x; name variant y), T3, T5 into another `type-card`, T16 |

Templates: default in from T3 or T1; callback in from T3 (after `colour-event`); name in from T1,
out by T1 (y) into `end-card`; pivot in by pinned chapter T5.

## Acceptance stills

`L` = the frame the last word becomes visible. `rest = L + 13`.

| Frame                            | Must show                                                                                                                                                            |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `f = b` (0 unless entered by T5) | Content present, not a blank frame. After T3, the first word visible and offset 72 px. After T1, every word visible and displaced along x                            |
| `f = rest`                       | Every word in final order with no overlap. Block centred on the slot within 2 px. Cap height at least 78 px. Each line at most 1248 px wide at 16:9. At most 2 lines |
| `f = rest + 10`                  | Scale larger than at `rest` (drift present). MAD against the previous frame at least 0.02                                                                            |
| `f = dur - 1`                    | On T1, the block displaced along the exit axis and moving. Otherwise content present                                                                                 |
| Pivot: `f` 0 to 4                | Uniform ground only                                                                                                                                                  |
| Pivot: `f = 8`                   | Headline sharp, 4 words or fewer                                                                                                                                     |
| Whole scene                      | `dur >= max(43, ceil(6.5 * words))`                                                                                                                                  |
