# Boiler Room motion spec

Derived from the seven founder-chosen launch films. These films set the quality bar for `packages/motion`.

**Reference discipline.** Films are cited by id only, and this document never names the companies or products in them. No brand, logo, script line, colour palette or footage from them belongs in Boiler Room. What transfers is technique: timing, curves, structure.

**Ids.** The seven files are reference A to reference G, written ref A to ref G. Ref F is a 2x2 composite of four separate films, so its tiles are cited as ref F-TL, ref F-TR, ref F-BL and ref F-BR. That makes ten films from seven files.

**Evidence tags**

| Tag | Meaning                                                                                                            |
| --- | ------------------------------------------------------------------------------------------------------------------ |
| [M] | Measured from frames or audio                                                                                      |
| [F] | Fitted to [M] series by a fitting script, RMS given where it matters                                               |
| [E] | Estimate, read by eye or inferred                                                                                  |
| [D] | Director's decision. A recommendation, not a measurement                                                           |
| [U] | Unverified. Carried over from the original dossiers, and the 2026-11-07 recheck did not reproduce or re-measure it |

All frame counts assume 30 fps unless noted. Two files are not 30 fps [M]. Ref B is 29.97 fps (30000/1001). Ref F is a 60 fps container: its `TL` tile carries 24 fps content (2:3 duplicate cadence), and `TR`, `BL` and `BR` carry 30 fps content (2:2 cadence). Ref F durations are given in seconds or as 30 fps equivalents, never as raw 60 fps file frames.

**Render target [D].** 1920x1080 at 30 fps is the floor. The files are: ref D 3840x2160 at 30 fps, ref F 2566x1440 at 60 fps, ref A, ref B, ref E and ref G 1920x1080 at 30 or 29.97 fps, and ref C 1492x1080 at 30 fps [M]. 3840x2160 at 30 fps is an optional premium export. 1080p60 waits until tokens can be retimed (see "Frame rate lock" in section 3), because the first build renders 30 fps only. If the 15-step texture is used, keep it at any output resolution: ref D still steps motion on twos at 4K, effective motion about 15.6 fps [M].

## Corrections to the inputs

Read these first. Each one changes a plan.

| #   | Input said                                        | Finding                                                                                                                                                                                                         | Evidence                                                                                                                                                                                                                                     |
| --- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Ref G and ref D: speech only flagged by heuristic | **Both are narrated.** Local speech recognition returned clean, on-topic sentences that track the on-screen copy                                                                                                | [M] 153 words in ref G, 65 in ref D, mean word confidence 0.69 to 1.0 per segment. Run offline with the tiny.en model; no audio left this machine. The recheck got 152 for ref G. The ref D count holds only with VAD off: with VAD it is 42 |
| 2   | Ref A: music only                                 | No narration, but the track carries a vocal or vocal-like sample. Recognition returned repeating lines at low confidence, and one glide is visible at about 17.9 to 18.7 s                                      | [E]                                                                                                                                                                                                                                          |
| 3   | Films run 27 to 84 s                              | 27 s is the length of the composite file, not of a film. Ref F-TR is a complete 15.48 s loop, ref F-TL is 26.65 s, and ref F-BL and ref F-BR are cut off by the file end                                        | [M] The `TR` tile repeats at a lag of 929 container frames, 15.483 s (median tile MAD 0.44, against 3.0 or more at ±2 frames). Ref F is a 60 fps container: `TL` is 24 fps content, the other tiles 30 fps                                   |
| 4   | Ref E has 11 beats                                | That count treats five feature cards as one beat. Separated, it is 14 beats, mean 2.86 s, median 2.42 s                                                                                                         | [M] recomputed from swap frames. [U] Beat counts depend on a beat definition the recheck could not reproduce                                                                                                                                 |
| 5   | Scene detection gives the edit count              | It does not on light grounds. Ref C and ref E report 1 shot at threshold 0.3 and have 11 and at least 7 real swaps. Quality Check cannot use scene score alone                                                  | [M]                                                                                                                                                                                                                                          |
| 6   | `nova.campaign.json` as a starting shape          | Its 4 scenes average 5 s, about 2.5 times the reference median beat of 1.97 s [U], and it uses `fade` and `slide`. No film joins scenes with a cross-dissolve. Treat it as a schema fixture, not a pacing model | [M]                                                                                                                                                                                                                                          |

## 1. What the films share, and the style families

### Shared traits

| Trait                                 | Evidence across the ten films                                                                                                                                                                                                                                                                                                  |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Two-second beat                       | Median beat 1.67 to 2.42 s on the six single films, median of medians 1.97 s [M] [U]                                                                                                                                                                                                                                           |
| Very little copy                      | 1 to 8 words per card, at most 2 lines in ref A, ref B, ref D, ref E, ref G. The exceptions are status lines in ref C, 4 to 8 words at small size, and that is its flagged weakness [M]                                                                                                                                        |
| Edits hide inside motion              | Ref A about 14 of 28 junctions matched [U: an automated swap detector found 22 to 23 swaps]; ref D 25 of 32 events have a change curve climbing into them; ref C about 26 of 37 junctions continuous; ref G 8 of about 14 events are masks or same-object moves; ref F-BL has 1 detected hard cut [M]                          |
| One curve family per film             | Ease-in to a cut, geometric decay after it. Ref C fits four easing families to nearly all moves [M]                                                                                                                                                                                                                            |
| Type never overshoots                 | No type overshoot in any film. Only ref C has a 5 px letter landing bounce [M]                                                                                                                                                                                                                                                 |
| No cross-dissolve between scenes      | None in any film. Dissolves appear only inside a device screen (ref A). Ref F-BL dips through black instead [M]                                                                                                                                                                                                                |
| One ground per section                | Near-white flat grounds in ref A, ref C, ref E, ref F-TL. Dark plates in ref B, ref F-BL, ref F-BR, ref F-TR. Sectional fields in ref D, ref G [M]. One accent is measured only on ref E. Ref G runs a keyed categorical palette, and ref B's accent is a hue-shifting gradient [M]. See section 7                             |
| Depth and light on the active element | Captured or rebuilt UI sits on perspective-tilted planes with focus falloff, and the one active element is lit with a rim, glow or sweep, not only raised: ref B 24.2 to 30.9 s, ref F-BL, ref F-TR, ref F-TL bloom, ref A hardware swivels in 3D [E, viewed]. See `camera.depth` (section 3) and the light tokens (section 7) |
| Sound follows structure, not cuts     | Cuts sit at or below chance against the beat in ref A, ref B, ref D, ref G. Bass, drops and silences follow story sections [M]                                                                                                                                                                                                 |
| Product is rebuilt, not recorded      | Only ref C shows clear real screenshots, for 5.5 s of 84 s. Ref D could be either [M/E]                                                                                                                                                                                                                                        |
| Quiet end                             | Static end hold 1.77 to 2.97 s, median about 2.2 to 2.3 s. Music fades across the end card: only ref A clearly ends it before the picture, by about 2 s [M]                                                                                                                                                                    |

"Rationed colour" (one saturated event per film) was listed here. It is a Neutral Cut trait, not a shared one, so it now sits with that family. Mean frame saturation never exceeds 17 in ref A, ref C or ref E, but ref G is above 30 on 17.9% of frames from 2.7 s, and ref B above 20 on 15.4% of frames from 0.6 s [M, ffmpeg signalstats SATAVG at 10 fps].

### Style families

| Family                 | Refs                                | Signature                                                                                                                                                                                                                                           | Reachable in code                                              | Use it for [D]                                      |
| ---------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | --------------------------------------------------- |
| **Neutral Cut**        | Ref A, ref E, ref F-TL              | One flat pale ground. Black type alternates with proof. Clean discipline, fixed slots. Rationed colour: one saturated event, ref A a 1.1 s macro after 49 s of grey, ref F-TL a 2.3 s video shot, and the same in ref C, a 1.3 s shot at 74.8 s [M] | High. Weakest dependency on hero assets, if the proof exists   | Default for any brand with a light site             |
| **Kinetic Plate**      | Ref B, ref F-BL, ref F-BR, ref F-TR | Oversized type slams on a moving dark gradient plate. One lit element at a time. The plate carries saturation throughout, and the type stays neutral [M]                                                                                            | High for type and plate. Ref F-BR chrome needs rendered assets | Dark brands, launches, category claims              |
| **Continuous Diagram** | Ref C                               | One persistent actor and status line. Containers morph. Monochrome, greeked UI                                                                                                                                                                      | High, but choreography heavy                                   | AI agents, workflows, products with no good imagery |
| **Cell World**         | Ref D, ref G                        | One cell language (dots, tiles, cubes). Ground changes by section, content swaps at seams. Full-bleed colour fields are section grounds, and ref G keys each hue to one concept [M]                                                                 | Medium. Needs a projection and cell renderer                   | Developer tools, infrastructure, set pieces         |

The first build should ship two skins, Neutral Cut and Kinetic Plate. Continuous Diagram and Cell World ship as individual set-piece scenes, not whole-film skins [D].

## 2. Structure and pacing

### Numbers across all films

Times are seconds. "Mark" is the first logo or product name. "Surface" is the first product object or UI. The Beats, Mean beat, Median beat and Range columns are [U]: they depend on a beat definition the recheck could not reproduce. Lengths and End static were re-measured [M].

| Film     | Length | Complete   | Beats    | Mean beat | Median beat  | Range          | First mark            | First surface            | End static                                                       |
| -------- | ------ | ---------- | -------- | --------- | ------------ | -------------- | --------------------- | ------------------------ | ---------------------------------------------------------------- |
| Ref A    | 58.7   | yes        | 29       | 2.02      | 2.00         | 0.6 to 4.1     | 0.07                  | 3.07                     | 2.30                                                             |
| Ref B    | 50.8   | yes        | 18       | 2.82      | 1.93         | 1.0 to 12.4    | 2.34                  | 4.04                     | 2.14 strict, 2.34 with the settle                                |
| Ref C    | 83.9   | yes        | 38       | 2.21      | 1.78         | 1.07 to 5.2    | 12.03                 | 15.9 rebuilt, 69.27 real | 2.6 (3.57 if a small element changing every 6 frames is ignored) |
| Ref D    | 68.5   | yes        | 37       | 1.85      | 1.67         | 0.67 to 5.27   | 6.07                  | 0.67 inline, 11.0 UI     | 1.77 to 2.07                                                     |
| Ref E    | 40.1   | yes        | 14       | 2.86      | 2.42         | 0.53 to 6.7    | 2.93                  | 6.63                     | 2.97                                                             |
| Ref F-TL | 26.65  | yes [E]    | 12       | 2.2       | 2.34         | 1.2 to 3.53    | 4.07                  | 6.4                      | 1.8 [E]                                                          |
| Ref F-TR | 15.48  | yes, loops | 11       | 1.4       | 1.27         | 0.33 to 2.91   | start not observable  | start not observable     | CTA 2.91                                                         |
| Ref F-BL | 26.65+ | no         | 7 blocks | 3.0 [E]   | not computed | 1.15 to 4.23   | not in file           | 5.33, file clock         | none                                                             |
| Ref F-BR | 26.65+ | no         | 14 [E]   | 1.9 [E]   | not computed | 0.5 to 5.5 [E] | under 1 [E]           | none, no product UI      | none                                                             |
| Ref G    | 68.2   | yes        | 28       | 2.43      | 2.20         | 0.73 to 4.5    | 0.47 glyph, 18.3 name | 31.7                     | 1.77, then 1 black frame                                         |

**Summary [M]**

- Median length: **63.4 s** across the six single films, range 40.1 to 83.9 (ffprobe: 58.73, 50.84, 83.93, 68.54, 40.09, 68.16 s). Adding the two complete tiles gives 54.8 s, range 15.5 to 83.9.
- Median of median beats: **1.97 s**. Median of mean beats: 2.32 s [U].
- First mark: median 2.9 s, range 0.07 to 12.0, over 7 films. First product UI: median 6.6 s, range 3.1 to 31.7.
- First strong hit: median about 2.7 s, range 1.2 to 5.0 [E] (the hit is chosen by eye: tagline, lockup, slam or zoom-through).
- End card including its build: median about 3.5 s [U], of which about 2.2 to 2.3 s is static [M].
- Late surfaces are flagged as weak: ref C at 83% for real UI and ref G at 46%.
- Screen share is about half type. Ref A measures 46.1% type and logo, 53.9% product.

### What the opening 3 seconds do

| Film     | Picture                                                                                                                                                   | Sound                       | Read                                                |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | --------------------------------------------------- |
| Ref A    | Wordmark fades up, rises, leaves on an accelerating curve. Tagline at 1.43 s                                                                              | Bass first appears at 1.4 s | Brand first, calm, precise                          |
| Ref B    | Three one-word cards on one moving plate. Lockup at 2.34 s                                                                                                | Quiet bed, -32 to -21 LUFS  | Velocity first                                      |
| Ref C    | One word. Its letters become portrait pills on an accelerating gap                                                                                        | Near-silent gaps            | Metaphor first, no brand for 12 s                   |
| Ref D    | Claim line builds on near-black. Inline objects open between words                                                                                        | Spoken claim                | Claim first                                         |
| Ref E    | Poster for 16 frames, then 6 blank frames, then the title rebuilds from frame 22. Panels enter at frames 85 to 86 (2.83 to 2.87 s) and settle at frame 91 | Digital silence to 0.72 s   | Weakest open, reads as an export fault              |
| Ref F-TL | One line grows to one word, then black, then a wall                                                                                                       | Not available               | Curiosity                                           |
| Ref F-BR | Title falls in from huge scale. Colour hit at 2.70 s                                                                                                      | Not available               | Event-trailer scale                                 |
| Ref G    | Pixel glyph builds and retracts on black, zooms through at 2.7 s                                                                                          | -47 to -36 LUFS             | Abstract, quiet, then the first voice line at 2.5 s |

The pattern: **one element on one ground, a quiet track, and the first real hit at about 3 s.** None opens on a product screen, unless the inferred true start of ref F-TR counts. Ref F-TR and ref F-BL openings are not observable in the file.

### Recommended lengths

