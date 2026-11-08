---
name: director-beat-templates
description: The Director's three beat templates (Short 25 s, Standard 45 s, Long 65 s) row by row, with frames, campaign start and end seconds, default transitionOut and each row's job, and the only allowed scene substitutions with the seams after each swap. Read when filling a campaign.json or substituting a scene.
---

# Beat templates

The three templates from `docs/motion/reference-spec.md`, section 2. Frames at 30 fps. One row is
one scene in `campaign.scenes`, in this order. Each template sums exactly, and the `start` and
`end` columns are what you write: `from / 30` rounded to 6 decimals, and `toFrame` turns each one
back into the exact frame.

Three fixes are built in [D]:

1. The hook word and hook sentence are one 90-frame `word-slam`, so a hook variant swaps the
   whole hook. That is why Short has 11 scenes, not the 12 beats of earlier drafts.
2. In Standard and Long, the logo reveal starts at frame 90 and runs 90 frames, so the mark
   deadline (frame 105) leaves it 15 frames to resolve.
3. Every `type-card` meets `card.min`, so the name card is 43 frames and the end card gives up the
   difference.

## Short

25 s, 750 frames, 11 scenes, mean 2.27 s.

| #   | Scene `type`                   | Frames | From | To  | `start`   | `end`     | `transitionOut`   | Job                                          |
| --- | ------------------------------ | ------ | ---- | --- | --------- | --------- | ----------------- | -------------------------------------------- |
| 1   | `word-slam`                    | 90     | 0    | 89  | 0         | 3         | `t3`              | Hook word, collapsing into the hook sentence |
| 2   | `logo-reveal`                  | 60     | 90   | 149 | 3         | 5         | `t1`              | Mark legible by 3.5 s (frame 105)            |
| 3   | `site-hero`                    | 84     | 150  | 233 | 5         | 7.8       | `t3`              | First surface at 5.0 s                       |
| 4   | `type-card`                    | 51     | 234  | 284 | 7.8       | 9.5       | `t1`              | Value line. 7 words at most                  |
| 5   | `feature-card`                 | 72     | 285  | 356 | 9.5       | 11.9      | `t5`              | Feature 1                                    |
| 6   | `feature-card`                 | 72     | 357  | 428 | 11.9      | 14.3      | `t1`              | Feature 2                                    |
| 7   | `proof-bars` or `stat-counter` | 96     | 429  | 524 | 14.3      | 17.5      | `t3`              | One proof                                    |
| 8   | `colour-event`                 | 39     | 525  | 563 | 17.5      | 18.8      | `t3`              | Payoff                                       |
| 9   | `type-card`                    | 48     | 564  | 611 | 18.8      | 20.4      | `t1`              | Callback to the hook. 7 words at most        |
| 10  | `type-card`, `variant: "name"` | 43     | 612  | 654 | 20.4      | 21.833333 | `t1`              | Name. 6 words at most                        |
| 11  | `end-card`                     | 95     | 655  | 749 | 21.833333 | 25        | none (last scene) | CTA: 26 frames of build, 69 of hold          |

## Standard

45 s, 1350 frames, 18 scenes, mean 2.50 s. The default.

| #   | Scene `type`                    | Frames | From | To   | `start`   | `end`     | `transitionOut`   | Job                                                             |
| --- | ------------------------------- | ------ | ---- | ---- | --------- | --------- | ----------------- | --------------------------------------------------------------- |
| 1   | `word-slam`                     | 90     | 0    | 89   | 0         | 3         | `t3`              | Hook word, collapsing into the hook sentence                    |
| 2   | `logo-reveal`                   | 90     | 90   | 179  | 3         | 6         | `t1`              | Mark legible by 3.5 s (frame 105)                               |
| 3   | `site-hero`                     | 96     | 180  | 275  | 6         | 9.2       | `t3`              | First surface at 6.0 s                                          |
| 4   | `type-card`                     | 54     | 276  | 329  | 9.2       | 11        | `t3`              | Value line                                                      |
| 5   | `site-scroll`                   | 72     | 330  | 401  | 11        | 13.4      | `t1`              | Tour of the real site                                           |
| 6   | `proof-bars` or `stat-counter`  | 96     | 402  | 497  | 13.4      | 16.6      | `t5`              | Claim 1                                                         |
| 7   | `proof-bars` or `stat-counter`  | 96     | 498  | 593  | 16.6      | 19.8      | `t5`              | Claim 2, same template as claim 1                               |
| 8   | `proof-bars` or `stat-counter`  | 96     | 594  | 689  | 19.8      | 23        | `t5`              | Claim 3, same template                                          |
| 9   | `type-card`, `variant: "pivot"` | 54     | 690  | 743  | 23        | 24.8      | `t1`              | Breath. Pinned chapter blink of 5 blank frames, 4 words at most |
| 10  | `feature-card`                  | 72     | 744  | 815  | 24.8      | 27.2      | `t5`              | Breadth on a fixed clock                                        |
| 11  | `feature-card`                  | 72     | 816  | 887  | 27.2      | 29.6      | `t5`              | Breadth                                                         |
| 12  | `feature-card`                  | 72     | 888  | 959  | 29.6      | 32        | `t5`              | Breadth                                                         |
| 13  | `feature-card`                  | 72     | 960  | 1031 | 32        | 34.4      | `t3`              | Breadth                                                         |
| 14  | `tile-wall`                     | 66     | 1032 | 1097 | 34.4      | 36.6      | `t3`              | Scale, from captured pages                                      |
| 15  | `colour-event`                  | 42     | 1098 | 1139 | 36.6      | 38        | `t3`              | Payoff, past 80% of runtime                                     |
| 16  | `type-card`                     | 54     | 1140 | 1193 | 38        | 39.8      | `t1`              | Callback to the hook                                            |
| 17  | `type-card`, `variant: "name"`  | 43     | 1194 | 1236 | 39.8      | 41.233333 | `t1`              | Name. 6 words at most                                           |
| 18  | `end-card`                      | 113    | 1237 | 1349 | 41.233333 | 45        | none (last scene) | CTA: 44 frames of build, 69 of hold                             |

