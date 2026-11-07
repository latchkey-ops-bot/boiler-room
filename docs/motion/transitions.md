# Transitions

The ranked transition catalog for `packages/motion`, written so each one can be built and checked
without opening the source. The measurements and their derivations are in
[reference-spec.md](reference-spec.md), section 4. Scene files in [scenes/](scenes/README.md) say
which transitions each scene pairs with.

## Evidence tags

The tags are the reference spec's: **[M]** measured, **[F]** fitted, **[E]** estimated, **[D]** a
decision in the reference spec, **[U]** unverified. **[N]** marks a build default that is new in
this file. It is not in the reference spec, it is not measured, and it can change after review.

## Ground rules

- **Transitions take no timeline time.** `scene.start` and `scene.end` stay true. A transition is
  drawn over the boundary, and `TransitionSeries` is never used.
- **Ids.** `transitionOut` holds a catalog id, `t1` to `t17`, lowercase [D]. Every scene except
  the last has one. `fade` and `slide` are not catalog ids, and nothing defaults to a fade.
- **Frame names.** `S` is the seam: the first frame of the incoming scene, `sceneFrames[i + 1].from`.
  `f = frame - S`, so `f = -1` is the last outgoing frame and `f = 0` the first incoming frame.
- **Mounting [D].** Scene `i` mounts as
  `<Sequence from={from_i - PRE} durationInFrames={dur_i + PRE + POST}>` and reads
  `f = useCurrentFrame() - PRE`. PRE and POST are how far the chosen transitions reach into that
  scene. They are 0 except T12 (POST 9 on the outgoing scene) and T14 (POST equal to the ring
  duration on the outgoing scene). One-shot animations evaluate at `clamp(f, 0, dur - 1)`. Drift
  terms use the unclamped `f`, so drift never freezes.
- **Layer order [D].** The ground is the `Stage`'s bottom layer, then scenes, then transition
  overlays. During an overlap the incoming scene is above the outgoing one, except in T6 (incoming
  beneath until the cover frame) and T12 (the halves on top).
- **Determinism.** `random('seed-' + i)` and `noise2D` from `@remotion/noise` only. Never
  `Math.random()`.

### Which transitions a boundary may use

The resolver in `packages/motion` picks the id for each boundary, in this order [D]:

1. A template-pinned id wins.
2. If the ground differs, pick from the ground-change set: T6, T7, T16 or T3.
3. If both scenes declare an anchor with the same id, carry it with T2: the incoming scene draws
   the anchor for `f` in `[0, 11)` at
   `lerp(outgoing.box(outDur - 1), incoming.box(11), Easing.bezier(0.68, -0.06, 0.34, 1.06))`, and
   the outgoing scene stops drawing it at its last frame.
4. If both anchors declare a velocity on the same axis and sign, with `vOut / vIn` in
   `[1/1.5, 1.5]`, use T1 with `Seam {n: 11, r: 1.4, k: 0.72, D: 14, vPeak: Math.sqrt(vOut * vIn)}`.
   On axis `x`, use `k: 0.70` [N, from the [M] lateral fit of 0.66 to 0.70 in ref A].
5. Otherwise use T3.

With the same ground on both sides, the legal set is T1, T3, T4 or T5 [D]. An agent-set
`transitionOut` is honoured only when the resolver lists it as legal for that boundary.

### Per-film limits [D]

| Rule            | Limit                                                                                                                            |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Exempt          | T1 and T3 everywhere. T5 between consecutive scenes of one card group (same scene type, shared headline slot)                    |
| Every other use | At most 3 per film for each transition, and never next to a seam with the same transition. A template-pinned seam wins over this |
| Showpieces      | T6, T7, T12, T13, T14, T15: at most 3 in a Standard film                                                                         |
| Dead stops      | `count(T3)` in `[floor(s / 3), ceil(s / 3)]`, where `s` is the seam count                                                        |
| T16             | Only at a ground change. It is the one permitted fade between scenes                                                             |
| T17             | At most once per film                                                                                                            |

## Ranked catalog