| Format                 | Length   | Beats | When                                                                    | Why                                                 |
| ---------------------- | -------- | ----- | ----------------------------------------------------------------------- | --------------------------------------------------- |
| **Standard (default)** | **45 s** | 18    | Any customer order with 3 or more usable claims                         | See below                                           |
| Short                  | 25 s     | 11    | Outreach samples, social cuts, or sites with fewer than 3 usable claims | Ref F-TL proves 12 beats fit in 26.65 s [U]         |
| Long                   | 65 s     | 27    | 5 or more verified claims and 3 or more distinct product surfaces       | Matches the reference median, needs a wider library |

**Why the default moves from 25 to 45 s [D]**

1. **Bar.** The shortest complete single film the founder chose is 40 s. No single-film reference runs at 25 s.
2. **Argument.** At a 2 s beat, 25 s has 12 beats. After hook, mark and end card, that leaves room for one proof or two features, never both in depth. Ref E needs 40 s for claims, a pivot, breadth and a CTA.
3. **Sameness.** Every film over 60 s has a flagged repetitive stretch: ref A middle third, ref C middle, ref D third card round, ref G recap. Authored films hit that at about 45 s. A 12 to 15 scene library will hit it sooner, so 65 s should not be the default even though it is the reference median.
4. **Keep 25 s.** The original plan is the right length for outreach, so it stays as the Short format.

Do not go above 70 s until the library exceeds 20 scenes. Ref C runs 84 s on 38 bespoke beats [D].

### Beat templates

All sum exactly at 30 fps. Scene names are defined in section 9. A `campaign.json` scene equals one beat here, so a Standard film is 18 scenes, not 4.

Three fixes are applied to all three templates [D]. (1) The hook word and hook sentence are one `word-slam` scene of 90 frames, so the T2 collapse happens inside one scene, and a hook variant (`variants.hooks`, which replaces the first scene) swaps the whole hook as a unit. (2) In Standard and Long, the logo reveal starts at frame 90 and runs 90 frames, so rule 2's mark deadline (frame 105) leaves it 15 frames to resolve. (3) Every `type-card` meets `card.min`, so the name card is 43 frames, and the end card gives up the difference. Short's end card is 26 frames of build plus 69 of `hold.end`. Under `card.min`, Short's 51- and 48-frame type cards hold at most 7 words, not rule 20's 8.

**Short, 25 s, 750 frames, 11 beats, mean 2.27 s**

| #   | Scene                          | Frames | From | Job                                   |
| --- | ------------------------------ | ------ | ---- | ------------------------------------- |
| 1   | `word-slam`                    | 90     | 0    | Hook word, collapsing into a sentence |
| 2   | `logo-reveal`                  | 60     | 90   | Mark legible by 3.5 s                 |
| 3   | `site-hero`                    | 84     | 150  | Surface at 5.0 s                      |
| 4   | `type-card`                    | 51     | 234  | Value line                            |
| 5   | `feature-card`                 | 72     | 285  | Feature 1                             |
| 6   | `feature-card`                 | 72     | 357  | Feature 2                             |
| 7   | `proof-bars` or `stat-counter` | 96     | 429  | One proof                             |
| 8   | `colour-event`                 | 39     | 525  | Payoff                                |
| 9   | `type-card`                    | 48     | 564  | Callback to the hook                  |
| 10  | `type-card`, name variant      | 43     | 612  | Name                                  |
| 11  | `end-card`                     | 95     | 655  | CTA                                   |

**Standard, 45 s, 1350 frames, 18 beats, mean 2.50 s**

| #        | Scene                                   | Frames  | From | Job                                                                          |
| -------- | --------------------------------------- | ------- | ---- | ---------------------------------------------------------------------------- |
| 1        | `word-slam`                             | 90      | 0    | Hook word, collapsing into the hook sentence                                 |
| 2        | `logo-reveal`                           | 90      | 90   | Mark legible by 3.5 s                                                        |
| 3        | `site-hero`                             | 96      | 180  | Surface at 6.0 s                                                             |
| 4        | `type-card`                             | 54      | 276  | Value line                                                                   |
| 5        | `site-scroll`                           | 72      | 330  | Tour of the real site                                                        |
| 6 to 8   | `proof-bars` or `stat-counter`, 3 times | 96 each | 402  | Three claims, one template                                                   |
| 9        | `type-card`, pivot variant              | 54      | 690  | Breath. Pinned T5 chapter blink of 5 blank frames, at most 4 words (rule 11) |
| 10 to 13 | `feature-card`, 4 times                 | 72 each | 744  | Breadth on a fixed clock                                                     |
| 14       | `tile-wall`                             | 66      | 1032 | Scale, from captured pages                                                   |
| 15       | `colour-event`                          | 42      | 1098 | Payoff, past 80% of runtime                                                  |
| 16       | `type-card`                             | 54      | 1140 | Callback to the hook                                                         |
| 17       | `type-card`, name variant               | 43      | 1194 | Name                                                                         |
| 18       | `end-card`                              | 113     | 1237 | CTA                                                                          |

If the site gives fewer than 3 numeric claims, replace the missing `proof-bars` with `feature-card` or `status-relay`. Keep the total frames [D].

**Long, 65 s, 1950 frames, 27 beats, mean 2.41 s**

| #        | Scene                                   | Frames  | From | Job                      |
| -------- | --------------------------------------- | ------- | ---- | ------------------------ |
| 1, 2     | `word-slam` 90, `logo-reveal` 90        | 180     | 0    | Hook and mark            |
| 3        | `site-hero`                             | 96      | 180  | Surface at 6.0 s         |
| 4        | `type-card`                             | 54      | 276  | Problem                  |
| 5        | `tile-wall`                             | 72      | 330  | Problem at scale         |
| 6        | `type-card`, pivot variant              | 54      | 402  | Turn                     |
| 7        | `type-card`                             | 54      | 456  | Value line               |
| 8        | `site-scroll`                           | 72      | 510  | Tour                     |
| 9 to 11  | `status-relay`, 3 times                 | 60 each | 582  | How it works             |
| 12 to 14 | `proof-bars` or `stat-counter`, 3 times | 96 each | 762  | Three claims             |
| 15, 16   | `rail-words`, 2 times                   | 63 each | 1050 | Breadth, fast            |
| 17       | `iso-chain` or `cell-type`              | 108     | 1176 | Set piece                |
| 18       | `type-card`, pivot variant              | 54      | 1284 | Breath                   |
| 19 to 23 | `feature-card`, 5 times                 | 72 each | 1338 | Breadth on a fixed clock |
| 24       | `colour-event`                          | 42      | 1698 | Payoff                   |
| 25       | `type-card`                             | 54      | 1740 | Callback                 |
| 26       | `type-card`, name variant               | 43      | 1794 | Name                     |
| 27       | `end-card`                              | 113     | 1837 | CTA                      |

## 3. Motion tokens

### Why not springs

Remotion's `spring()` starts at zero velocity. Every measured arrival starts at peak velocity: the first frame after a cut covers 32 to 52% of the travel in ref B [M] [U]. A critically damped spring would need a stiffness near 1,760 to cover 41% in one frame, and would then reach 95% in about 3.5 frames, against the measured 10 frames to 95% [F] [U]. The recheck did not re-measure this argument, because it depends on a definition of an arrival it could not reproduce. So arrivals use geometric decay, and `spring()` is kept for rare UI pops.

### Core curves

Three functions cover most moves. They reproduce the measurements below and were run against them. `seamIn` at k 0.72 gives speeds 46, 33, 24, 17, 12, 9, and at k 0.70 gives 46, 32, 23, 16, 11, 8, against ref A's measured 46, 36, 22, 16, 10, 8 (the third word of line 1, [M] recheck). `doorOffset` gives 0, 4, 19, 57, 131, 259, 462, 762 against ref E's measured 2, 6, 22, 58, 130, 258, 460, 762 [M, re-measured exactly].

```ts
/** Measurement form: 0 to 1, starts at peak speed, never quite reaches 1. k is the fraction of remaining travel left after each frame. */
export const arrive = (f: number, k: number): number => (f <= 0 ? 0 : 1 - k ** f);

/** Build form. Reaches exactly 1 at f = D, so "settled" is defined. D comes from the arrive token table. */
export const arriveN = (f: number, k: number, D: number): number =>
  f <= 0 ? 0 : f >= D ? 1 : (1 - k ** f) / (1 - k ** D);

/** 0 to 1 over n frames. Speed multiplies by r each frame, and it ends at peak speed. */
export const depart = (f: number, n: number, r: number): number =>
  f <= 0 ? 0 : f >= n ? 1 : (r ** f - 1) / (r ** n - 1);
```

Use `arriveN` in code. `arrive` never reaches 1: a 402 px lift on `arrive.long` still has 3.5 px to go at its 99% frame (37) and 18.7 px at frame 24, and snapping to rest makes a visible jump [M, curve check]. With `arriveN`, a token counts as settled at exactly `f = D`, and holds and anchor boxes count from `D`. Each frame delta is multiplied by `1 / (1 - k ** D)`, which is 1.010 for `arrive.fast`, so it stays within 1% of the measured series.

**Frame rate lock [D].** `packages/motion`'s `calculateMetadata` throws unless `campaign.fps === 30`, next to the `validateCampaign` call. The schema accepts any positive integer fps, but integer tokens (1-frame stagger, 2 blank frames, `n` 11, the 72-frame clock) would play at the wrong speed or need fractional frames at 24 or 25 fps. `perFrame` is left out of the first build. If other rates are needed later, convert in one place: `F(n30) = Math.round(n30 * fps / 30)` for frame counts, and `k ** (30 / fps)` for decay constants.

### Arrive tokens

| Token         | k per frame | Frames to 95% / 99% | Settle frame D | Bezier equivalent        | Evidence                                                                                                                                                                                                                                                                                                                                                                 |
| ------------- | ----------- | ------------------- | -------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `arrive.slam` | 0.30        | 3 / 4               | 6              | `0.16, 1.02, 0.28, 0.99` | [M] ref E panels over 6 frames: they enter at frames 85 to 86 (2.83 to 2.87 s) and settle at 91. The mean remaining-distance ratio is 0.28 to 0.30, but the per-frame ratio falls each frame, 0.41, 0.34, 0.26, then 0.10 to 0.20, so a constant 0.30 predicts 163 px at frame 2 where 224 px was measured. If shape matters, use a tightening k: 0.42, 0.35, 0.26, 0.15 |
| `arrive.snap` | 0.50        | 5 / 7               | 8              | `0.17, 0.96, 0.40, 0.98` | [M] ref B phone rise 0.48, ref A short word rise 0.45                                                                                                                                                                                                                                                                                                                    |
| `arrive.fast` | 0.72        | 10 / 15             | 14             | `0.19, 0.89, 0.45, 0.97` | [M] ref B 0.70 to 0.76. Ref A lateral, third word: k 0.66 to 0.70 (offset fit 0.66 at RMS 1.5% of travel; 0.72 gives 5.3%). Ref A long rise 0.77 (RMS 2.7%). 0.72 is slightly slow for lateral seams: use 0.68 to 0.70 there                                                                                                                                             |
| `arrive.slow` | 0.82        | 16 / 24             | 23             | `0.19, 0.89, 0.46, 0.97` | [M] ref B 0.81 to 0.82, ref F-TR pill 0.82                                                                                                                                                                                                                                                                                                                               |
| `arrive.long` | 0.88        | 24 / 37             | 35             | `0.20, 0.88, 0.46, 0.97` | [M] ref A final name card 0.88, ref D about 0.91, ref B count-up 0.915                                                                                                                                                                                                                                                                                                   |

Bezier equivalents are [F]. Each one matches the normalised curve `arriveN` over its own D within 0.3% of travel: 0.08% RMS for slam, 0.29% snap, 0.15% fast, 0.13% slow and 0.21% long [M, curve checks]. Against the raw `arrive` curve at the 99% frames (4, 7, 15, 24, 37) they miss by 6.9%, 3.2%, 0.9%, 0.5% and 1.0%. Use them only where a bezier is required, as `interpolate(f, [0, D], [0, 1], {easing: Easing.bezier(...), extrapolateLeft: 'clamp', extrapolateRight: 'clamp'})`. Single-film outliers exist: the ref G pullback fits k 0.61.

### Depart tokens

| Token              | r per frame | Frames | Bezier equivalent        | Evidence                                                                                                                                                                                                                 |
| ------------------ | ----------- | ------ | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `depart.whip`      | 1.20        | 9      | `0.41, 0.16, 0.73, 0.45` | [M] ref G whip, fitted 1.24, median 1.19                                                                                                                                                                                 |
| `depart.long`      | 1.40        | 11     | `0.50, 0.05, 0.79, 0.19` | [M] ref A 1.3 to 1.5 over 9 to 12 frames, ref B lift and shrink both fit 1.36                                                                                                                                            |
| `depart.short`     | 2.00        | 6      | `0.53, 0.04, 0.80, 0.16` | [M] ref B about 2 over 4 to 5 frames, ref D fits 1.91, ref E door fits 1.73                                                                                                                                              |
| `depart.drag`      | 1.11        | 26     | not fitted               | [M] ref F-TL wall ramp, file frames 189 to 242 (0.88 s), 22 steps of 24 fps content, re-expressed at 30 fps. 1.11^26 is about 15, the same 15x total speed. The earlier 1.14 over 21 was counted in 24 fps source frames |
| `depart.slowBuild` | 1.037       | 55     | not fitted               | [M] ref F-BR grid roll, total speed 7.5x. It moves on 30 fps steps, about 53 of them by the recheck                                                                                                                      |

### In-out and camera tokens

