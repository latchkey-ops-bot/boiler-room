# `site-scroll`

**Kind** product. **Effort** M. **Asset tier** 2 to 3. **Refs** ref C, ref B, ref F-TL.

## Purpose

A tour of the real site. Page 1 flings, the page jump hides inside the fling's peak speed, and
page 2 decays onto its call to action.

72 frames in Standard (row 5) and Long (row 8) [D].

## Registry entry

| Field     | Value                                                                                                             | Tag |
| --------- | ----------------------------------------------------------------------------------------------------------------- | --- |
| `kind`    | `product`                                                                                                         | [D] |
| `ground`  | Neutral Cut `base`, Kinetic Plate `plate`                                                                         | [N] |
| `text`    | `{ label: 32 }`                                                                                                   | [N] |
| `anchors` | `browser`: the same frame box as `site-hero`. Exit `{axis: 'x', sign: 1, v: 46}`                                  | [N] |
| `props`   | `pages: {targetY?: number, ctaBox?: {x, y, w, h}}[]`, one entry per page asset, in source pixels from the capture | [N] |

## Text and assets

| Input        | Required                             | Limit                                                                                                                                                                                                                                                                                                                             |
| ------------ | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Page assets  | yes, `assetIds[0]` and `assetIds[1]` | Full-page captures, `kind: 'image'`, `provenance: 'captured'` or `'uploaded'`, device scale 2 or more, cropped from the top to at most three times as tall as wide and never to one screen [N]. Tier 2 (docs, changelog, pricing, integrations) or tier 3 (the marketing site). Page 2 must hold a real CTA or heading to land on |
| `label` text | no, up to 2                          | The URL for each page, shown in the address pill, no scheme, 32 characters                                                                                                                                                                                                                                                        |

Page 1 needs at least `H + 545` output pixels of height below its start. Page 2's landing point
`targetY` comes from the CTA's DOM box: `ctaBox.y` minus 0.35 H, in output pixels [N].

## Layout

Identical to `site-hero`, so the browser frame carries across when both appear [N].

|               | 16:9                                           | 9:16                  | 1:1                   | Tag |
| ------------- | ---------------------------------------------- | --------------------- | --------------------- | --- |
| Browser frame | 0.78 W wide, centred, top at 0.14 H            | 0.92 W, top at 0.18 H | 0.86 W, top at 0.12 H | [N] |
| Page width    | fills the frame width, scaled from the capture |                       |                       | [N] |

## Motion

`v` is the page's scroll speed in output px per frame. Content moves up as the page scrolls down.

| Phase         | Frames         | Motion                                                                                                                               | Tag                                                               |
| ------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| Ramp, page 1  | `f` 0 to 7     | `v(f) = v0 * 1.4 ** f` with `v0 = vPeak / 1.4 ** 7`, so `f = 7` runs at `vPeak`. Moving at `f = 0`                                   | [M] ramp 8 frames; [N] r 1.4                                      |
| Peak          |                | `vPeak = Math.min(167, targetY * (1 - 0.88))` px/f                                                                                   | [M] 167 px/f ref C; [N] the cap                                   |
| Page jump     | `f = 8`        | Page 2 replaces page 1 in one frame, at peak speed, inside the same frame                                                            | [M] ref C fling hides a page jump                                 |
| Decay, page 2 | `f` 8 to 42    | Scroll offset from `targetY` is `(vPeak / 0.12) * (0.88 ** (f - 8) - 0.88 ** 35) / (1 - 0.88 ** 35)`, reaching exactly 0 at `f = 43` | [M] `arrive.long` k 0.88, D 35; about 38 frames of decay in ref C |
| Landing       | `f` 43 to 71   | Push `scale(1 + 0.0015 * (f - 43))` about the CTA box centre                                                                         | [D] at least +0.13%/f                                             |
| Light         | `f` 50 to 64   | One `light.sweep` across the CTA box, 15 frames                                                                                      | [E] 10 to 20 frames                                               |
| Blur          | while `v > 60` | Vertical blur `stdDeviation = "0 " + Math.min(8, v / 20)` on the page layer only                                                     | [N]; not `CameraMotionBlur`                                       |
| T1 exit       | `f` 61 to 71   | `seamOut` on x on the browser frame                                                                                                  | [M]                                                               |

With `vPeak` at 167 px/f, the ramp covers 545 px and the decay 1392 px. A page 2 whose CTA is
closer to the top than that gets a lower peak through the cap above, never a jump past the top of
the page.

## Transitions

| In         | Out                                            |
| ---------- | ---------------------------------------------- |
| T3, T1 (x) | T1 (x) into `proof-bars` or `status-relay`, T3 |

## Acceptance stills

| Frame             | Must show                                                                                    |
| ----------------- | -------------------------------------------------------------------------------------------- |
| `f = 0`           | Page 1 visible and scrolling                                                                 |
| `f = 7`, `8`, `9` | `f = 8` shows page 2. The speed on 7 to 8 and 8 to 9 is within 1.5x. No blank or mixed frame |
| `f = 43`          | Page 2 at `targetY` within 1 px, the CTA in frame                                            |
| `f = 57`          | The sweep on the CTA, and no other lit element                                               |
| every frame       | MAD at least 0.02 against the previous frame                                                 |
| any               | Both pages are real captures                                                                 |