| Rank | Id    | Name                               | Frames                            | Where it is legal                                    | Showpiece | Refs                              |
| ---- | ----- | ---------------------------------- | --------------------------------- | ---------------------------------------------------- | --------- | --------------------------------- |
| 1    | `t1`  | Matched-velocity seam              | 9 to 12 out, cut, 10 to 15 in     | Same ground                                          | no        | ref A, ref B, ref C, ref D, ref G |
| 2    | `t2`  | Hero-to-slot collapse              | 11 to 13                          | Inside a scene, or a shared anchor (resolver step 3) | no        | ref E, ref B, ref C               |
| 3    | `t3`  | Dead-stop cut into word rise       | 0, then 5 to 13                   | Any boundary                                         | no        | ref A, ref D, ref B               |
| 4    | `t4`  | Word slam over a held ground       | 1 overlap, 7 settle               | Same ground                                          | no        | ref F-BL, ref B, ref F-TR         |
| 5    | `t5`  | Blink and rack                     | 2 blank, 4 rack                   | Same ground                                          | no        | ref E                             |
| 6    | `t6`  | Object becomes world               | 9 to 24                           | Ground change                                        | yes       | ref G, ref B                      |
| 7    | `t7`  | Tile flood with a persistent hero  | 6 to 11                           | Ground change                                        | yes       | ref G, ref D                      |
| 8    | `t8`  | Container morph                    | 18 to 45                          | Inside a scene, or a shared box anchor               | no        | ref C                             |
| 9    | `t9`  | Long ramp into cut                 | 26 to 55                          | Template-pinned                                      | no        | ref F-TL, ref F-BR, ref C         |
| 10   | `t10` | Vertical conveyor                  | 25                                | Inside a scene                                       | no        | ref C, ref B                      |
| 11   | `t11` | Soft-mask baton wipe               | 11                                | Inside a scene, or template-pinned                   | no        | ref C                             |
| 12   | `t12` | Door split with a surviving centre | 8 moving, 2 clear, headline at 11 | Template-pinned                                      | yes       | ref E                             |
| 13   | `t13` | Iris to dot and bloom              | 10 to 40                          | Template-pinned                                      | yes       | ref C, ref D                      |
| 14   | `t14` | Ring wipe from a point             | 11 to 19, by origin [E]           | Template-pinned, identical layouts only              | yes       | ref F-TR                          |
| 15   | `t15` | Two-beat colour hit                | 2, then 11                        | Template-pinned, hero beats only                     | yes       | ref F-BR, ref F-TR                |
| 16   | `t16` | Dip to black                       | 10 out, 5 black, 12 up            | Ground change only                                   | no        | ref F-BL                          |
| 17   | `t17` | Tension hold, colour slam          | 26 hold, 1 cut                    | Template-pinned, once                                | no        | ref G                             |

## Shared primitives

```ts
export const arrive = (f: number, k: number): number => (f <= 0 ? 0 : 1 - k ** f);
export const arriveN = (f: number, k: number, D: number): number =>
  f <= 0 ? 0 : f >= D ? 1 : (1 - k ** f) / (1 - k ** D);
export const depart = (f: number, n: number, r: number): number =>
  f <= 0 ? 0 : f >= n ? 1 : (r ** f - 1) / (r ** n - 1);

export interface Seam {
  axis: 'x' | 'y' | 'scale';
  sign: 1 | -1;
  vPeak: number; // px per frame, or log scale per frame for 'scale'
  n: number; // outgoing ramp frames
  r: number; // outgoing speed multiplier per frame
  k: number; // incoming decay per frame
  D: number; // incoming settle frame
}
const outTravel = ({ vPeak, n, r }: Seam) => (vPeak * (r ** n - 1)) / (r ** (n - 1) * (r - 1));
export const seamOut = (f: number, s: Seam) =>
  s.sign * outTravel(s) * depart(f + s.n + 1, s.n, s.r);
export const seamIn = (f: number, s: Seam) =>
  f >= s.D
    ? 0
    : (-s.sign * (s.vPeak / (1 - s.k)) * (s.k ** Math.max(f, 0) - s.k ** s.D)) / (1 - s.k ** s.D);
```

All from the reference spec, sections 3 and 4. For `axis: 'scale'`, apply `scale(Math.exp(offset))`.

## T1. Matched-velocity seam

**Does.** The outgoing element accelerates into a hard cut at peak speed. The incoming element
starts on the same axis at about the same speed and decays, so the eye reads one curve across two
shots. Works on x, y and scale.

**Build.**