| Token         | Bezier                    | Frames   | Evidence                                                                        |
| ------------- | ------------------------- | -------- | ------------------------------------------------------------------------------- |
| `step`        | `0.85, 0, 0.15, 1`        | 30 to 36 | [M] ref C layout moves, RMS 1.3 to 1.6%                                         |
| `step.short`  | `0.76, 0, 0.24, 1`        | 21       | [M] ref C, RMS 2.1%                                                             |
| `hop`         | `0.9, 0, 0.1, 1`          | 11 to 25 | [M] ref C, RMS 2.0 to 2.8%                                                      |
| `lift`        | `0.68, -0.06, 0.34, 1.06` | 11       | [F] ref E hero to header, RMS 0.4%, 11 samples                                  |
| `collapse`    | `0.94, 0.12, 0.34, 0.82`  | 13       | [F] ref B display word to sentence size, RMS 0.1%, peak speed about 60% through |
| `camera.skew` | `0.66, 0.25, 0.04, 0.98`  | 26       | [F] ref G flat to iso, RMS 0.6%, half the change 9 frames in                    |
| `camera.grow` | `0.56, 0.33, 0.21, 0.89`  | 20       | [F] ref G 16:9 card behind heroes, RMS 1.0%                                     |
| `linear`      | `0, 0, 1, 1`              | any      | [M] Reserved for scan lines (ref E 20 px/f) and counters                        |

[F] rows rest on one series each, so they are shapes that fit a film, not universal constants. A single bezier cannot fit all arrivals: the pooled fit misses by 5.3% RMS. That is why arrivals are tokens by k.

Ref E bars: `Easing.out(Easing.poly(4))`, 24 to 25 frames [M]. Poly-4 fits 4 of 5 bars, over 24.25 to 25.5 frames with a free origin (RMS 0.11 to 0.26%) or 23.5 to 24.75 frames with the origin pinned to the track start (RMS 0.12 to 0.53%). The second bar reaches the end of its track and fits poly-3 better.

### Depth tokens

`camera.depth` [D, values are estimates]. Depth is one of the main things that makes the films look expensive, and the first draft had no token for it. Seen in: ref B 30.4 to 30.9 s, a results page on a perspective-tilted plane with defocused top and bottom rows and one sharp lifted card; ref B 24.2 to 27.2 s, three cards stacked in z on a turntable with orbiting icons; ref F-BL, a list panel on a tilted plane whose far rows are dimmer and softer; ref F-TR, panels on a plane receding to the right; ref A, hardware swivelling in true 3D [E, viewed in the dossier strips].

| Property      | Value                                                                                                         |
| ------------- | ------------------------------------------------------------------------------------------------------------- |
| Perspective   | About 1200 to 2000 px at 1920 wide                                                                            |
| Plane tilt    | `rotateX` or `rotateY` of 10 to 25 degrees                                                                    |
| Focus falloff | Blur rises with distance from a focus band: 0 px inside it, up to about 4 to 8 px at the frame edge at 1080p  |
| Parallax      | Foreground chips and icons move 1.2 to 1.5 times as fast as the plane                                         |
| Cheap build   | Two copies of the capture, one sharp and one blurred, blended by a `linear-gradient` mask along the tilt axis |

This fits tier 1 to 3 captured pages (section 6), so it is an honest way to lift Boiler Room's weakest asset class. The orthographic iso projection in section 5 stays the default for `iso-chain`.

### Springs and overshoot

| Token            | Use                                                                  | Value                                                                                                                                                                                                           | Evidence                                                                                                                                                                                                                                                                                             |
| ---------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `overshoot.none` | **Default.** Type, cards, windows, camera                            | 0%                                                                                                                                                                                                              | [M] All films                                                                                                                                                                                                                                                                                        |
| `spring.pop`     | UI node or chip pop, Neutral Cut family only, non-type elements only | `spring({frame: f + 2, fps: 30, config: {mass: 1, damping: 26, stiffness: 550}, from: 0.46, to: 1})`. The first visible frame, f 0, is at 0.794, the peak is at f 3 (1.066), and it is settled within 1% at f 6 | [F] ref E node pop 0.80, 0.97, 1.05, 1.067, 1.05, 1.02, 1.0. Scale RMS 0.0014. Remotion 4.0.541's own `spring()` from 0.46 gives 0.460, 0.580, 0.794, 0.964, 1.049, 1.066, 1.047, 1.021, 1.002, so the film shows spring frames 2 to 8 [M, spring check]. The 0.46 start is inferred and never shown |
| `pulse.select`   | Selected card lands raised, card container only                      | `interpolate(f, [0, 4, 11], [1, 1.073, 1.038], {easing: Easing.out(Easing.quad), extrapolateRight: 'clamp'})`                                                                                                   | [M] ref E race card keyframes. The easing is [D]. Not a spring: it overshoots about 92% of its travel                                                                                                                                                                                                |
| `press.accent`   | One physical click, once per film                                    | Keyframes, 59% of travel past rest, 8 frames down, 6 back                                                                                                                                                       | [M] ref A lock. Left out of the first build: it names no property or travel, and its source is a physical click with real hands, which section 4 Deferred and section 6 rule 7 exclude                                                                                                               |

`bounce.land` (ref C, letters landing 5 px over 8 frames [M]) is removed until the Never rule on bounce in type changes.

### Durations

| Item                      | Frames                                                                  | Evidence                                                                                                              |
| ------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Ground dip to black       | True black 4 to 5 (0.12 to 0.17 s). Fade-out about 10, fade-up 12 to 25 | [M] ref F-BL, seven dips, as 30 fps equivalents of a 60 fps file. True black is maximum pixel at most 12/255. See T16 |
| Blink between cards       | 2 blank, 5 blank for a chapter                                          | [M] ref E                                                                                                             |
| Word rise, short          | 5 to 6, travel 24 to 28 px                                              | [M] ref A                                                                                                             |
| Word rise, long           | 8 to 13, travel 69 to 74 px                                             | [M] ref A                                                                                                             |
| Hero to header lift       | 11                                                                      | [M] ref E                                                                                                             |
| Bar fill                  | 24 to 25                                                                | [M] ref E                                                                                                             |
| Status relay              | 14 to 16                                                                | [M] ref C                                                                                                             |
| Type card, 2 lines        | 43 to 79                                                                | [M] ref A, 1.43 to 2.63 s                                                                                             |
| Headline card with typing | 74 to 76: 40 typing, 16 to 22 hold, 12 to 14 tail                       | [M] ref D                                                                                                             |
| Feature card clock        | 72                                                                      | [M] ref E, card spacing 71, 72, 72 and 77. The last card runs 77                                                      |
| Title block               | 53 to 64: 23 to 31 display, 30 to 33 sentence                           | [M] ref B                                                                                                             |

### Hold times

| Token             | Frames                                                                  | Evidence                                                                                                                                                                                                                                                                                                    |
| ----------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hold.hero`       | 23 before a lift                                                        | [M] ref E                                                                                                                                                                                                                                                                                                   |
| `hold.verdict`    | 25 after a verdict stamp                                                | [M] ref E                                                                                                                                                                                                                                                                                                   |
| `hold.display`    | 2 to 10 before a collapse                                               | [M] ref B                                                                                                                                                                                                                                                                                                   |
| `hold.tension`    | 26 fully static, at most once per film, before the hardest cut          | [M] ref G, 0.87 s                                                                                                                                                                                                                                                                                           |
| `hold.end`        | 69, range 53 to 89                                                      | [M] median about 2.2 to 2.3 s across 7 films (1.77 to 2.97 s)                                                                                                                                                                                                                                               |
| `card.min`        | `max(43, 6.5 × words)` total screen time, for every `type-card` variant | [M] ref A shortest card and its 8-word card at 52 frames. [D] `word-slam` and `colour-event` are exempt, because slams read at display size. Validator: for each `type-card`, `durationInFrames >= max(43, ceil(6.5 × words))`, where words is the whitespace word count of its headline and subhead values |
| `card.phone`      | `max(54, 8 × words)` for copy that must read on a phone                 | [E] [D] ref D's hold is flagged as tight. Not applied yet: nothing triggers it, because the schema has no phone target. Apply it to 9:16 and 1:1 only, once those formats are validated                                                                                                                     |
| Static tail limit | Under 30 mid-film                                                       | [D] ref E tails of 27 to 42 frames read as stalled                                                                                                                                                                                                                                                          |

### Stagger

| Item                      | Frames                | Evidence                                                                                                   |
| ------------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------- |
| Words, pop and rise       | 1                     | [M] ref A, exactly 1 everywhere                                                                            |
| Words, slower reading     | 3                     | [M] ref F-TL 2.4 source frames at 24 fps (`TL` is 24 fps content in the 60 fps file), ref B chat 3         |
| Words, in sequence        | 2 to 8                | [M] ref B, ref D                                                                                           |
| Word exits, reading order | 4                     | [M] ref D                                                                                                  |
| Letters                   | 1                     | [M] ref E, ref G                                                                                           |
| Rows, bars                | 2 to 4                | [M] ref E, bar starts at frames 200.5, 204.5, 206.75, 209.25 and 211.5, a stagger of 4, 2.25, 2.5 and 2.25 |
| Cards                     | 2                     | [M] ref D                                                                                                  |
| Lines                     | 2                     | [M] ref G                                                                                                  |
| Ticker lines              | 4                     | [M] ref D                                                                                                  |
| Cubes                     | 4                     | [M] ref G                                                                                                  |
| Grid tiles                | 0.33, 49 in 16 frames | [M] ref C                                                                                                  |

### Drift

| Family                     | Rule                                                                                                                                                                                                                                                                                          | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Neutral Cut                | Type scales +0.13%/f about frame centre during a hold. Product objects and captured pages never hold still: they carry slow continuous motion, such as a `rotateY` drift, a push, or a swivel into frame. Mid-film product shots have zero frames under the 0.02 MAD hold threshold (rule 13) | [M] ref A. The earlier "product may hold still" was wrong: in the hero lineup, 4.7 to 7.2 s, no frame is held (median MAD 0.63 to 0.69), and other product shots have no held frames apart from one 7-frame run at 39.03 s. The longest held run mid-film is 9 frames, at 13.70 s, on a type card. Only the end card holds, from 56.4 s. By eye, the motion ranges from slow drift to a swivel of roughly 60 to 90 degrees in about 1 s [E] |
| Kinetic Plate              | Word never stops. Recede about 2%/f after settling, stopping at sentence size (T4)                                                                                                                                                                                                            | [M] ref F-BL                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Continuous Diagram         | Shimmer the live line: opacity bands about 175 px apart, period about 19 frames                                                                                                                                                                                                               | [E] ref C, on a 1073 px stage                                                                                                                                                                                                                                                                                                                                                                                                               |
| Cell World with step clock | True stillness between moves, on 2-frame steps                                                                                                                                                                                                                                                | [M] ref D, MAD 0.0 in holds, 15 steps per second                                                                                                                                                                                                                                                                                                                                                                                            |

Optional texture: ref D runs at 15 steps per second. Its pts are a regular 1/30 s, and over 99.8% of motion frames fall on even frames: 840 of 841 changed frames with MAD over 0.1, and 901 of 901 with a maximum pixel difference over 16/255 [M]. Its clock is absolute. In code, step on the absolute frame, not the scene frame: `abs = sceneFrom + f; fs = abs - (abs % 2) - sceneFrom`. Scene-local stepping would mix phases at seams, because the Short template starts several scenes on odd frames (285, 357, 429, 525, 655). Put this in one hook, `useMotionFrame()`, which every scene, the `Stage` and any shared-clock counter reads. A film-level `stepped` flag turns it on or off for the whole film. Do not mix stepped and unstepped motion in one film [D].

## 4. Transition catalog

Ranked by how much of the films' feel each one carries, then by build cost.

### How transitions work in Boiler Room

The project rule is that transitions take no timeline time, so `TransitionSeries` is out. Most top transitions fit this naturally because they are hard cuts between two curves.

- **Seam wrappers.** A scene's outer wrapper reads `f = frame - seamFrame` from `sceneFrames`, then applies transforms. This covers T1, T2 and T3.
- **Overlays.** `transitionOut` names a component mounted across the boundary, and both scenes must render during it. A Remotion `<Sequence>` unmounts its children outside `[from, from + durationInFrames)`, so the mounting rule is [D]: mount scene i as `<Sequence from={from_i - PRE} durationInFrames={dur_i + PRE + POST}>`, and pass `f = useCurrentFrame() - PRE`. PRE and POST are the furthest the chosen transitions reach into that scene: T12 POST 9 (the outgoing halves), T14 POST equal to the ring duration (state A, the outgoing scene, keeps rendering under the growing B mask), and 0 otherwise. T16 needs PRE 0 and POST 0, because only frames under full black cross the seam. One-shot animations evaluate at `clamp(f, 0, dur - 1)`. Drift terms (+0.13%/f, the 2%/f recede) use the unclamped `f`, so drift does not freeze. During an overlap the incoming scene sits above the outgoing one, except in T6 (incoming beneath until the cover frame) and T12 (the halves on top).
- **Determinism.** Use `random('seed-' + i)` and `noise2D` from `@remotion/noise`. Never `Math.random()`.

```ts
export interface Seam {
  axis: 'x' | 'y' | 'scale';
  sign: 1 | -1;
  vPeak: number; // px per frame, or log scale per frame for 'scale' (0.03 is about 3%)
  n: number; // outgoing ramp frames
  r: number; // outgoing speed multiplier per frame
  k: number; // incoming decay per frame
  D: number; // incoming settle frame, the D of the arrive token with this k (14 for k 0.72)
}

const outTravel = ({ vPeak, n, r }: Seam): number =>
  (vPeak * (r ** n - 1)) / (r ** (n - 1) * (r - 1));

/** f = frame - seamFrame. f = -1 is the last outgoing frame, moving at vPeak. */
export const seamOut = (f: number, s: Seam): number =>
  s.sign * outTravel(s) * depart(f + s.n + 1, s.n, s.r);

/** f = 0 is the first incoming frame. Returns the offset from rest, which reaches exactly 0 at f = D. */
export const seamIn = (f: number, s: Seam): number =>
  f >= s.D
    ? 0
    : (-s.sign * (s.vPeak / (1 - s.k)) * (s.k ** Math.max(f, 0) - s.k ** s.D)) / (1 - s.k ** s.D);
