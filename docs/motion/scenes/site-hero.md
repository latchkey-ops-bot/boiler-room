# `site-hero`

**Kind** product. **Effort** M. **Asset tier** 1 to 3. **Refs** ref F-TR, ref F-BL, ref B.

## Purpose

The first product surface: a real captured page in a browser frame or on a tilted plane with
`camera.depth`, with a slow push and one lit element. It lands the surface by 5.0 s (Short) or
6.0 s (Standard, Long), inside rule 2's 7 s.

| Template       | Starts at | Frames |
| -------------- | --------- | ------ |
| Short          | 150       | 84     |
| Standard, Long | 180       | 96     |

## Registry entry

| Field     | Value                                                                                                                                           | Tag                                 |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `kind`    | `product`                                                                                                                                       | [D]                                 |
| `ground`  | Neutral Cut `base`, Kinetic Plate `plate`                                                                                                       | [N]                                 |
| `limits`  | `label: 32`                                                                                                                                     | [N]                                 |
| `anchors` | `browser`: the frame box. Entry `{axis: 'y', sign: -1, v: 36}`. Exit `{axis: 'scale', sign: 1, v: 0.03}`                                        | [N] v; [M] scale range 0.02 to 0.03 |
| `props`   | `frame?: 'browser' \| 'plane'` (default `'browser'`), `layers?: {assetId, box: {x, y, w, h}}[]`, `focus?: {x, y, w, h}`, `activeLayer?: number` | [N]                                 |

`layers`, `focus` and box coordinates are capture data in source pixels, written by the
Researcher from DOM boxes. They are JSON numbers, never copy. No agent invents them.

## Text and assets

| Input        | Required           | Limit                                                                                                                                                                                 |
| ------------ | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Page asset   | yes, `assetIds[0]` | `kind: 'image'` or `'video'`, `provenance: 'captured'` or `'uploaded'`, captured at device scale 2 or more (2880 px wide or more for a 1440 px viewport) [D rule 3]. Tier 1 to 3 only |
| Layer assets | no, `props.layers` | Element screenshots of the same page with their DOM boxes, so the headline, button and image can move as separate layers [D rule 4]                                                   |
| `label` text | no                 | The page URL shown in the browser frame's address bar, no scheme, 32 characters                                                                                                       |

Crop to one idea, never redraw [D rule 1]. The crop is the hero section above the fold, or the
`focus` box when given.

## Layout

|                   | 16:9                                                                                                               | 9:16                                                                                                                                  | 1:1                        | Tag                                             |
| ----------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- | ----------------------------------------------- |
| Browser frame     | 0.78 W wide, centred, top edge at 0.14 H, bottom cropped by the frame edge                                         | 0.92 W wide, top at 0.18 H. Use a mobile capture when the Researcher has one; otherwise crop the desktop capture to its centre column | 0.86 W wide, top at 0.12 H | [N]                                             |
| Chrome            | 44 px bar, `brand.radius` corners (16 px if unset), address pill with the label in the body family at 22 px        | same                                                                                                                                  | same                       | [N]; [D] radius                                 |
| Plane mode        | Perspective 1600 px at 1920 wide, scaled with W. `rotateX(12deg)`                                                  | same                                                                                                                                  | same                       | [D] perspective 1200 to 2000, tilt 10 to 25 [E] |
| Focus band        | The `focus` box, else the top 40% of the crop. Blur 0 inside, rising linearly to 6 px at the frame edge            |                                                                                                                                       |                            | [E] 4 to 8 px                                   |
| Cheap depth build | Two copies of the capture, one sharp and one blurred 6 px, blended by a `linear-gradient` mask along the tilt axis |                                                                                                                                       |                            | [D]                                             |

## Motion

| Element      | Frames                      | Motion                                                                                                                                | Tag                                    |
| ------------ | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| Native entry | `f` 0 to 22                 | Frame rises `y = 200 * (1 - arriveN(f, 0.82, 23))`. In plane mode, tilt eases from 25 to 12 degrees on the same curve                 | [M] `arrive.slow`; [N] travel and tilt |
| T1 entry     | `f` 0 to 13                 | `seamIn` on y from the resolver's seam                                                                                                | [M]                                    |
| Push         | every frame                 | `scale(1 + 0.0015 * f)` about the focus band centre, unclamped `f`                                                                    | [D] at least +0.13%/f; [N] 0.15%       |
| Parallax     | every frame                 | Layers in `props.layers` move 1.3 times as fast as the frame                                                                          | [E] 1.2 to 1.5                         |
| Drift        | every frame                 | Plane mode adds `rotateY(-0.05 * f deg)`                                                                                              | [N]                                    |
| Light        | `f` 40 to 54                | `light.sweep` across `props.activeLayer` (else the page's primary button, else none): one gradient highlight in the accent, 15 frames | [E] 10 to 20 frames; [N] timing        |
| T1 exit      | `f` `dur - 11` to `dur - 1` | `seamOut` on scale, `+1`: the push accelerates into the cut                                                                           | [M]                                    |

No cursor by default. A cursor is allowed only on a real captured page and never implies an
in-app flow [D rule 7]. No camera lock longer than 4 s [M].

## Transitions

| In                            | Out                             |
| ----------------------------- | ------------------------------- |
| T1 (y) from `logo-reveal`, T3 | T1 (scale), T3 into `type-card` |

## Acceptance stills

| Frame         | Must show                                                                                                    |
| ------------- | ------------------------------------------------------------------------------------------------------------ |
| `f = 0`       | The page visible and moving. Absolute frame 150 (Short) or 180 (Standard, Long), so the surface lands by 7 s |
| `f = 23`      | Entry settled. Focus band sharp, edges softer                                                                |
| `f = 47`      | One lit element and no other accent on screen                                                                |
| every frame   | MAD against the previous frame at least 0.02 (product layers never hold mid-film)                            |
| `f = dur - 1` | On T1, scale visibly larger than at `f = dur - 12`                                                           |
| any           | The capture is real: `provenance` `captured` or `uploaded`. No cursor unless on a real page                  |