| Parameter        | Value                                                                                                                                                                                                                                                           | Tag                                                                    |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Outgoing         | `seamOut(f, seam)` for `f` in `[-n, -1]`, applied to the outgoing anchor's layer                                                                                                                                                                                | [D]                                                                    |
| Incoming         | `seamIn(f, seam)` for `f` in `[0, D)`, then 0                                                                                                                                                                                                                   | [D]                                                                    |
| `n`, `r`         | 11, 1.4 (`depart.long`)                                                                                                                                                                                                                                         | [M]                                                                    |
| `k`, `D`         | 0.72, 14. Axis `x`: 0.70, 14                                                                                                                                                                                                                                    | [M] k; [N] the x override                                              |
| `vPeak`          | 30 to 46 px/f, or 0.02 to 0.03 log scale/f. The resolver uses `sqrt(vOut * vIn)`                                                                                                                                                                                | [M] range; [D] formula                                                 |
| Speed ratio      | `vOut / vIn` within 1.5x, from the two anchors' declared velocities                                                                                                                                                                                             | [M] ref A                                                              |
| Scale origin     | Frame centre                                                                                                                                                                                                                                                    | [D]                                                                    |
| Word-gap variant | On axis `x`, each incoming word `i` of a line takes `seamIn(f) * gain(i)`, with `gain(i) = clamp(1 + 0.2 * d(i), 0.6, 1.4)` and `d(i)` the word's distance in words from the line's middle word, positive towards the trailing side. Glyph size does not change | [N], fitted by eye to ref A's [M] word speeds 49 to 68, 46 and 33 px/f |
| Whip variant     | Outgoing `r` 1.2, `n` 9 (`depart.whip`), one near-empty frame at `f = -1`, incoming at about half speed                                                                                                                                                         | [M] ref G                                                              |

**Pairs with.** Every scene that declares a velocity anchor. The default x anchor is
`{axis: 'x', sign: 1, v: 46}` and the default y anchor `{axis: 'y', sign: -1, v: 36}` [N, inside
the [M] range].

**QC frames.** `S - 12` (before the ramp), `S - 1` (outgoing at peak speed, motion blur allowed
only on type above the speed gate), `S` (incoming already displaced and moving the same way),
`S + 1`, `S + 14` (incoming at rest). Fail if `S` is blank, if the axes differ, or if the declared
velocities differ by more than 1.5x.

## T2. Hero-to-slot collapse

**Does.** The same headline moves from centre stage to a layout slot as proof arrives, or a
display word shrinks to exactly its size in the next sentence. It is not a cut.

**Build.**

| Case                  | Parameters                                                                                                                                                                                                    | Tag                             |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| Lift to slot          | `interpolate(f, [0, 11], [start, slot], {easing: Easing.bezier(0.68, -0.06, 0.34, 1.06), extrapolateLeft: 'clamp', extrapolateRight: 'clamp'})` on y and scale. Ref E lifts 402 px at 1080 and scales to 0.77 | [F] curve; [M] travel and scale |
| First data row        | Enters at frame 7 of the 11, before the lift finishes                                                                                                                                                         | [M]                             |
| Word collapse         | `collapse`, `Easing.bezier(0.94, 0.12, 0.34, 0.82)`, 13 frames, to `sentenceCap / displayCap`, about 0.37 at 2.7:1, never below the sentence minimum                                                          | [F] curve; [D] end scale        |
| After a word collapse | Later words append as 1-frame pops, and the line re-centres with `arriveN(f, 0.72, 14)`                                                                                                                       | [M] ref B                       |
| Anchor carry          | Resolver step 3 above                                                                                                                                                                                         | [D]                             |

**Pairs with.** `proof-bars` (lift), `word-slam` (collapse), consecutive scenes that share an
anchor id.

**QC frames.** Lift: `f = 0`, `7` (first data row visible), `11` (headline at the slot, scale
0.77). Collapse: its first frame, middle frame (`+6`) and `+13` (word at sentence size, cap height
78 px or more at 1080).

## T3. Dead-stop cut into word rise

**Does.** A plain hard cut from a still shot, with the incoming word rise supplying all the energy.
A deliberate rest that makes matched seams feel like events, not a fallback.

**Build.** No transition component. The incoming scene starts its native entry at `f = 0`. For
type:

```ts
export const wordRise = (f: number, i: number, stagger = 1, rise = 72, k = 0.75) => {
  const t = f - i * stagger;
  return { visible: t >= 0, y: rise * k ** Math.max(t, 0) };
};
```