```

For `axis: 'scale'`, apply `scale(Math.exp(offset))`, so rates compose across the cut. `seamIn` is normalised like `arriveN`: without it, an offset of 164 px at k 0.72 still has about 1 px left at frame 15. Each frame delta is multiplied by 1.010 at D 14, within 1% of the measured series that the primitive check reproduces.

### Ranked catalog

| Rank | Name                               | Frames                                | Refs                              |
| ---- | ---------------------------------- | ------------------------------------- | --------------------------------- |
| 1    | Matched-velocity seam              | 9 to 12 out, cut, 10 to 15 in         | Ref A, ref B, ref C, ref D, ref G |
| 2    | Hero-to-slot collapse              | 11 to 13                              | Ref E, ref B, ref C               |
| 3    | Dead-stop cut into word rise       | 0, then 5 to 13                       | Ref A, ref D, ref B               |
| 4    | Word slam over a held ground       | 1 overlap, 7 settle                   | Ref F-BL, ref B, ref F-TR         |
| 5    | Blink and rack                     | 2 blank, 4 rack                       | Ref E                             |
| 6    | Object becomes world               | 9 to 24                               | Ref G, ref B                      |
| 7    | Tile flood with a persistent hero  | 6 to 11                               | Ref G, ref D                      |
| 8    | Container morph                    | 18 to 45                              | Ref C                             |
| 9    | Long ramp into cut                 | 26 to 55                              | Ref F-TL, ref F-BR, ref C         |
| 10   | Vertical conveyor                  | 25                                    | Ref C, ref B                      |
| 11   | Soft-mask baton wipe               | 11                                    | Ref C                             |
| 12   | Door split with a surviving centre | 8 moving, 2 clear, headline at 11     | Ref E                             |
| 13   | Iris to dot and bloom              | 10 to 40                              | Ref C, ref D                      |
| 14   | Ring wipe from a point             | 11 to 19, depending on the origin [E] | Ref F-TR                          |
| 15   | Two-beat colour hit                | 2, then 11                            | Ref F-BR, ref F-TR                |
| 16   | Dip to black                       | 10 out, 5 black, 12 up                | Ref F-BL                          |
| 17   | Tension hold, colour slam          | 26 hold, 1 cut                        | Ref G                             |

#### T1. Matched-velocity seam

**Does.** The outgoing element accelerates into a hard cut at peak speed. The incoming element starts on the same axis at about the same speed and decays. The eye reads one curve across two shots. It works on x, y and scale.

**Variants.** Ref A lateral stretches word gaps along travel, with no glyph scale. The card cuts in at frame 166 (5.53 s). The third word of line 1 moves 46, 36, 22, 16, 10, 8, 5, 3, 1, 1 px/f, but words to the left travel further (word 1 at 49, 68, 38, 23, 15, 12; word 4 at 33, 29, 19, 13, 8, 6), so the move compresses the gaps rather than translating the card [M]. The gaps start stretched and close up, and glyph size does not change [E, viewed]. Ref D scale: 1.00 to 0.955 over 12 to 14 frames, then 1.13 decaying. Ref G whip: exit at r 1.2, leave one near-empty frame, enter moving the same way at about half speed.

**Build.** Call `seamOut` and `seamIn`, usually with `{n: 11, r: 1.4, k: 0.72, D: 14}` and `vPeak` 30 to 46 px/f or 0.02 to 0.03 log scale/f. For lateral seams, use k 0.68 to 0.70 [M ref A]. Keep speed across the cut within 1.5x [M ref A], measured from the two anchors' declared velocities, not from one shared `Seam` object, which always reads 1.0 (section 5). Scale around frame centre.

#### T2. Hero-to-slot collapse

**Does.** The same headline moves from centre stage to a layout slot as proof arrives, or a display word shrinks to exactly its size in the next sentence. It is not a cut, so the statement and its evidence read as one thought.

**Build.** `interpolate(f, [0, 11], [start, slot], {easing: Easing.bezier(0.68, -0.06, 0.34, 1.06), extrapolateLeft: 'clamp', extrapolateRight: 'clamp'})` for y and scale. Ref E: 402 px up, scale to 0.77. Bring the first data row in at frame 7 of 11, before the lift finishes [M]. For a word collapse, use `collapse` over 13 frames to an end scale of `sentenceSize / displaySize`, computed per word: about 0.37 at the 2.7:1 ratio, and never below the sentence minimum in section 7 [D]. The earlier fixed 0.33 is a 3.0:1 ratio and lands below the sentence minimum for every display size in range. Then append later words as 1-frame pops, and re-centre the line with `arrive.fast` [M ref B].

#### T3. Dead-stop cut into word rise

**Does.** A plain hard cut from a still shot, with the word rise supplying all the energy. About 10 of 28 ref A junctions work this way [M] [U]. Without it the film has no contrast, so it is a deliberate rest, not a fallback.

**Build.** No transition component. The incoming scene plays `wordRise` from frame 0:

```ts
export const wordRise = (f: number, i: number, stagger = 1, rise = 72, k = 0.75) => {
  const t = f - i * stagger;
  return { visible: t >= 0, y: rise * k ** Math.max(t, 0) };
};
```

Render words at opacity 1 from their first visible frame (the `pop` reveal mode, section 7). For a second line, push line 1 upward by `travel * arrive(f - line2Start + 1, 0.4)`, where `travel = lineHeight * fontSize / 2`, so the 2-line block re-centres on the fixed headline slot [D]. With k 0.4 it jumps 60% on the first frame, inside ref A's measured 49 to 71% [M].

#### T4. Word slam over a held ground

**Does.** The next word arrives huge over the outgoing word, at speed, for 1 frame of overlap. The ground stays at an exact flat level throughout, so no cut registers.

**Build.** The word is laid out at its display size, and `s` is a CSS scale about the word's centre (`hold = 1`). `excess = f === 0 ? 4.4 : 1.5 * 0.7 ** (f - 1)` and `s = Math.max((1 + excess) * 0.98 ** Math.max(0, f - 8), sentenceCap / displayCap)` [M ref F-BL, the BL words change every 2 file frames, so 0.7 and 0.98 are per 30 fps frame]. The floor stops the recede at sentence size (0.37 at 2.7:1). Without it, a 283 px display word is 145 px at the end of a 42-frame slam and 101 px at frame 59, below the sentence minimum [M, curve check]. The outgoing word stays mounted for exactly frame 0 of the incoming slam, a one-frame overlap. The ground is the `Stage`'s bottom layer, beneath the scenes (section 5), so it is not part of the swap. For a word that grows and is replaced by a smaller word still growing, drive both from one continuous scale [M ref B].

**Bleed variant [D].** Glyphs may exceed the frame while moving, but every word must sit wholly inside the safe area for at least about 10 frames [E, from 12-frame strip sampling]. In ref G 34.9 to 41.3 s, five display words as wide as or wider than the frame enter or exit clipped at the edge, and each one sits wholly in frame for a stretch (for example f1142 to f1154 and f1178 to f1214). Ref F-BR's title falls in with its words clipped at both edges [E, viewed]. Velocity-gated blur is allowed on the entry (section 7).

#### T5. Blink and rack

**Does.** On a fixed ground: all content gone in one frame, exactly 2 blank frames, then the headline at full ink but defocused, sharpening in 4 frames as it settles 13 px [M].

**Build.** Show nothing for `f` in 0 to 1. From `f = 2`, apply `filter: blur()` from `[6, 3, 1.2, 0]` px [E] and y from `[13, 7, 4, 1, 0]` px [M; the 13 px settle was not re-measured]. Use 5 blank frames for a chapter change. The headline slot must be a fixed coordinate across all cards. [M recheck] Runs of uniform ground in ref E: 2 frames at frames 586, 657, 729, 801 and 878, and 5 frames at 461. Viewing frames 584 to 600, the headline returns defocused at 588 and is sharp by about 591 [E]. T5's blank frames are exempt from rule 19.

#### T6. Object becomes world

**Does.** An element scales past the frame until its fill is the background. A 4-frame squeeze of 5% precedes it in ref G. Per-frame growth rises from 1.01 to 1.39 [M].

**Build.** Growth is multiplicative, so the per-frame ratio does not depend on the final scale. (The earlier additive form, `depart(f, 9, 1.5) * (maxScale - 1) + 1`, gives ratios from 1.03 to 1.30 at maxScale 3 up to a flat 1.51 at 40, and no maxScale gives 1.01 to 1.39 [M, curve check].)

- Squeeze, `f` in [0, 4): `s = interpolate(f, [0, 4], [1, 0.95])` [D curve].
- Growth, `g = f - 4 >= 1`: `rho(g) = Math.min(1.39, 1.01 * 1.0407 ** (g - 1))`, where 1.0407 is (1.39 / 1.01)^(1/8), so the ratio reaches 1.39 on growth frame 9. Then `s(g) = 0.95 * rho(1) * ... * rho(g)`.
- Cover scale `c = Math.max(W / el.w, H / el.h)`, using the element box from its anchor (section 5). The incoming scene cuts in beneath, in the same colour as the element's fill, on the first frame where `s >= c`. Growth stops at `1.2 * c`.

Covering takes about 8 to 13 growth frames for c of 2.5 to 16.7, inside the catalog's 9 to 24 frames [M, curve check]. That run left out the 0.95 squeeze, which adds 0 to 1 frame. Only vector or CSS-drawn elements qualify, never a raster logo (Never list).

#### T7. Tile flood with a persistent hero

**Does.** Tiles replace the ground behind a subject that stays on top. Coverage roughly doubles each frame: 2.4, 5.5, 11, 19, 35, 54% [M ref G]. Time the camera's peak speed to the largest gain.

**Build.** Divide the frame into cells, for example 108 px, which is 1080/10. Rank cells by distance from a seed plus `random('flood-' + i) * jitter`. Show the first `coverage[f] * n` cells. Continue through 78 and 100% [E]. Ref D's mosaic is the same mechanism on 128 x 72 cells, flooding from the centre. Render on a `<canvas>` or an SVG `<rect>` list, keyed to the frame.

#### T8. Container morph

**Does.** One rounded rectangle changes shape instead of crossfading to a new object. Contents leave first and arrive only after the shape settles. Width and height run in sequence: ref C 12 frames of width, then 27 of height [M].

**Build.** See section 5, `MorphBox`. Width runs over `f` in [6, 18) and height over [18, 45), each with `Easing.bezier(0.76, 0, 0.24, 1)`, the `step.short` shape, over 12 and 27 frames rather than `step.short`'s 21.

#### T9. Long ramp into cut

**Does.** A constant scroll or scale multiplies speed for a long stretch, then cuts at peak to a new scale extreme. Ref F-TL: 10 to 138 px per 24 fps source frame on the 1283 px tile, in 22 steps over 0.88 s (file frames 189 to 242) [M]. At 1920 px and 30 fps that is about 11 to 165 px/f (× 1920/1283 × 24/30). Ref C fling: 167 px/f, then a long inertial decay of about 38 frames that hides a page jump.

**Build.** Cumulative distance is `v0 * (r ** f - 1) / (r - 1)`. Use `depart.drag` or `depart.slowBuild`. For a fling, ramp 8 frames and decay with `arrive.long`.

#### T10. Vertical conveyor

**Does.** Each finished block scrolls up as the next rises on one S-curve, so one scroll ends one thought and starts the next.

**Build.** A single absolute container whose y is `-blockHeight * (i + stepEase(f))`, with `stepEase` from `step`, 30 frames. Blocks are laid out in one column.

#### T11. Soft-mask baton wipe

**Does.** A left-to-right soft edge erases one layer and reveals another, and its last erased glyph sits exactly where the next object resolves. Ref C's closing wipe is the same move reversed.

**Build.** `maskImage: linear-gradient(90deg, black ${p - s}%, transparent ${p + s}%)`, with `p` from `arrive.fast` and softness `s` about 8 [E]. Set `WebkitMaskImage` too.

#### T12. Door split with a surviving centre

**Does.** Each half of the frame, ground plus foreground, parts on one curve while a centre glyph flies through.

**Build.**

```ts
/** No clamp: the halves must leave the frame. Unmount them at f >= 9. */
export const doorOffset = (f: number, width: number): number =>
  width * 0.397 * (Math.max(0, f) / 8) ** 3.75;