## Long

65 s, 1950 frames, 27 scenes, mean 2.41 s.

| #   | Scene `type`                    | Frames | From | To   | `start`   | `end`     | `transitionOut`   | Job                                 |
| --- | ------------------------------- | ------ | ---- | ---- | --------- | --------- | ----------------- | ----------------------------------- |
| 1   | `word-slam`                     | 90     | 0    | 89   | 0         | 3         | `t3`              | Hook                                |
| 2   | `logo-reveal`                   | 90     | 90   | 179  | 3         | 6         | `t1`              | Mark                                |
| 3   | `site-hero`                     | 96     | 180  | 275  | 6         | 9.2       | `t3`              | First surface at 6.0 s              |
| 4   | `type-card`                     | 54     | 276  | 329  | 9.2       | 11        | `t3`              | Problem                             |
| 5   | `tile-wall`                     | 72     | 330  | 401  | 11        | 13.4      | `t5`              | Problem at scale                    |
| 6   | `type-card`, `variant: "pivot"` | 54     | 402  | 455  | 13.4      | 15.2      | `t1`              | Turn. Pinned chapter blink          |
| 7   | `type-card`                     | 54     | 456  | 509  | 15.2      | 17        | `t3`              | Value line                          |
| 8   | `site-scroll`                   | 72     | 510  | 581  | 17        | 19.4      | `t1`              | Tour                                |
| 9   | `status-relay`                  | 60     | 582  | 641  | 19.4      | 21.4      | `t5`              | How it works, 1                     |
| 10  | `status-relay`                  | 60     | 642  | 701  | 21.4      | 23.4      | `t5`              | How it works, 2                     |
| 11  | `status-relay`                  | 60     | 702  | 761  | 23.4      | 25.4      | `t3`              | How it works, 3                     |
| 12  | `proof-bars` or `stat-counter`  | 96     | 762  | 857  | 25.4      | 28.6      | `t5`              | Claim 1                             |
| 13  | `proof-bars` or `stat-counter`  | 96     | 858  | 953  | 28.6      | 31.8      | `t5`              | Claim 2                             |
| 14  | `proof-bars` or `stat-counter`  | 96     | 954  | 1049 | 31.8      | 35        | `t3`              | Claim 3                             |
| 15  | `rail-words`                    | 63     | 1050 | 1112 | 35        | 37.1      | `t1`              | Breadth, fast                       |
| 16  | `rail-words`                    | 63     | 1113 | 1175 | 37.1      | 39.2      | `t3`              | Breadth, fast                       |
| 17  | `iso-chain` or `cell-type`      | 108    | 1176 | 1283 | 39.2      | 42.8      | `t5`              | Set piece                           |
| 18  | `type-card`, `variant: "pivot"` | 54     | 1284 | 1337 | 42.8      | 44.6      | `t1`              | Breath. Pinned chapter blink        |
| 19  | `feature-card`                  | 72     | 1338 | 1409 | 44.6      | 47        | `t5`              | Breadth on a fixed clock            |
| 20  | `feature-card`                  | 72     | 1410 | 1481 | 47        | 49.4      | `t5`              | Breadth                             |
| 21  | `feature-card`                  | 72     | 1482 | 1553 | 49.4      | 51.8      | `t5`              | Breadth                             |
| 22  | `feature-card`                  | 72     | 1554 | 1625 | 51.8      | 54.2      | `t5`              | Breadth                             |
| 23  | `feature-card`                  | 72     | 1626 | 1697 | 54.2      | 56.6      | `t3`              | Breadth                             |
| 24  | `colour-event`                  | 42     | 1698 | 1739 | 56.6      | 58        | `t3`              | Payoff                              |
| 25  | `type-card`                     | 54     | 1740 | 1793 | 58        | 59.8      | `t1`              | Callback                            |
| 26  | `type-card`, `variant: "name"`  | 43     | 1794 | 1836 | 59.8      | 61.233333 | `t1`              | Name. 6 words at most               |
| 27  | `end-card`                      | 113    | 1837 | 1949 | 61.233333 | 65        | none (last scene) | CTA: 44 frames of build, 69 of hold |