Words render at opacity 1 from their first visible frame (`pop`). For a second line, push line 1
up by `travel * arrive(f - line2Start + 1, 0.4)`, where `travel = lineHeight * fontSize / 2`
[D]. Its first frame jumps 60% [M, inside ref A's 49 to 71%].

**Pairs with.** Every scene. Required on about a third of the seams.

**QC frames.** `S - 1` (outgoing still drifting, not frozen), `S` (incoming content present and
moving: first word visible, offset 72 px), `S + 13` (rise within 2 px of rest). Fail if `S` is a
blank frame.

## T4. Word slam over a held ground

**Does.** The next word arrives huge over the outgoing word, at speed, with 1 frame of overlap.
The ground holds one exact flat level, so no cut registers.

**Build.**

| Parameter          | Value                                                                                                                                                                                                 | Tag                            |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| Scale              | Word laid out at display size, `s` a CSS scale about its centre. `excess = f === 0 ? 4.4 : 1.5 * 0.7 ** (f - 1)`, `s = Math.max((1 + excess) * 0.98 ** Math.max(0, f - 8), sentenceCap / displayCap)` | [M] ref F-BL, per 30 fps frame |
| Overlap            | The outgoing word stays mounted for exactly `f = 0`                                                                                                                                                   | [M]                            |
| Ground             | The `Stage` ground, beneath the scenes, unchanged across the seam                                                                                                                                     | [D]                            |
| Continuous variant | A growing word replaced by a smaller word still growing: drive both from one continuous scale                                                                                                         | [M] ref B                      |
| Bleed              | Glyphs may exceed the frame while moving. Every word sits wholly inside the safe area for at least about 10 frames                                                                                    | [D] [E]                        |
| Blur               | Velocity-gated, entry only, see `word-slam`                                                                                                                                                           | [E]                            |

**Pairs with.** `word-slam` to `word-slam`, or a slam into `type-card` on Kinetic Plate.

**QC frames.** `S - 1`, `S` (both words visible, incoming at scale 5.4), `S + 1` (outgoing gone),
`S + 8` (incoming within 13% of rest), and the first frame where the word is wholly inside the
safe area (must be 10 or more frames before it leaves).

## T5. Blink and rack

**Does.** On a fixed ground, all content leaves in one frame, exactly 2 blank frames follow, then
the headline returns at full ink but defocused, sharpening in 4 frames as it settles 13 px.

**Build.**

| `f`  | Content                  | Blur px | y offset px | Tag             |
| ---- | ------------------------ | ------- | ----------- | --------------- |
| 0, 1 | Ground only              | none    | none        | [M]             |
| 2    | Headline at full opacity | 6       | 13          | [E] blur; [M] y |
| 3    |                          | 3       | 7           |                 |
| 4    |                          | 1.2     | 4           |                 |
| 5    |                          | 0       | 1           |                 |
| 6    |                          | 0       | 0           |                 |

Chapter blink: 5 blank frames (`f` 0 to 4), so every row above shifts by 3 (sharp at `f = 8`) [M
ref E]. The incoming scene draws the blink: the outgoing scene needs nothing. The headline slot is
one fixed coordinate across the group [M]. The chapter blink is used when the incoming scene is a
`type-card` with `props.variant: 'pivot'` [N]. Blank frames are exempt from "start in motion"
(rule 19), and they count towards `card.min`, which is the scene's whole duration.

**Pairs with.** `feature-card` to `feature-card`, `proof-bars` to `proof-bars`,
`stat-counter` to `stat-counter`, `status-relay` to `status-relay`, anything into a pivot
`type-card` (pinned).

**QC frames.** `S - 1` (content), `S` and `S + 1` (uniform ground: no pixel more than 2 levels
from the ground colour [N]), `S + 2` (headline at full ink, soft), `S + 5` (sharp), `S + 6` (at
rest, same y as the previous card's headline to the pixel). Chapter: `S` to `S + 4` uniform, `S +
5` soft, `S + 8` sharp.

## T6. Object becomes world

**Does.** An element scales past the frame until its fill is the background. A 4-frame squeeze of
5% comes first.

**Build.** The seam `S` is the cover frame, so the outgoing scene starts the move
`4 + gCover` frames before it [N].

| Phase                                        | Value                                                                                      | Tag                     |
| -------------------------------------------- | ------------------------------------------------------------------------------------------ | ----------------------- |
| Squeeze, `t` in `[0, 4)` from the move start | `s = interpolate(t, [0, 4], [1, 0.95])`                                                    | [D]                     |
| Growth, `g = t - 4 >= 1`                     | `rho(g) = Math.min(1.39, 1.01 * 1.0407 ** (g - 1))`, `s(g) = 0.95 * rho(1) * ... * rho(g)` | [M] ratios 1.01 to 1.39 |
| Cover scale                                  | `c = Math.max(W / el.w, H / el.h)` from the element's anchor box                           | [D]                     |
| `gCover`                                     | The first `g` with `s(g) >= c`, about 8 to 13 for `c` of 2.5 to 16.7                       | [M, curve check]        |
| Cut                                          | The incoming scene cuts in beneath at `S`, its ground the element's fill colour            | [D]                     |
| Ground switch                                | At the cover frame, `S`                                                                    | [D]                     |

Only vector or CSS-drawn elements qualify, never a raster logo. PRE and POST are 0.

**Pairs with.** `proof-bars` (a bar in the accent fill) into `colour-event`.

**QC frames.** Move start, `S - gCover + 1`, `S - 1` (element nearly covering, edges still
visible), `S` (incoming on the element's colour, no visible seam), `S + 1`.

## T7. Tile flood with a persistent hero

**Does.** Tiles replace the ground behind a subject that stays on top. Coverage roughly doubles
each frame.

**Build.**

| Parameter                | Value                                                                                                             | Tag                           |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| Coverage by `f` = 0 to 7 | 2.4, 5.5, 11, 19, 35, 54, 78, 100%                                                                                | [M] first six; [E] 78 and 100 |
| Cells                    | 108 px at 1080 (H / 10), ranked by distance from a seed plus `random('flood-' + i) * jitter`, jitter 0.5 cell [N] | [D] size; [N] jitter          |
| Shown                    | The first `round(coverage[f] * n)` cells, keyed to the frame, on a `<canvas>` or an SVG `<rect>` list             | [D]                           |
| Who draws it             | The incoming scene, over the old `Stage` ground. The persistent hero is a shared anchor the incoming scene draws  | [N]                           |
| Ground switch            | When coverage reaches 1.0 (`f = 7`)                                                                               | [D]                           |
| Camera                   | Time the camera's peak speed to the largest gain (`f` 5 to 6)                                                     | [M]                           |

**Pairs with.** `tile-wall` into `colour-event`.

**QC frames.** `S` (2.4% of cells, hero present), `S + 3` (about 19%), `S + 7` (100%), `S + 8`.

## T8. Container morph

**Does.** One rounded rectangle changes shape instead of crossfading to a new object. Contents
leave first and arrive only after the shape settles.

**Build (`MorphBox`).** Content exit: a 6-frame opacity fade, `f` in `[0, 6)` [E]. Width over `f`
in `[6, 18)`, then height over `[18, 45)` [M], both `Easing.bezier(0.76, 0, 0.24, 1)`. Content
entry from `f = 45` with `wordRise` or `pop` at full opacity, never a fade-in. The child is
absolutely positioned and never scales with the box.

**Pairs with.** The demo panel inside `feature-card` and `status-relay` blocks. Not a default
boundary in any template.

**QC frames.** `f = 5` (content gone), `17` (width done), `44` (height done, box empty), `45`
(content in, full opacity).

## T9. Long ramp into cut

**Does.** A constant scroll or scale multiplies its speed for a long stretch, then cuts at peak to
a new scale extreme.

**Build.** Cumulative distance `v0 * (r ** f - 1) / (r - 1)`. Ramps: `depart.drag` (r 1.11, 26
frames, about 15x total speed) [M ref F-TL] or `depart.slowBuild` (r 1.037, 55 frames, about 7.5x)
[M ref F-BR]. At 1920 px the ref F-TL ramp runs about 11 to 165 px/f [M]. Fling variant: ramp 8
frames, then decay with `arrive.long` (k 0.88, D 35) [M ref C, 167 px/f peak]. The ramp is drawn by
the outgoing scene. The seam is a hard cut at peak speed.

**Pairs with.** `tile-wall` (exit ramp, pinned in Standard), `site-scroll` (fling inside the scene).

**QC frames.** `S - 26` (ramp start, about 11 px/f), `S - 1` (about 165 px/f), `S`.

## T10. Vertical conveyor

**Does.** Each finished block scrolls up as the next rises on one S-curve.

**Build.** One absolute container, `y = -blockHeight * (i + stepEase(f))`, with `stepEase` the
`step` curve `Easing.bezier(0.85, 0, 0.15, 1)` over 30 frames [M ref C]. Blocks are laid out in
one column.

**Pairs with.** Reserved for a later `status-relay` conveyor mode. The first build does not use it.

**QC frames.** Move start, `+15`, `+30`.

## T11. Soft-mask baton wipe

**Does.** A left-to-right soft edge erases one layer and reveals another, and its last erased
glyph sits where the next object resolves.

**Build.** `maskImage` and `WebkitMaskImage`:
`linear-gradient(90deg, black ${p - s}%, transparent ${p + s}%)`, with
`p = -s + (100 + 2 * s) * arriveN(f, 0.72, 14)` and softness `s` about 8 [E]. The mapping of `p`
is [N]: it starts and ends with the edge fully off the layer.

**Pairs with.** `logo-reveal` mask mode.

**QC frames.** `f = 0`, `7`, `14` (fully revealed).

## T12. Door split with a surviving centre

**Does.** Each half of the frame, ground plus foreground, parts on one curve while a centre glyph
flies through.

**Build.**

```ts
/** No clamp: the halves must leave the frame. Unmount them at f >= 9. */
export const doorOffset = (f: number, width: number): number =>
  width * 0.397 * (Math.max(0, f) / 8) ** 3.75;
```

| Parameter                | Value                                                                                                                                                                | Tag                                            |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Halves                   | Two copies of the outgoing scene clipped with `clip-path`, each rendering `<Ground at={S - 1}/>`, moved by `±doorOffset(f, W)` for `f` 0 to 8, unmounted at `f >= 9` | [M] series 2, 6, 22, 58, 130, 258, 460, 762 px |
| Centre glyph, `f` 1 to 9 | Scale 1.01, 1.05, 1.13, 1.28, 1.52, 1.86, 2.33, 2.95, 3.72. Fades only in its last 2 frames                                                                          | [M]                                            |
| `f = 10`                 | Empty ground                                                                                                                                                         | [M]                                            |
| Next headline            | Enters at `f = 11` with a T5 rack and scale `1 + 0.26 * 0.3 ** (f - 11)`                                                                                             | [M]                                            |
| POST                     | 9 on the outgoing scene. The glyph is drawn by the transition overlay through `f = 9`                                                                                | [D]; [N] overlay                               |

For two-sided comparisons only, and never with a rival's logo.

**Pairs with.** Template-pinned only. No first-build template uses it.

**QC frames.** `S + 4`, `S + 8` (a wedge at each edge), `S + 9` (only the fading glyph), `S + 10`
(empty ground), `S + 11`, `S + 14` (headline at rest).

## T13. Iris to dot and bloom

**Does.** The world closes to a small dot, holds, and blooms into a logo.

**Build.** `clipPath: circle(r at 50% 50%)`, or a radial mask when softness matters.

| Phase         | Frames | Value                                                                            | Tag            |
| ------------- | ------ | -------------------------------------------------------------------------------- | -------------- |
| Close         | 10     | From the frame-corner radius to `23 * W / 540` px (ref D works at 540 wide)      | [M] end points |
| Close curve   |        | `r = rDot + (rCorner - rDot) * (1 - arriveN(f, 0.6, 10))`                        | [N]            |
| Edge softness |        | 39, 8, 3, 1 px at 540 wide on the first four frames, then 1, scaled by `W / 540` | [M]            |
| Hold          | 10     | The dot, still                                                                   | [M]            |
| Bloom         | 10     | The close played backwards: render with `frame = d - f`                          | [M]            |

The close and hold are drawn by the outgoing scene in its last 20 frames. The bloom is
`logo-reveal`'s iris mode, `f` 0 to 9.

**Pairs with.** `word-slam` into `logo-reveal` (pinned option). Showpiece.

**QC frames.** `S - 20`, `S - 11` (dot), `S - 1` (dot, still), `S + 5`, `S + 10` (logo legible).

## T14. Ring wipe from a point

**Does.** A circle grows from a cursor or button point with a thin coloured ring at its edge, and
flips the same layout to a second state.

**Build.** Render the same scene twice, state A (outgoing) and state B (incoming). Mask B with a
circle whose radius grows by `rate(j) = W * (0.042 + 0.033 * Math.min(j, 15) / 15)` per frame,
so `r(f) = sum of rate(j) for j = 0..f` [E]. End when `r` reaches the distance from the origin to
the farthest corner: about 11 frames from the centre, 19 from a corner [E, computed]. Ring
thickness about 23% of the radius, in the accent [E]. POST on the outgoing scene equals the ring
duration. Layouts must be identical, so it suits theme or state changes only.

**Pairs with.** Template-pinned only. No first-build template uses it.

**QC frames.** `S`, the middle ring frame, the last ring frame, and the frame after (state B only).

## T15. Two-beat colour hit

**Does.** A 2-frame accent wash over continuing motion, then 11 frames later a flare peaking on one
near-solid frame, with the content swapped under the peak.

**Build.** A full-frame accent layer with opacity keyed to `f`. `S` is the peak frame. Wash at
`S - 13` and `S - 12`, opacity 0.35 [N]. Flare ramps from `S - 6` to 0.95 at `S`, then falls to 0
by `S + 6`, linear [N]. Motion underneath keeps running. Hero beats only.

**Pairs with.** Template-pinned only. No first-build template uses it.

**QC frames.** `S - 13`, `S - 11` (wash gone), `S - 3`, `S` (near-solid), `S + 6` (clear).

## T16. Dip to black

**Does.** Between ideas, ground and type fade to true black, hold, and the next idea fades up.

**Build.** A black `Stage` overlay with opacity `o(f)`:

| `f`         | `o`                                    | Tag                                    |
| ----------- | -------------------------------------- | -------------------------------------- |
| `[-12, -2)` | `(f + 12) / 10`, a 10-frame fade-out   | [M] duration; [D] linear               |
| `[-2, 3)`   | 1, a 5-frame hold                      | [M] 4 to 5 frames of true black; [D] 5 |
| `[3, 15)`   | `1 - (f - 3) / 12`, a 12-frame fade-up | [M] duration; [D] linear               |
| otherwise   | 0                                      |                                        |

The ground switches in the middle of the black hold. The outgoing scene loses its last 12 legible
frames and the incoming scene its first 15, and those frames do not count toward `card.min`. PRE
and POST are 0.

**Pairs with.** Any ground change, most often into or out of `colour-event`.

**QC frames.** `S - 13` (full picture), `S - 7` (half), `S - 2` to `S + 2` (true black: maximum
pixel at most 12/255 on all five), `S + 9`, `S + 15` (clear).

## T17. Tension hold, colour slam

**Does.** 26 still frames, then the hardest cut in the film, with one motif carried onto the next
shot, which is already moving.

**Build.** Freeze the outgoing scene at its state on frame `S - 27` for `f` in `[-26, -1]`
(`hold.tension`, at most once per film) [M ref G]. The incoming scene starts inside `arrive.snap`
(k 0.5, D 8), already moving. Cue silence under the hold. The freeze is the one static run QC
allows mid-film, up to 26 frames.

**Pairs with.** Template-pinned only. No first-build template uses it.

**QC frames.** `S - 27`, `S - 1` (identical to `S - 27`), `S` (incoming moving), `S + 8`.

## Deferred

| Transition                                        | Why                                                                        |
| ------------------------------------------------- | -------------------------------------------------------------------------- |
| Continuous canvas push, ref B, 38 frames          | Needs dashboard and composer on one canvas, which requires real product UI |
| 3D glyph wipe with occlusion, ref F-BR, 14 frames | Needs a rendered chrome asset                                              |
| Physical-action transition, ref A                 | Needs hands and footage                                                    |

## Default seams in the templates

The Director writes these. Each plan was checked against the limits above: dead-stop count, legal
sets, the 3-use limit and adjacency. Seam `k` joins scene `k` and scene `k + 1`.

| Template      | Seams 1 to the last                                                              |
| ------------- | -------------------------------------------------------------------------------- |
| Short (10)    | `t3 t1 t3 t1 t5 t1 t3 t3 t1 t1`. Seam 7 may be `t6` when scene 7 is `proof-bars` |
| Standard (17) | `t3 t1 t3 t3 t1 t5 t5 t5 t1 t5 t5 t5 t3 t9 t3 t1 t1`                             |
| Long (26)     | `t3 t1 t3 t3 t5 t1 t3 t1 t5 t5 t3 t5 t5 t3 t1 t3 t5 t1 t5 t5 t5 t5 t3 t3 t1 t1`  |

Standard seam 8 is the pinned chapter blink into the pivot card. It sits next to seam 7, an exempt
T5 inside the proof group. The reference template causes this, and the pin wins.