```

[M] ref E frames 159 to 166 are f 1 to 8: the right panel edge moves 2, 6, 22, 58, 130, 258, 460, 762 px, and the left edge is identical except 132 at frame 163. 762/1920 = 0.397. At f 8, 198 px of each 960 px half is still on screen, which is why the earlier clamp at f 8 held them there forever. At f 9 the offset is 1186 px, more than W/2, so unmount the halves at f >= 9. Viewed at full resolution, ref E frame 166 still shows a wedge at each edge, frame 167 shows only the fading centre glyph, and frame 168 is empty ground [M].

Centre glyph scale runs 1.01, 1.05, 1.13, 1.28, 1.52, 1.86, 2.33, 2.95, 3.72 [M]. It fades only in its last 2 frames. f 10 is empty ground. The next headline enters at f 11 with a T5 rack and scale `1 + 0.26 * 0.3 ** (f - 11)` (`arrive.slam`), settling in 3 to 4 frames [M: height ratio 1.25 at frame 169, then 1.085, 1.017 and 1.00 at frame 172]. Clip the two halves with `clip-path`, each a copy of the scene. This is for a two-sided comparison and never needs a rival's logo.

#### T13. Iris to dot and bloom

**Does.** The world closes to a small dot, holds, and blooms into a logo. Ref D closes from over 960 to 23 px at 540-wide working scale in 10 frames, with edge softness falling 39, 8, 3, 1 px, holds 10 frames and blooms as a time reversal of its earlier logo collapse [M].

**Build.** `clipPath: circle(r at 50% 50%)`, or a radial mask when softness matters. Because animation is a pure function of frame, reversal is free: render the logo scene with `frame = d - f`.

#### T14. Ring wipe from a point

**Does.** A circle grows from a cursor or button point, with a thin coloured ring at its edge, and flips the same layout to a second state [M ref F-TR].

**Build.** Render the same scene twice, with state A and state B. Mask B with a circle whose radius grows by 4.2% of frame width per 30 fps frame, rising linearly to 7.5% of W over 15 frames, then a constant 7.5% W/f. At 1920 that is 81 to 144 px/f [E: assumes the measured 54 to 96 px/f were 1283 px tile px, on 30 fps steps]. End when the radius reaches the distance from the origin point to the farthest frame corner, so the duration depends on the origin: about 11 frames from the centre and 19 from a corner [E, computed]. Add a ring whose thickness is about 23% of its radius [E]. Layouts must be identical, so this suits theme or state changes only. The earlier fixed 15 frames at 54 to 96 px/f reaches only 1125 px, which covers 1920x1080 only from the exact centre. The recheck's own circle fits of the ring were too noisy to give a corrected rate, so the rate stays [E].

#### T15. Two-beat colour hit

**Does.** A 2-frame accent wash over continuing motion, then 11 frames later a flare peaking on one near-solid frame, with content swapped under the peak [M ref F-BR].

**Build.** A full-frame layer with opacity keyed to `f`. Swap on the peak frame. Keep motion underneath running. Use on hero beats only.

#### T16. Dip to black

**Does.** Between ideas, ground and type fade to true black, hold, and the next idea fades up [M ref F-BL, seven dips]. Ref F is a 60 fps file whose `BL` tile carries 30 fps content, so durations here are seconds or 30 fps frames. True black (maximum pixel at most 12/255) lasts 4 to 5 frames, 0.12 to 0.17 s. Near-black (99.5th percentile at most 25/255) lasts 5 to 10 frames, and a peak-luma threshold of 14 gives 4 to 7. Fade-outs take 3.5 to 10 frames, about 10 typical, and fade-ups 12 to 25 [M]. The measured fade-down accelerates into black. One dip between two ideas was viewed and confirmed as a dip through black [E]. The earlier "20-frame ramps" were counted in 60 fps file frames.

**Build.** A black `Stage` overlay with opacity `o(f)`, where `f = frame - seam`:

- `f` in [-12, -2): `o = (f + 12) / 10`, a 10-frame fade-out.
- `f` in [-2, 3): `o = 1`, a 5-frame hold.
- `f` in [3, 15): `o = 1 - (f - 3) / 12`, a 12-frame fade-up.
- otherwise `o = 0`.

Durations are [M]. The linear shape and the 5-frame hold are [D]. The outgoing scene loses its last 12 legible frames and the incoming scene its first 15, and those frames do not count toward `card.min`. Allowed only at a ground change (rule 16). It is the one permitted fade between scenes.

#### T17. Tension hold, colour slam

**Does.** 26 still frames, then the hardest cut in the film, with one motif carried onto the next shot, which is already moving [M ref G].

**Build.** Freeze the outgoing scene at its last state. The incoming scene starts inside `arrive.snap`. Cue silence under the hold.

### Deferred

| Transition                                        | Why                                                                        |
| ------------------------------------------------- | -------------------------------------------------------------------------- |
| Continuous canvas push, ref B, 38 frames          | Needs dashboard and composer on one canvas, which requires real product UI |
| 3D glyph wipe with occlusion, ref F-BR, 14 frames | Needs a rendered chrome asset                                              |
| Physical-action transition, ref A                 | Needs hands and footage                                                    |

## 5. Morph catalog

### How the no-cut films actually work

They are not uncut. Ref C has 11 full-content swaps, ref E has real hard cuts on every feature card, and ref G has 6 wholesale content cuts. Detection misses them because the ground is shared. Four mechanisms make them disappear:

1. **Fixed ground, fixed centre.** Pixels barely change at a swap. Ref F-BL holds a floor at an exact level through every word: bottom-third colour is unchanged across 120 frames [M]. Ref E holds the headline at one exact y on all five cards [M].
2. **Motion bridge.** Content swaps on one frame near peak velocity, so the swap falls inside a blur of attention (T1).
3. **Object carry.** A single thing persists and changes: tile to chip, chip to summary card, card to tile, tile to avatar in ref C. Square to rhombus to cube to hexagon in ref G.
4. **Text relay.** Status lines change word by word around a fixed icon, so the narrator is the continuity (ref C), or a surviving line is rewritten in place (ref D).

The rule beneath all four: **conserve one property across every change.** Colour, position, layer order or identity. Each morph in ref G keeps at least one [M].

### True shape morphing is rare

Ref G: "no shape tweening between outlines" seen. Ref B: rare. Ref A: one bezel-to-orb. Most apparent morphs are scale, projection, masking or a state flip.

### Techniques

| #   | Technique               | Refs                             | What persists    | What changes                                                                             | Priority [D]     |
| --- | ----------------------- | -------------------------------- | ---------------- | ---------------------------------------------------------------------------------------- | ---------------- |
| M1  | Shared-element carry    | Ref C, ref D, ref E, ref G       | Identity, centre | Box, scale                                                                               | P0               |
| M2  | Container morph         | Ref C                            | One rect         | Width, then height                                                                       | P0               |
| M3  | Text as a state machine | Ref D, ref B, ref G, ref A       | Line position    | Words, gaps, tokens                                                                      | P0               |
| M4  | Word-gap elasticity     | Ref A                            | Glyph size       | Gaps only                                                                                | P0               |
| M5  | Develop from a tint     | Ref B, ref F-BL, ref F-TL, ref C | Position         | Colour or opacity, 12 to 30 frames, per word or letter (the `develop` reveal, section 7) | P1               |
| M6  | Shared data clock       | Ref B                            | Value            | Layout around it                                                                         | P1               |
| M7  | Time-reversal bookend   | Ref C, ref D                     | Motion path      | Direction                                                                                | P1, free in code |
| M8  | Occlusion multiply      | Ref A                            | Front object     | New copies emerge behind it                                                              | P1               |
| M9  | Projection morph        | Ref G                            | Colour, position | Camera angle                                                                             | P2               |
| M10 | Cell threshold          | Ref D, ref G, ref C              | Glyph shape      | Render state, dot radius                                                                 | P2               |
| M11 | Point aperture          | Ref G                            | Rim, colour      | Inner object grows from centre                                                           | P2               |
| M12 | Outline interpolation   | Ref A, logo only                 | Nothing          | Path data                                                                                | P3               |

### What the code must provide

**1. A `Stage` as the parent component.** Ground, plate and grid belong to the composition, not the scene. Otherwise every scene change is a real cut. Scenes render on transparent backgrounds. Text swaps must not cut the plate [M ref B: corner diff 2.5 to 6.7 at text swaps, 38 to 221 at real cuts].

[D] The z-order is ground at the bottom, then scenes, then transition overlays. The ground timeline is derived, not authored, because `campaign.ts` has no ground field: the registry gives each scene type a `ground` per skin (`'base' | 'plate' | 'event' | 'black'`). A ground change takes effect at the seam plus a per-transition offset: T6 at its cover frame, T7 when coverage reaches 1.0, T16 in the middle of the black hold, and otherwise at the seam. For T12, the `Stage` renders `<Ground at={seam - 1}/>` inside each clipped half, while the base ground switches at the seam.

**2. Anchors.** Each scene type declares its exit and entry contract in the scene registry:

```ts
interface Anchor {
  id: string; // 'headline', 'hero', 'logo'
  box: (frame: number) => { x: number; y: number; w: number; h: number };
  velocity?: { axis: 'x' | 'y' | 'scale'; sign: 1 | -1; v: number };
  colour?: string; // the role the anchor fills, such as 'ground'
}
```

`box()` is computed only from props, text and font measurements (item 4), never from `getBoundingClientRect`, `useLayoutEffect` or React state, so it is a pure function of the frame.

An agent picks scenes and the seam resolves itself. Agents should not write pixel coordinates. [D] In `packages/schema/src/campaign.ts`, `scene.transitionOut` is today an optional bare string. It becomes a closed catalog id (`'t1'` to `'t17'`), required on every scene but the last and checked through `sceneRegistry`. `campaign.json` carries no numbers for seams. The resolver works in this order:

1. A template-pinned id wins.
2. If the ground differs, pick from the rule-16 ground-change set.
3. If the scenes share an anchor id, the incoming scene draws that anchor for `f` in [0, 11) at `lerp(outgoing.box(outDur - 1), incoming.box(11), Easing.bezier(0.68, -0.06, 0.34, 1.06))`, and the outgoing scene stops drawing it at its last frame.
4. If both anchors declare velocity on the same axis and sign, with `vOut / vIn` in [1/1.5, 1.5], use T1 with `Seam {n: 11, r: 1.4, k: 0.72, D: 14, vPeak: Math.sqrt(vOut * vIn)}`.
5. Otherwise use T3.

An agent-set `transitionOut` is honoured only if the resolver lists it as legal for that boundary.

**3. Container and content separation (`MorphBox`).**

```ts
// Rule, from ref C: contents leave before the shape changes and fill only after it settles.
// Content exit: a 6-frame opacity fade, f in [0, 6). Allowed, because exits are not entries [D].
// Width: f in [6, 18), 12 frames. Height: f in [18, 45), 27 frames. Both Easing.bezier(0.76, 0, 0.24, 1).
// Content entry: wordRise or pop at full opacity from f 45, the frame after the height settles. No fade-in.
// Width and height frame counts are [M]. The 6-frame exit is [E].
```

Style the box with width, height and radius. Its child is absolutely positioned and never scales with the box, so text does not distort. Width and height take separate ranges.

**4. Text primitives.** Split copy into words as `inline-block` spans, and transform each one without touching layout. Use `fitTextOnNLines` and `measureText` from `@remotion/layout-utils` for box sizing. Required states: rise, pop, develop, type with caret, backspace and retype, gap tween, decode, line reflow, word-to-icon. Text content comes from `scene.text`, per the project rule.

- **Frame purity.** All measurement depends on the brand font being loaded; measured before it loads, it returns the fallback font's metrics. Load fonts with `@remotion/fonts` `loadFont` under `delayRender` before the first measurement, and call `measureText` and `fitTextOnNLines` with `validateFontIsLoaded: true`. Memoise results in a module `Map` keyed by (text, family, weight, size): a pure cache that gives the same output in any order, since Remotion renders frames in parallel tabs and in any order [D].
- **Typing.** `chars(f) = Math.min(n, Math.floor(f * 18 / 40))` [M ref D: about 2 to 3 frames per character in uneven steps, 18 characters in 40 frames]. For n > 18, use ref D's accelerating table, 1, 2, 5, 9, 15, 26, 45, 49 characters at 6-frame intervals, interpolated linearly and scaled to n [D]. Backspace is the same function in reverse, at the same speed [M].
- **Caret.** 0.075 em wide and 0.78 em tall (114/146), in the accent colour, always visible, no blink [M ref D: 10 to 12 x 114 px at 1080].
- **Accent phrase.** Mark it with `scene.props.accent = {textId, from, to}`, word indices with an exclusive end, because `textItem` (`{id, role, value, claimIds}`) has no way to mark it. Indices are not copy, so props may hold them. At most one per text item, checked through the registry [D].

**5. Decode.** Measured ref G: start shifted +3 code points, resolve one character per frame right to left, lines 2 frames apart [M]. Do not run digits through it. See section 6 on numbers. [D] Shift only `[a-z]` and `[A-Z]`, wrapping within the case (x becomes a). Spaces, digits and punctuation show their final glyph from frame 0, because a +3 shift turns `.` into `1`, `-` into `0`, `/` into `2` and a space into `#`, which would flash digits that appear in no cited quote during a URL decode. The character at index i of line L resolves at frame `2L + (len - 1 - i)`. Every frame shows either the shifted glyph or the final one, never a random glyph.

**6. Shape interpolation.** `interpolatePath(value, firstPath, secondPath)` from `@remotion/paths` is enough for the rare logo morph. It needs comparable paths, and nothing else in this spec depends on it.

**7. Projection.** CSS 3D with no perspective gives flat, orthographic blocks: three solid tones per object, no lighting. Ref G's rail axis measures 24 degrees, which corresponds to `rotateX(63.6deg) rotateZ(45deg)` [F]. A true isometric view would be `rotateX(54.7deg)`. A camera move from face-on to iso is an interpolation of those two angles on `camera.skew`, and it needs no shape keys, because projection does the morph. Flat three-tone is the default, not a rule: ref G's hero cube carries a blurred photographic texture on its faces, which grows from a dot at the hex centre, while the other objects stay flat [E, viewed at 27.5 s and 60.3 s and f734 to f756]. Allow one hero object per film with an image or texture fill on its faces, clipped per face and revealed by the point-aperture grow (M11) [D]. It could use a tier 5 generated texture once Naive is wired in. For captured pages on tilted planes, use `camera.depth` (section 3), which does use perspective.

**8. Cell renderer.** SVG `<pattern>` circles used as a mask, with radius driven by frame. Radius grows until dots merge into a solid: the lattice-to-window move from ref D. For a threshold effect on type, render the type to a canvas and sample it on a fixed grid. Memoise the sampled grid in a module `Map` keyed by text, font and size, as in item 4, so it is a pure cache rather than state carried across frames.

**9. Shared clock.** Counters read an absolute frame, not a scene frame, so a value keeps counting through a cut [M ref B]. This is simple in code, and a strong continuity signal.

**10. Scenes valid outside their bounds.** See the mounting rule under Overlays in section 4. Required by every overlay.

## 6. Product UI treatment

### What the films actually did

| Film     | Treatment                                                                                          |
| -------- | -------------------------------------------------------------------------------------------------- |
| Ref A    | Rendered hardware with full-detail screens, by estimate. Real hands                                |
| Ref B    | Rebuilt as animated layers with a full fictional business and seeded data, by inference            |
| Ref C    | 83% abstract, greeked rebuild. Real screenshots for 5.5 s only. A tiled table shows a visible seam |
| Ref D    | Looks like the real product with seeded data. Capture or rebuild cannot be told apart              |
| Ref E    | Fully rebuilt, greeked mock site, no screenshots                                                   |
| Ref F-TL | Simplified vector rebuild                                                                          |
| Ref F-TR | Dense real-looking UI on tilted panels                                                             |
| Ref F-BL | Dark UI on a tilted plane, one lit element                                                         |
| Ref F-BR | No product UI                                                                                      |
| Ref G    | All rebuilt components, floating, no app chrome                                                    |