## Rules that apply to every template

| Rule                         | Value                                                                                                                                                                                                                                                                                                          |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Median beat                  | 1.7 to 2.4 s. All three templates have a median of 72 frames, 2.4 s                                                                                                                                                                                                                                            |
| Shortest and longest         | No beat under 15 frames (0.5 s). None over 120 frames (4 s) except the end card or a flagged set piece                                                                                                                                                                                                         |
| `card.min`                   | Each `type-card` lasts at least `max(43, ceil(6.5 * words))` frames, counting headline and subhead words                                                                                                                                                                                                       |
| Words a `type-card` can hold | 43 frames: 6. 48 or 51 frames: 7. 54 frames: 8                                                                                                                                                                                                                                                                 |
| Mark deadline                | `logo-reveal` starts at 90. `90 + markLegibleAt <= 105`                                                                                                                                                                                                                                                        |
| First surface                | `site-hero` starts at 150 (Short) or 180. Rule 2 needs it by 210 (7 s)                                                                                                                                                                                                                                         |
| Colour event                 | Past 60% of runtime on Neutral Cut: Short 70%, Standard 81%, Long 87%                                                                                                                                                                                                                                          |
| Music cue snap               | A hero scene may move to the nearest music cue within 6 frames. Move only the boundary before it: the scene before gains `delta`, the hero scene loses it, both still meet `card.min`, and the total is unchanged. Only the render step does this, from the cue sheet. The Director writes the template frames |

## Substitutions that keep the frames

These are the only substitutions. The Director makes every one of them, because each swap needs
copy. The Art Director never changes a scene's type: it sends the campaign back instead. The
"Seams after the swap" column is [N]: the reference spec gives the swaps but not their seams. The
Standard default has 6 dead stops in 17 seams, the most rule 2 in `director-seams` allows, so no
swap adds a `t3`, except the tour row's.

| Situation                                                                             | Change                                                                                                                              | Frames                                                                                                                               | Seams after the swap                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Standard with fewer than 3 numeric claims                                             | Replace the missing proof rows, from the last one back, with `feature-card` or `status-relay`, the same type for every replaced row | Each row keeps its 96 frames. The scene runs its build, then holds its final state with drift until its exit, as its scene file says | Row 8 replaced: seam 7 becomes `t1` into the first card, and seam 8 stays the pinned `t5`. Rows 7 and 8: seam 6 becomes `t1`, seam 7 stays `t5` (same type), seam 8 stays pinned. Rows 6 to 8: seam 5 stays `t1`, seams 6 and 7 stay `t5`, seam 8 stays pinned |
| Short with no numeric claim at all                                                    | Row 7 becomes a third `feature-card`. Write "no numeric proof" in your handoff for the approval step                                | 96                                                                                                                                   | Seam 6 becomes `t5`, so the three cards are one group. Seam 7 stays `t3`                                                                                                                                                                                       |
| Fewer than 6 captured tiles from the customer's site for `tile-wall`                  | A `feature-card` with its own headline                                                                                              | The row keeps its frames: Standard 66, Long 72                                                                                       | Unchanged. Standard seams 13 and 14 stay `t3`. Long seam 5 stays the pinned `t5` into the pivot                                                                                                                                                                |
| Long, row 17                                                                          | `iso-chain` when 2 or 3 concepts can each key a hue, else `cell-type`                                                               | 108                                                                                                                                  | Unchanged: both exit by the pinned `t5`                                                                                                                                                                                                                        |
| No two full-page captures that fit `site-scroll`, with page 2's `ctaBox` or `targetY` | Standard row 5 or Long row 8 becomes a `site-hero` on the best captured screen row 3 does not show, no props, at most one `label`   | 72, the row's start and end                                                                                                          | The seam out of it becomes `t3`: a `site-hero` leaves on scale, so no `t1` joins it to the next row. It is the one swap that adds a dead stop                                                                                                                  |

No other substitution is allowed. Never add, drop or reorder rows. Record every substitution in
your handoff: row, old type, new type.
