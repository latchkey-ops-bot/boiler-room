# `stat-counter`

**Kind** proof. **Effort** S. **Asset tier** cited value. **Refs** ref F-BR, ref B, ref E.

## Purpose

One large cited number with a label. The proof scene for a single claim, and the fallback when a
claim has one number with nothing to compare it to.

96 frames, in the proof rows of every template [D].

## Registry entry

| Field     | Value                                                                  | Tag |
| --------- | ---------------------------------------------------------------------- | --- |
| `kind`    | `proof`                                                                | [D] |
| `ground`  | Neutral Cut `base`, Kinetic Plate `plate`                              | [N] |
| `text`    | `{ headline: 10, label: 40 }`                                          | [N] |
| `anchors` | `number`: the number box. Entry and exit `{axis: 'x', sign: 1, v: 46}` | [N] |
| `props`   | `countUp?: boolean`, default `false`                                   | [N] |

**Count-ups wait for the founder [D].** The reference spec recommends allowing a count-up only
from zero to exactly the cited value, with the final value held for at least 30 frames, and never
scrambling through other digits. That is still an open decision, so `countUp` stays `false`
unless the founder has approved it.

## Text and assets

| Text id role | Required | Limit                                                                                                                                                                                     | Claims                                                                      |
| ------------ | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `headline`   | yes      | The number with its unit, such as `40%`, `3x`, `$29` or `90 seconds`. About 10 characters, so it reaches display size                                                                     | Must cite a claim whose quote states it                                     |
| `label`      | yes      | 6 words, 40 characters: what the number counts. Keep the quote's qualifier, such as "more than" or "up to", here when the headline cannot hold it (`Under 90 s` and `3,000+` hold theirs) | Cite the same claim. The two are also checked read together as one sentence |

No assets.

## Layout

|        | 16:9                                                                                                                                         | 9:16                        | 1:1                         | Tag                              |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | --------------------------- | -------------------------------- |
| Number | cap `capD` 211 px, font size `Math.min(capDerivedSize, fitText({withinWidth: 0.8 * W}).fontSize)`, centred at (W/2, 0.42 H). Tabular figures | width 0.86 W, centre 0.40 H | width 0.80 W, centre 0.42 H | [M] ratio; [D] 0.8 W; [N] others |
| Label  | `capS`, centred, baseline 0.72 H, box 1248 px                                                                                                | baseline 0.56 H, box 929 px | baseline 0.74 H, box 864 px | [N]                              |
| Colour | Number in `ink`, or the accent phrase via `props.accent`. Label in `ink`                                                                     |                             |                             | [D]                              |

If the fitted number font is under `0.13 W`, the layout check fails and the Director shortens the
headline [D].

## Motion

| Element                  | Frames                   | Motion                                                                                                                                                                                                                  | Tag                                                                      |
| ------------------------ | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Number, T3 entry         | `f` 0 to 5               | Pops at full value, scale `1 + 0.26 * 0.3 ** f`                                                                                                                                                                         | [M] `arrive.slam`                                                        |
| Number, T5 entry         | `f` 0 to 6               | Blink and rack, full value                                                                                                                                                                                              | [M]                                                                      |
| Number, T1 entry         | `f` 0 to 13              | `seamIn` on x, full value                                                                                                                                                                                               | [M]                                                                      |
| Count-up (when approved) | `f` 0 to 41              | `0` from `f = 0` to 5. Then `round(target * arriveN(abs - (from + 6), 0.88, 35))` at the target's decimals and grouping, so it reaches the exact value at `f = 41`. Prefix and unit show from `f = 0`. Values only rise | [M] ref B count-up on `arrive.long`; [D] from zero, exact end; [N] start |
| Final hold               | from `f = 41` to the end | 55 frames at the exact value                                                                                                                                                                                            | [D] 30 or more                                                           |
| Label                    | from `f = 8`             | `wordRise(f - 8, j, 1, 26, 0.5)`                                                                                                                                                                                        | [M] short rise; [N] start                                                |
| Drift                    | every frame              | Number and label `scale(1 + 0.0013 * f)`                                                                                                                                                                                | [M]                                                                      |
| T1 exit                  | `f` 85 to 95             | `seamOut` on x                                                                                                                                                                                                          | [M]                                                                      |

The counter reads the absolute frame, so it is a shared clock that keeps counting through a cut if
a later scene shows the same value [M ref B].

## Transitions

| In                                                  | Out                                                             |
| --------------------------------------------------- | --------------------------------------------------------------- |
| T5 from another `stat-counter` (exempt), T1 (x), T3 | T5 into another `stat-counter`, T5 chapter (pinned), T1 (x), T3 |

## Acceptance stills

| Frame        | Must show                                                                                |
| ------------ | ---------------------------------------------------------------------------------------- |
| `f = 0`      | The number (or `0` in count-up mode) on screen                                           |
| `f = 8`      | Number at rest. Characters exactly equal to the `headline` value                         |
| `f = 22`     | Label complete, at least 78 px cap                                                       |
| `f = 41`     | Count-up mode: exactly the cited value                                                   |
| `f` 41 to 95 | The same digits on every frame                                                           |
| any          | No digit string other than the final value, or a rising count-up from zero when approved |