The founder's favourites are mostly not screen recordings. That is good news. The bad news is that **each rebuild was made by people with product access, design files and permission to invent data.** Boiler Room has none of these.

### The honest constraint

Boiler Room starts from a public website. It has no login, no in-app UI, no design files, no seeded account. Two project rules tighten this further:

- Never invent a claim, and every number on screen must appear in a cited quote. That rules out ref B's fictional dashboard and ref C's persona with made-up percentages.
- Numbers render only from `scene.text`. Decorative chart values, table cells and fake counters are out.

So **we cannot show the product working unless the customer has already published that on their site.** Ref B's 12-second chat demo, ref D's app building itself and ref C's real dashboard are not available to us. Any scene that looks like an in-app screen but was built by us would be a fabricated screenshot. That is the largest gap in this document.

### Asset ladder

Use the highest tier available [D].

| Tier | Source                                                                               | Treatment                                                                          | Honest status                                                                  |
| ---- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| 1    | Product screenshots, images or demo video already on the site                        | Crop to one idea. Frame, tilt with `camera.depth`, push                            | Real                                                                           |
| 2    | Docs, changelog, code samples, pricing, integrations pages                           | `site-hero`, `site-scroll`, cropped proof                                          | Real, and often overlooked. Developer tools are strong here                    |
| 3    | The marketing site itself                                                            | Real pages in a browser frame, on tilted planes with `camera.depth`, in tile walls | Real, but it shows the site rather than the product                            |
| 4    | Abstract components from verified claims: chips, status lines, rails, greeked panels | `status-relay`, `feature-card`, `rail-words`                                       | Illustrative. Must be abstract enough that nobody mistakes it for a screenshot |
| 5    | Generated assets from Naive                                                          | Backgrounds, texture, illustrative objects only                                    | Illustrative. Not wired in yet                                                 |

**Never:** invent a dashboard, fake data rows, a fake customer name, a fake testimonial, or a logo wall of companies not on the customer's own site.

### Rules [D]

1. **Crop, do not redraw.** Ref B, ref D and ref A manage detail by framing. Show one idea per shot. Full-window shots are unreadable at normal size [M ref D].
2. **Greek by default in tier 4.** Grey bars for text, as ref C and ref E do. No numerals.
3. **Capture for zoom.** Take element screenshots at device scale 2 or higher, with DOM boxes, so scenes can target a real button or heading. One soft full-page bitmap will not survive a push-in.
4. **Layer the real site.** DOM boxes let a hero headline, button and image animate as separate layers. This is the closest honest equivalent of a rebuild, because the content is real and only the motion is ours. It is untested on arbitrary sites.
5. **Keep it alive.** Static screenshots die quickly. Every product layer carries continuous motion: a push of at least +0.13%/f scale, a scroll, a `rotateY` drift, or a single highlight sweep (`light.sweep`). Mid-film product shots have zero frames under the 0.02 MAD hold threshold [M ref A, see Drift in section 3]. No camera lock longer than 4 s [M ref B's 12.4 s lock is its flagged weakness]. Rule 13's 30-frame static limit applies on top of this.
6. **Customer gate.** Tier 4 scenes must be visible at the script approval step, so a customer can reject an illustration of their own product.
7. **Keyboard and cursor.** A cursor implies a real interaction. Use it only on real captured pages, and never to imply an in-app flow [D]. Boiler Room has no equivalent of ref A's hands.

### Numbers in animation: a decision for the founder

Count-ups and reels show intermediate numbers that appear in no quote, for a few frames. The final value matches the claim, and the rule's plain reading could still forbid them. Recommended position: allow a count-up only when it starts from zero and ends exactly on a cited value, with the final value held for at least 30 frames. Never scramble through other plausible digits.

## 7. Typography, colour and surface

### Type rules

| Rule                 | Value                                                                                                                                                                                                                                                                                                                                                                                                      | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Families             | One display family. Add one mono for labels only                                                                                                                                                                                                                                                                                                                                                           | [M] ref A, ref B, ref D, ref G                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Default style        | Neo-grotesque, medium to semibold, sentence case, tight tracking                                                                                                                                                                                                                                                                                                                                           | [E] Most films                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Words per card       | Target 2 to 6, maximum 8                                                                                                                                                                                                                                                                                                                                                                                   | [M]                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Lines                | Maximum 2                                                                                                                                                                                                                                                                                                                                                                                                  | [M]                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Line length          | Maximum 65% of frame width for static sentence cards: `fitTextOnNLines({maxLines: 2, maxBoxWidth: 0.65 * W})`. `word-slam` and `rail-words` may use the bleed variant (T4): glyphs exceed the frame while moving, but every word sits wholly inside the safe area for at least about 10 frames                                                                                                             | [M] ref A. Bleed: [E, viewed] ref G 34.9 to 41.3 s, ref F-BR open. The 10 frames are [D, E]                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Sentence size        | Specified as cap height, not font size: sentence cap at least 78 px at 1080p (7.2% of frame height). `fontSize = capPx * unitsPerEm / sCapHeight`, read from the loaded font's OS/2 table, or from canvas-measured "H" ink once per font                                                                                                                                                                   | [M] ref A 2.5 s frame: cap height 78 px, x-height 58 to 59 px, ascender-to-descender ink 99 px, line width 1177 px (61% of W). Ref D dossier: 102 px cap at 1080, estimated font size 146 px, line height 0.96. The earlier 105 to 110 px (ref A) and 110 px (ref B) are font sizes that hold only for faces with caps of about 0.71 to 0.74 em: a brand font with 0.66 em caps at 105 px gives 69 px caps, 12% smaller                                                                                               |
| Display size         | Display cap = 2.7 x sentence cap, about 211 px at 1080p. `fontSize = Math.min(capDerivedSize, fitText({withinWidth: 0.8 * W}).fontSize)` [D 0.8]. If the result is below 0.13 x W, the copy cannot be a slam, and the validator asks for a shorter word or a `type-card`. As font size, 13 to 16% of frame width is 250 to 307 px at 1920                                                                  | [M] ref B. [E] A single long word at 16% of W can overflow the frame                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Size ratio           | Display to sentence about 2.7 to 1                                                                                                                                                                                                                                                                                                                                                                         | [M] ref B                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Line height          | About 0.96 to 1.2                                                                                                                                                                                                                                                                                                                                                                                          | [M] ref D, ref A                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Reveal               | Two modes. `pop`: full opacity on frame 1, the default for headlines on Neutral Cut and Kinetic Plate. `develop`: an opacity or tint ramp travelling left to right per word or per letter, with a leading edge about 2 to 4 words wide [E]. Use `develop` for status lines, secondary lines, Continuous Diagram and the ref F-BL tint-to-ink headline. A uniform whole-line crossfade is never allowed [D] | [M] `pop`: ref A, ref D. [E, viewed] `develop`, in at least 4 of the 10 films: ref C the tagline under the wordmark fades up (f374 to f394), a status sentence darkens left to right (f478 to f490), and list labels rise from low opacity (f413 to f421); ref F-TL a status line ramps from pale to ink word by word (frames 686 to 700); ref F-BL a headline's trailing words sit in a dim tint and turn white in sequence (frames 468 to 576); ref F-BR the letters of a two-word line ramp in (frames 289 to 333) |
| Motion blur          | Velocity-gated blur on type for word-slam entry, collapse and whip exits: only on frames above a speed threshold, never on a held word. Peak radius roughly 5 to 10% of cap height [E], along the motion axis, or zoom blur for scale. Build it as a per-layer filter or SVG blur driven by per-frame velocity, not `CameraMotionBlur`. None on Neutral Cut rises                                          | [M] none in ref A, at 46 px/f. [E, viewed] ref B's first display word is blurred on frames 0 to 1, sharp on 2 to 9, and blurred again on 10 to 13 while it scales down. Ref F-BR's title falls in from huge scale heavily blurred, and a display word at frame 344 carries a horizontal streak. Ref A's "none" holds for ref A only                                                                                                                                                                                   |
| Glyph scale on entry | None for rises and rails. Scale is for slams only                                                                                                                                                                                                                                                                                                                                                          | [M] ref A                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Hierarchy            | Colour or size, not a second weight                                                                                                                                                                                                                                                                                                                                                                        | [M] ref E                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

The validator's `headline: 60` limit is too loose. Each scene type should set `SceneLimits` of about 40 characters for a headline, which is close to 8 words [D].

### Colour rules

| Rule           | Value                                                                                                                                                                                                                                                                                                                                                                                                                                          | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Grounds        | 1 per section. Flat on Neutral Cut (optionally `ground.bloom`), one soft gradient plate on Kinetic Plate, full-bleed colour fields on Cell World                                                                                                                                                                                                                                                                                               | [M]                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Accent         | Default, Neutral Cut and Kinetic Plate: one per section, on at most one phrase per text item (`scene.props.accent`). Categorical mode, for Cell World and multi-concept explainers [D]: up to 3 extra hues, each bound to one named concept for the whole film and introduced the first time with a mono label and a swatch. A hue is never reused for a different concept. Derive the hues in OKLCH at matched lightness from `brand.primary` | [M] one accent: ref E only. [M] ref G binds three hues to three concepts, each introduced with a mono label and a swatch square, and the mapping holds from 22 s to 60 s, with a fourth hue for the product (frames checked at 22.3, 27.5, 50.2 and 60.3 s). Ref B's accent is a gradient whose hue shifts across a word                                                                                                                                              |
| Colour event   | Neutral Cut: one full-bleed shot of at most 2.3 s, past 60% of runtime. Cell World: full-bleed colour fields are section grounds, allowed from the first 3 s, each about 1 to 4 s, up to about 20% of runtime. Kinetic Plate: the plate carries saturation throughout, and the type stays neutral                                                                                                                                              | [M] Neutral Cut: ref A, ref C, ref F-TL. Mean frame saturation never exceeds 17 in ref A, ref C or ref E (medians 2.4, 1.4 and 1.8); ref F-TL was not measured. Cell World: ref G above saturation 30 on 17.9% of frames, in four full-bleed stretches, 2.7 to 6.0, 12.4 to 16.6, 50.8 to 54.2 and 56.5 to 57.2 s, the first at 4% of runtime. Kinetic Plate: ref B above 20 on 15.4% of frames from 0.6 s, and ref F-BR's first full colour wash at about 2.75 s [E] |
| Shadows        | Soft contact only, or none. Light the one active element instead, with the tokens below                                                                                                                                                                                                                                                                                                                                                        | [M]                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `light.rim`    | A 1 to 2 px accent gradient stroke plus an outer glow of about 24 to 40 px at 40 to 60% alpha, on exactly one element per shot                                                                                                                                                                                                                                                                                                                 | [E, viewed] ref B confirmed chat row with a gradient-lit outline, and the lifted results card with a gradient stroke. Ref F-BL a saturated rim on the panel edge, and a glowing pill on the active control. Values are estimates                                                                                                                                                                                                                                      |
| `light.sweep`  | One gradient highlight crossing an element as it becomes active, about 10 to 20 frames                                                                                                                                                                                                                                                                                                                                                         | [E, viewed] ref B a two-hue glow sweeping across a button as it becomes active (f470 to f570). The duration is an estimate, because the strips are sampled every 20 frames                                                                                                                                                                                                                                                                                            |
| `ground.bloom` | Neutral Cut variant: a low-alpha accent radial gradient under the active card                                                                                                                                                                                                                                                                                                                                                                  | [E, viewed] ref F-TL is not flat: a soft tinted bloom under the content card, at 00:09 and 00:12 to 00:15                                                                                                                                                                                                                                                                                                                                                             |
| Light budget   | `light.rim`, `light.sweep` and `ground.bloom` all spend the one accent (or the section's keyed hue) and must not add a second colour                                                                                                                                                                                                                                                                                                           | [D]                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Grain          | None on flat grounds                                                                                                                                                                                                                                                                                                                                                                                                                           | [M] ref A, ref D                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

### Surviving any customer's brand

`campaign.brand` gives background, foreground, primary, optional accent and muted, two fonts, a logo and a radius. The derivation below is a design proposal, not tested on real brands [D].

| Token          | Derivation                                                                                                                                                                                                                                                                                                                                    | Failure case                                                                                                                                                             |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ground`       | Neutral Cut: `brand.background` if light, meaning OKLCH L >= 0.90. Kinetic Plate: `brand.background` if dark, meaning L <= 0.22 [D]                                                                                                                                                                                                           | A mid-tone brand ground fails contrast. Use `color-mix(in oklch, primary 3%, white)` for Neutral Cut or `color-mix(in oklch, primary 3%, #0b0b0b)` for Kinetic Plate [D] |
| `ink`          | `brand.foreground`                                                                                                                                                                                                                                                                                                                            | The validator's 4.5:1 applies. Use `readableOn`                                                                                                                          |
| `accent`       | `brand.primary`                                                                                                                                                                                                                                                                                                                               | Below 3:1 fails. Use it for fills only, with `ink` for text on it                                                                                                        |
| `plate`        | [D, unmeasured: nothing in the films measures plate motion] `radial-gradient(in oklch, ...)` with three stops: L 0.12, then `primary` with L clamped to at most 0.45, then `accent` (or `primary` at L 0.30). Centre at 50% + 12% x `noise2D('plate', absFrame / 120, axis)`, driven by the absolute frame so the plate does not cut at seams | Two clashing hues. Drop `accent`, and ramp `primary` lightness only                                                                                                      |
| `event`        | Full-bleed `primary`                                                                                                                                                                                                                                                                                                                          | A very dark or pale primary reads as nothing. Use a generated field from the plate ramp                                                                                  |
| `logo`         | Vector asset                                                                                                                                                                                                                                                                                                                                  | Raster logo: never scale above natural size. Ref B shows stair-steps at large scale                                                                                      |
| `radius`       | `brand.radius`, else 16 px at 1920                                                                                                                                                                                                                                                                                                            | Square brands stay square                                                                                                                                                |
| `display font` | Captured font                                                                                                                                                                                                                                                                                                                                 | Licence unknown, or capture fails. Fall back to a neo-grotesque                                                                                                          |

**What survives.** Structure, timing, curves, type sizes and accent rationing are brand-free, which is why near-neutral grounds work so well across ref A, ref C, ref E and ref F-TL. Only the ground, one accent and the logo change.

**What does not survive.** Pixel fonts like ref E, custom wordmarks, and display-size type in a poorly drawn web font. A brand's 12-colour gradient cannot be reduced to one accent without a human choice.

**Formats.** Every reference is 16:9. Ref C's file wraps a 16:9 stage. There is **no evidence at all** for 9:16 or 1:1, though the schema allows both. Treat those as unvalidated. Tile walls, rails and door splits all need separate layouts.

## 8. Audio rules

### Do the references use narration?

**Most do not, but two do. Correction 1 confirms the heuristic's flag on ref D and ref G and quantifies it.**

| Film  | Voice                                   | Words      | Words per minute, whole film | Voiced share | Music                            |
| ----- | --------------------------------------- | ---------- | ---------------------------- | ------------ | -------------------------------- |
| Ref A | None. Vocal sample inside the music [E] | 0 narrated | 0                            | 0            | 125 BPM [E], 87% under 250 Hz    |
| Ref B | None                                    | 0          | 0                            | 0            | 137 BPM [E], 86%                 |
| Ref C | None                                    | 0          | 0                            | 0            | 98.7 BPM [E], 81%                |
| Ref D | **Sparse narration, spoken headlines**  | 65         | 57                           | 46%          | 130.8 BPM [E], 78%               |
| Ref E | None                                    | 0          | 0                            | 0            | 108 BPM [E], 83%                 |
| Ref F | Unknown, no audio stream                | n/a        | n/a                          | n/a          | n/a                              |
| Ref G | **Full narration**                      | 153        | 135                          | 73%          | 119.7 BPM [E], music under voice |

So: **4 of 6 films with audio have no narration, 2 do.** Word counts come from tiny.en and are approximate by a few percent. Voiced share uses gaps over 0.25 s. [M recheck, offline] ref G: 152 words, first word at 2.50 s, 149 wpm over 2.50 to 63.58 s, 134 wpm over the whole film, voiced share 0.72. Ref D: 65 words and voiced share 0.43 with VAD off; with VAD the count drops to 42, so the ref D count needs VAD off.

**ElevenLabs plan.** Narration is optional for the bar, so the plan should not assume it. The 3,531 credit reserve stays where the system map puts it, on reference and demo films.

| Standard 45 s film    | Words | Characters | Takes from 3,531 credits |
| --------------------- | ----- | ---------- | ------------------------ |
| Sparse, ref D density | 43    | 235        | About 15                 |
| Full, ref G density   | 101   | 570        | About 6                  |

Takes assume 1 credit per character, which needs checking against the current plan [E]. Recommendation [D]:

- **Customer films:** music-led, no voice, unless the customer pays for it. Every film must read with the sound off.
- **Demo film:** sparse narration. It speaks only headline lines, so it costs less, and revisions regenerate single lines.

### Voice rules, if used

| Rule              | Value                                                                                                                               | Evidence                                                                                                                                                                                                                                                                                                                                                    |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Line starts       | Narrated headlines (ref D style) land on the cut, at the same time. Continuous narration (ref G style) is not tied to hard cuts     | [M] Offline tiny.en word starts, no VAD, phrases split at gaps over 0.25 s. Ref D: 11 of 17 phrases start within 0.5 s of a hard cut, against 6.5 by chance, median offset -0.01 s. Ref G: 5 of 16 within 0.5 s of one of 27 hard cuts, against 4.4 by chance, so no better than chance. Against all 92 motion peaks it is 14 of 16, against 10.9 by chance |
| Who leads         | Where a phrase and a cut coincide, picture first by about 0.2 s, or 0.4 s after the hardest cut. A loose guide, not a measured lock | [M] ref G, the 5 coinciding phrases: median +0.19 s (n = 5, not robust), +0.17 s against motion peaks. One phrase starts +0.41 s after the colour-slam cut at 12.37 s                                                                                                                                                                                       |
| On-screen words   | Fewer than the spoken words, and the same phrases                                                                                   | [M] ref D, ref G                                                                                                                                                                                                                                                                                                                                            |
| Pace              | About 150 wpm across a full VO stretch                                                                                              | [M] ref G over its 61 s span                                                                                                                                                                                                                                                                                                                                |
| Music under voice | Far lower-weighted. Only 30% of ref G energy is under 250 Hz                                                                        | [M]                                                                                                                                                                                                                                                                                                                                                         |

Voice text is covered by the claims rule, so the validator's existing check holds.

### Music rules

| Rule             | Value                                                                                                                                                            | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tempo            | 100 to 137 BPM, default about 120                                                                                                                                | [E] Tracker values                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Weight           | Bass heavy, about 80% of energy under 250 Hz with no voice                                                                                                       | [M]                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Loudness         | -14 LUFS integrated. Remotion does not normalise loudness, so apply a post-render two-pass `ffmpeg loudnorm=I=-14:TP=-1`, outside the frame-pure core [D]        | [M] Reference median -14.3, range -19.4 to -9.5 (ebur128: ref A -15.8, ref B -12.8, ref C -16.7, ref D -9.5, ref E -12.7, ref G -19.4)                                                                                                                                                                                                                                                                                                             |
| True peak        | -1 dBTP or lower                                                                                                                                                 | [M] ref C +2.0 and ref D +0.5 risk clipping. The others are at -1.3 dBTP or below                                                                                                                                                                                                                                                                                                                                                                  |
| Open             | Quiet for 3 s or until the first surface. Quiet means short-term loudness at or below -24 LUFS over 0 to 3 s, checked with `ffmpeg ebur128` on the final mix [D] | [M] ref A, ref B, ref C, ref G. The openings measure -32 to -21 LUFS (ref B) and -47 to -36 (ref G)                                                                                                                                                                                                                                                                                                                                                |
| Full track       | Lands on the first product surface                                                                                                                               | [M] ref A 3.8 s, ref B about 8 s                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Drop             | Remove bass under one key statement, return it on the next product shot                                                                                          | [M] ref A twice, returning 2 frames after the cut                                                                                                                                                                                                                                                                                                                                                                                                  |
| Gap before a hit | 0.25 to 0.35 s, with a dip of at least 12 dB                                                                                                                     | [M] 20 ms RMS windows. Ref D 4.46 to 4.80 s, falling from about -40 to between -55 and -66 dBFS, then recovering. Ref E 3.10 to 3.36 s, a dip of about 12 to 15 dB (about -21 to between -32 and -38 dBFS) rather than silence, with the hit at 3.38 s                                                                                                                                                                                             |
| End              | Fade the music over the end card, finishing between the last frame and 2 s before it                                                                             | [M] Last 0.25 s RMS window above -50 dBFS, mono 22.05 kHz. Only ref A clearly ends its music before the picture: it drops at 56.5 to 56.75 s and ends 2.0 to 2.2 s before the last frame. Ref B ends 0.8 s early (50.0 s). Ref E fades across the end card and is still -41 dBFS in the final 0.25 s. Ref G drops at 63.5 s, but a quiet bed at -41 to -60 dBFS runs to about 67.75 s, 0.4 s before the end. Ref C and ref D run to the last frame |

### Sound effects

Sparing and selective. Ref B has no whoosh or impact layer [M]. Ref D has high-band accents on 3 special moves, and none on most cuts [M]. Ref C has selective transient hits and a tonal layer behind its counter [M/E]. Ref E's impacts could not be separated from the music [M]. Default: at most 6 accents in a Standard film [D]. No per-cut whoosh, no typing clicks.

### How tightly picture follows sound

| Film  | Cuts against beat                                                                                                                | Tight moments                                                |
| ----- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Ref A | Below chance: 2 of 22 hard cuts within ±50 ms of a beat, against 4.6 by chance                                                   | Bass gating, lock click within one frame of an onset         |
| Ref B | At chance: 5 of 22, against 4.9                                                                                                  | 2 section hits                                               |
| Ref C | 17 of 28 chosen events, against 11.2 by chance, p about 0.03 [U: the recheck's detector found only 3 hard cuts, too few to test] | Selective hits                                               |
| Ref D | Below chance: 3 of 40, against 8.5                                                                                               | Silence inside the inhale                                    |
| Ref E | 1.39x chance, p 0.0075 [U: the recheck's detector found only 5 hard cuts, too few to test]                                       | Slam and three hits within one frame, then the middle drifts |
| Ref G | At chance: 8 of 27, against 7.2                                                                                                  | Picture follows the voice instead                            |

[M] Recheck method: a hard-cut detector (cut time = first frame of the new shot), a local librosa beat grid, and chance from 5000 random shifts of the whole cut list. The counts differ from the first draft's, because ±50 ms is only ±1.5 frames and the counts depend on the cut convention. The at-chance verdict does not. Express any sync figure finer than about 17 ms as "within one frame": the earlier 6 ms and 10 ms figures are finer than one frame (33 ms) and can only be bounded from these files.

**The rule:** lock 3 to 6 hero moments to the track and leave all other cuts on their own clock. Do not snap every cut to a beat. Nothing in the references does this.

**Implementation.** `campaign.audio.sfx` holds hits. A music track needs a cue sheet of bar and section times, so a scene's hero frame can move to the nearest cue within about 6 frames [D]. Snap by moving only the boundary before the hero scene, by `delta` with `|delta| <= 6`: the predecessor gains `delta` and the hero scene loses `delta`, both still meeting `card.min`, with the template total unchanged. A bass gate does not need stems, and it runs inside Remotion: two `<Audio>` layers of the same track, the full mix and a copy pre-rendered with `ffmpeg -af highpass=f=250`, given complementary frame-pure `volume` callbacks across the gate frames [D]. This is untested. Loudness normalisation is a post-render step (see Music rules).

## 9. Scene library priority

In build order. Effort is a rough estimate [E]: S under half a day, M about a day, L more. Scene ids are proposals, for the `sceneRegistry`.

Before any scene: `curves.ts`, `Stage`, seam wrapper, `wordRise`, `MorphBox`, the anchor contract. These are the library. Scenes on top of them are cheap [D].

| #   | Scene          | Job                                                                                                            | Refs                                     | Asset tier         | Effort |
| --- | -------------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | ------------------ | ------ |
| 1   | `type-card`    | 1 to 2 lines. Pop-and-rise, line-2 push, drift, exit ramp. Name and pivot variants                             | Ref A, ref D, ref E, ref F-TL            | None               | S      |
| 2   | `end-card`     | Lockup, CTA, URL decode (letters only, section 5) or type-on, hold                                             | Ref A, ref B, ref C, ref D, ref E, ref G | Logo               | S      |
| 3   | `logo-reveal`  | Mark resolves from mask, blur or tiles. Reversible. Declares `markLegibleAt` (rule 2)                          | Ref C, ref D, ref G, ref B               | Logo               | S      |
| 4   | `word-slam`    | Display word, collapse into sentence, in one 90-frame scene. Bleed variant allowed                             | Ref B, ref F-BL, ref F-BR, ref F-TR      | None               | M      |
| 5   | `site-hero`    | Real page in a frame or on a tilted plane with `camera.depth`, with a slow push                                | Ref F-TR, ref F-BL, ref B                | 1 to 3             | M      |
| 6   | `feature-card` | Fixed headline slot plus one causal micro-demo, on a 72-frame clock                                            | Ref E, ref A                             | 1 to 4             | M      |
| 7   | `proof-bars`   | Hero claim, lift to slot, data-true bars, verdict stack                                                        | Ref E                                    | Needs cited values | M      |
| 8   | `stat-counter` | One large number, with a label and shared clock                                                                | Ref F-BR, ref B, ref E                   | Needs cited value  | S      |
| 9   | `site-scroll`  | Fling and whip through real pages, ending on a CTA                                                             | Ref C, ref B, ref F-TL                   | 2 to 3             | M      |
| 10  | `tile-wall`    | Three rows of captured tiles, opposed directions, long decay                                                   | Ref A, ref F-TL, ref G                   | 1 to 3             | M      |
| 11  | `status-relay` | Icon, one status line, word relay, rails into the actor                                                        | Ref C, ref D                             | Tier 4             | L      |
| 12  | `rail-words`   | Oversized words on two rails, with UI through the centre. Bleed variant allowed                                | Ref G                                    | Tier 4             | M      |
| 13  | `colour-event` | One full-bleed moment with a frosted or simple card                                                            | Ref C, ref A, ref F-TL                   | Brand              | S      |
| 14  | `cell-type`    | Dot-matrix type, cell threshold, lattice into panel                                                            | Ref D, ref G                             | None               | L      |
| 15  | `iso-chain`    | Square to rhombus to cube to opened hex, three-tone flat. One hero object may carry a face texture (section 5) | Ref G                                    | None               | L      |

**Minimum viable film.** Scenes 1 to 6 plus 13 can already make a Short film. Scene 7 or 8 must follow, or the film has no proof.

**Deliberately excluded.**

| Scene                      | Why                                                                                                                                                                                                                                                              |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Versus arena, ref E        | It relies on naming a rival. It carries superlative, rival-logo and legal risk. The verdict stack inside `proof-bars` is safe only with cited comparisons, and the validator's `CLAIM_SUPERLATIVE` rule must still pass. T12 stays available for two-sided ideas |
| Chat demo, ref B           | Needs real product interaction                                                                                                                                                                                                                                   |
| Hardware flythrough, ref A | Needs CG assets                                                                                                                                                                                                                                                  |
| Mascot pull-back, ref F-TL | Needs a CG character                                                                                                                                                                                                                                             |

## 10. Director rules

Rules an agent can follow. Most have a check Quality Check or the validator can run. All are [D], grounded in the evidence above.

### Story

1. Default to the Standard template. Use Short when under 3 usable claims. Use Long only with 5 or more claims and 3 or more surfaces.
2. Show the mark by 3.5 s and a product surface by 7 s. "Show" means legible: the registry field `markLegibleAt` is the local frame where the logo is at full scale, unmasked and unblurred, and the check is `logoReveal.from + markLegibleAt <= 105`. The templates start the reveal at frame 90, so any resolve of 15 frames or fewer passes.
3. Land the first strong hit by 3.5 s.
4. Build frame 0 with content. Never open on a blank frame or a poster that then disappears.
5. Structure the middle as claim then proof, repeated with one template. Then one pivot, then breadth.
6. Give every feature card one causal demo, in which one thing visibly produces the next.
7. End with a callback to the hook, then name, then CTA.

### Rhythm

8. Median beat 1.7 to 2.4 s. No beat under 0.5 s. No beat over 4 s except the end card, or a set piece flagged as such.
9. Alternate type and proof. Each scene type has a registry `kind`: type = `word-slam`, `type-card` (all variants), `colour-event`; proof = `proof-bars`, `stat-counter`; product = `site-hero`, `site-scroll`, `feature-card`, `tile-wall`, `status-relay`, `rail-words`; mark = `logo-reveal`, `end-card`; setpiece = `iso-chain`, `cell-type`. A run of one scene type sharing the fixed headline slot counts as one unit, up to 5 scenes. No 3 consecutive units of the same kind, and a mark resets the count. As mapped, the closing `colour-event`, callback and name rows are three type units in a row in all three templates, so this rule is not yet enforceable: see "Open decisions for the founder".
10. Use dead-stop cuts (T3) on about a third of the seams, so that matched seams feel like events: `count(T3)` is in [floor(s/3), ceil(s/3)], where s is the seam count.
11. Use one long breath per film. The breath is the pivot `type-card` (Standard row 9, Long rows 6 and 18; Short has none). It enters through a template-pinned T5 chapter blink of 5 blank frames [M ref E], which is itself a dead stop, with at most 4 words. The earlier "2.5 times the median" is deleted: every template median times 2.5 (180, 169 and 139 frames) breaks rule 8's 120-frame cap [D].
12. Give copy its `card.min` time. Compute it from the word count. It applies to every `type-card`; `word-slam` and `colour-event` are exempt.
13. Nothing static over 1 s mid-film, except one `hold.tension`. A frame is static when its MAD from the previous frame is below 0.02 on 320x180 area-scaled RGB (the dossier analysis tool's definition). Quality Check fails on more than 30 consecutive static frames anywhere except the end card and one `hold.tension` of up to 26 frames. This threshold separates drift from stillness: ref A's drifting type hold (frames 60 to 80, 0.12%/f) reads MAD 0.167 to 0.192 [M]. Product layers get zero held frames mid-film [M ref A], and a product-only shot gets a push of at least +0.13%/f scale [D]. The draft line "a product shot beside drifting type may hold still [M ref A]" is dropped, because ref A's product never holds still (Drift, section 3).

### Seams

14. Every scene but the last carries a `transitionOut` catalog id (`'t1'` to `'t17'`), set by the resolver in section 5. An agent-set id is honoured only if the resolver lists it as legal for that boundary. Never default to a fade.
15. On a matched seam, keep the same axis and anchor, and keep speed within 1.5x across the cut, measured from the two anchors.
16. Same ground on both sides: use T1, T3, T4 or T5. Ground change: use T6, T7, T16 or T3.
17. T1 and T3 are exempt everywhere, and T5 is exempt between consecutive scenes of one card group (same scene type, shared headline slot). Every other use of a transition is limited to 3 per film and never adjacent to the same transition.
18. Limit showpiece transitions (T6, T7, T12, T13, T14, T15) to 3 in a Standard film. Scarcity makes them land.
19. Start each incoming scene with something already in motion. T5's blank frames (2, or 5 for a chapter) are exempt.

### Type and colour

20. 8 words maximum per card, 2 lines maximum, at most one accent phrase per text item (`scene.props.accent`).
21. Type enters in one of two reveal modes (section 7): `pop`, full opacity on its first frame, or `develop`, a left-to-right tint or opacity ramp per word or letter. A uniform whole-line crossfade is never allowed [D]. Blur only on slams, collapses, whips and racks, and only while the word is moving fast. Scale only on slams.
22. Keep one family, plus mono for labels.
23. Hold the fixed headline slot across a group of cards.
24. Neutral Cut: use one accent per section, and spend the single colour event past 60% of runtime. Cell World may use the categorical mode (up to 3 extra keyed hues) and colour-field grounds from the first 3 s. Kinetic Plate keeps saturation in the plate.

### Product

25. Take assets from the highest available tier in section 6.
26. One idea per shot. Crop until that is true.
27. Rebuilt panels are greeked. Every numeral comes from `scene.text` with a cited claim.

### Audio

28. Assume no narration. The film must read with the sound off.
29. Lock 3 to 6 hero moments to the track. Leave the rest.
30. Withhold full bass until the first product surface.
31. Mix to -14 LUFS, -1 dBTP, with a post-render loudnorm pass. Fade the music over the end card, finishing between the last frame and 2 s before it.

### Checks for Quality Check

| Check                 | Method                                                                                                                                                                                                                              |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Blank frame 0         | Pixel variance of frame 0                                                                                                                                                                                                           |
| Static stretches      | Per-frame MAD below 0.02 on 320x180 area-scaled RGB is static. Fail on more than 30 consecutive static frames, except the end card and one `hold.tension` of up to 26 frames. Product layers: zero static frames mid-film (rule 13) |
| Seam speed ratio      | From anchors, not pixels                                                                                                                                                                                                            |
| Edit count            | The spikes found by the dossier analysis tool's spike detector (`SPIKE_MIN_EXCESS` 2.0, `SPIKE_K` 4.0), run on the render. Scene score at 0.15 is not enough on light grounds                                                       |
| Card time             | For each `type-card`, `durationInFrames >= max(43, ceil(6.5 × words))`                                                                                                                                                              |
| Mark deadline         | `logoReveal.from + markLegibleAt <= 105`                                                                                                                                                                                            |
| Opening loudness      | `ffmpeg ebur128` on the final mix: short-term at or below -24 LUFS over 0 to 3 s                                                                                                                                                    |
| Phone legibility      | Downscale to 360 px wide, then OCR or eyeball                                                                                                                                                                                       |
| Text inside the frame | Text boxes against safe area. Layers declared bleed are exempt on their entry and exit frames only                                                                                                                                  |

### Never

- Cross-dissolve between scenes, or use `fade` or `slide` as a default.
- Overshoot, bounce or spring on type.
- A uniform whole-line crossfade on type.
- Motion blur on a held word, or on Neutral Cut rises. Velocity-gated blur on slams, collapses and whips is allowed (section 7).
- A whoosh on every cut.
- Beat-lock every cut.
- An unkeyed or reassigned second colour.
- An invented number, customer, logo, testimonial or UI state.
- A fake in-app screen.
- A rival's logo or third-party logos not on the customer's own site.
- A superlative without a cited quote. The validator blocks these.
- A raster logo above natural size.
- A locked camera for more than 4 s.
- A blank flash before UI arrives (ref D at 13.0 s), or a poster-then-blank open (ref E).
- A headline cap height under 78 px at 1080p (7.2% of frame height), or small status text carrying the story on a phone (ref C).
- `TransitionSeries`, `Math.random()`, or `seconds * fps` in templates.
- Any reference's brand, logo, copy, palette or footage.

## 11. Biggest gaps, by how much they hurt

Assumes one day of build, and that `packages/motion` does not exist yet.

| #   | Gap                                     | Why it hurts                                                                                                                               | Best move for the first build                                                                                                                                                                                                 | What remains                                                                      |
| --- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| 1   | **No product UI from a public website** | 9 of 10 films lean on a product surface or object, and rebuilds depend on access we lack. Nothing can be invented                          | Asset ladder, tier 1 to 3 capture, tier 4 greeked scenes, hero crops                                                                                                                                                          | The film proves the message, not the product working. Say so in sales copy        |
| 2   | **Claims and copy**                     | Films run on sharp 2 to 5 word lines and hard numbers. Site copy is wordy, and many sites have no numeric claims. Superlatives are blocked | Proof fallback in the templates, strict scene limits, a copy pass on 8-word cards                                                                                                                                             | A site with no numbers gets a weaker middle                                       |
| 3   | **Authored continuity**                 | About half of ref A's junctions and most of ref C's are hand-tuned to the neighbouring shot. A library has generic edges                   | Anchor contract, T1 wrapper, dead-stop fallback                                                                                                                                                                               | Fewer junctions per film feel bespoke. A human pass on seams still raises quality |
| 4   | **Sameness from a small library**       | Ref G has over 20 transition set-ups. We will have about 15 scenes. Even authored films go stale past 45 s                                 | Standard at 45 s, not 65 s. Rules 17 and 18. Two skins                                                                                                                                                                        | A second film from the same template will look related                            |
| 5   | **Music**                               | Structural sync is the sonic signature, and the plan has no licensed music source for customer films while ElevenLabs credits are reserved | Pick a small licensed library with hand-marked cue sheets. Try the two-render bass gate                                                                                                                                       | Only 3 to 6 tracks, generic arrangement                                           |
| 6   | **Hero assets**                         | Ref A hardware, ref F-BR chrome and ref F-TL's mascot need rendered 3D. Naive is not wired in                                              | Flat iso in CSS 3D, `camera.depth` and `light.rim` on captured pages, type-led films, brand-colour events                                                                                                                     | No photographic or CG richness                                                    |
| 7   | **Layout robustness**                   | Variable copy, logos, fonts and 3 formats. All references are 16:9, so 9:16 and 1:1 have no bar                                            | Ship 16:9 first. `fitTextOnNLines`. Mark other formats as unvalidated                                                                                                                                                         | Vertical films wait                                                               |
| 8   | **Quality review**                      | The references' true cost is review time. Scene score misses most edits on light grounds                                                   | Contact sheets, seam strips, the checks in section 10                                                                                                                                                                         | Taste still needs a human or a strong reviewer                                    |
| 9   | **Motion blur**                         | Ref A has real blur on fast tiles. `CameraMotionBlur` re-renders children once per sample, so 5 to 10 samples multiplies render cost       | Skip `CameraMotionBlur`, or use it in `tile-wall` only. Ref G looks fine with none. Type blur on slams (ref B, ref F-BR) is a per-layer filter driven by per-frame velocity, so the render-cost argument does not apply to it | Slightly harsher fast tiles                                                       |

### Open decisions for the founder

| Decision                                   | Recommendation                                                                                                                                                                                                              |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Default length                             | 45 s, with 25 s kept as Short                                                                                                                                                                                               |
| Narration default                          | Off. Sparse narration on the demo film only                                                                                                                                                                                 |
| Count-ups for cited numbers                | Allow, from zero to the exact cited value, held at least 30 frames                                                                                                                                                          |
| Music source                               | Needed before customer films ship                                                                                                                                                                                           |
| Ask customers for access                   | Offer an optional upload of product screenshots or a screen recording. It moves a film up the asset ladder                                                                                                                  |
| Per-film script approval for tier 4 scenes | Yes, at the existing customer approval step                                                                                                                                                                                 |
| Rule 9 against the templates               | The closing `colour-event`, callback and name rows are three type units in a row in all three templates. Count the `type-card` name variant as `mark`, or exempt the closing sequence, before the validator enforces rule 9 |

## Appendix: method

- Breakdown data from seven frame-level dossiers, one per reference file. Contact sheets for all ten films and selected transition strips were viewed directly.
- Curve fitting: four fitting scripts for curves and beats. Primitive check: a script that runs the build functions in this spec against the measured series. These are working files and are not published.
- Spring form confirmed against the Remotion 4.0.541 source. API names confirmed against Remotion docs and that source: `Easing.bezier`, `Easing.poly`, `Easing.out`, `random`, `Freeze`, `interpolatePath`, `CameraMotionBlur`, `fitTextOnNLines`, `measureText`.
- Narration: offline speech recognition, tiny.en, CPU, local. The model was downloaded, but no audio or video left this machine. Transcripts are kept with the working files and are not reproduced here. Tiny models mistime some words, so phrase offsets are good to about 0.2 s, and one phrase in ref D has a clear alignment error.
- Project rules read from the repository: `CLAUDE.md`, `packages/schema/src/campaign.ts`, `validate.ts`, `frames.ts`, `examples/nova.campaign.json`, plus the system map.
- ElevenLabs was not called. Credit figures use an assumed rate.
- **Recheck, 2026-11-07.** Corrections from an independent re-measure, a missed-traits pass and a buildability review were applied in place. Re-measures used full-resolution frame tracking, ffprobe, ffmpeg `ebur128` and `signalstats`, a local librosa beat grid, and offline tiny.en word timings with no VAD; nothing left this machine. Evidence files: saturation logs, frame grabs from ref A, ref B and ref E, a crop of the concept labels in ref G, two scripts for curve and template arithmetic, a script that runs Remotion's `spring()`, and the dossier strips for ref A to ref G. They are working files and are not published. The ref A hold-frame finding was spot-checked again from its per-frame change log before rule 13 was edited.
- **Not re-measured [U].** The beat table (counts, means, medians and the 1.97 s median of medians), the ref A junction counts, and the spring argument (32 to 52% on the first frame in ref B). An automated swap detector found 22 to 23 swaps in ref A against the 28 junctions cited, because it misses text-to-text swaps on one ground, so it was not used as evidence. The ref C and ref E beat-sync figures could not be tested (too few hard cuts detected). The template frame sums were checked as arithmetic, which is not a measurement.
- **Where corrections conflicted.** (1) The buildability review kept "a product shot beside drifting type may hold still [M ref A]", but the missed-traits pass measured that ref A's product never holds still. The measurement wins. (2) T16's black hold: the re-measure gives 4 to 5 frames of true black (maximum pixel at most 12/255), and the buildability review gives 4 to 7 under a peak-luma threshold of 14 and proposed a 6-frame hold. The spec uses a 5-frame hold [D]. (3) The 1080p60 premium export conflicts with the first build's 30 fps lock, so it waits for the frame-count conversion. (4) T9's low end is 9 px in the first draft and 10 px in the recheck, so the 1920 equivalent is given as about 11 px/f.
- Reference copy and palettes quoted in the correction notes (on-screen words, concept labels, hue names) are described rather than reproduced, per the reference discipline at the top.
