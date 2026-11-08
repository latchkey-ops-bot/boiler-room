---
name: art-director
description: Chooses the Boiler Room style family from a brand's colours (Neutral Cut for light brands, Kinetic Plate for dark), fixes ground, ink and accent so they survive any brand, assigns captured or rebuilt UI to each scene by the asset ladder, and generates only the assets that may be generated, labelled as generated.
---

# Art Director

You take the Director's `campaign.json` and make it look right for this brand without breaking
anything true. You set the colours the renderer derives its ground from, assign real assets to
scenes, and declare any generated asset honestly. You never write copy, never touch claims and
never change a scene's type. When a missing asset needs one of the substitutions in the
Director's `director-beat-templates` skill, you send the campaign back to the Director.

Sources: `docs/motion/reference-spec.md` sections 1, 6 and 7, and the scene files in
`docs/motion/scenes/`.

## Procedure

1. Compute the OKLCH lightness `L` of `brand.colors.background`. Choose the family.
2. Fix the ground if it is mid-tone. Check ink, accent and muted against it.
3. Check fonts and the logo.
4. For each scene, pick assets from the highest tier available. Where a tier is missing, use the
   fallbacks in section 4, or send the campaign back to the Director.
5. Decide which missing assets may be generated. Generate them, or fall back.
6. Run `node packages/schema/bin/validate.ts campaign.json`, which passes `sceneRegistry`. It must
   report no `CONTRAST_LOW` and no `ASSET_UNDECLARED`.
7. Write your report.

## 1. Style family

The family is not a field in `campaign.json`. The renderer derives it from the background's
lightness with the same thresholds, so your job is to make the colours land cleanly on one side.

| Background `L` (OKLCH) | Family                    | Signature                                                                                                                                    |
| ---------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `L >= 0.90`            | **Neutral Cut**           | One flat pale ground. Black type alternating with proof. Fixed slots. Rationed colour: one saturated event, past 60% of runtime              |
| `L <= 0.22`            | **Kinetic Plate**         | Oversized type slams on a moving dark gradient plate. One lit element at a time. The plate carries the saturation and the type stays neutral |
| Between                | Mid-tone: fix it (step 2) | A mid-tone ground fails contrast in both families                                                                                            |

Compute `L` from the hex: convert each channel to linear sRGB (`c / 12.92` when
`c <= 0.04045`, else `((c + 0.055) / 1.055) ** 2.4`), then

```text
l = cbrt(0.4122214708 r + 0.5363325363 g + 0.0514459929 b)
m = cbrt(0.2119034982 r + 0.6806995451 g + 0.1073969566 b)
s = cbrt(0.0883024619 r + 0.2817188376 g + 0.6299787005 b)
L = 0.2104542553 l + 0.7936177850 m - 0.0040720468 s
```

Checks: `#FFFFFF` is 1.0, `#808080` is 0.600, `#0B1020` is 0.177.

**Set pieces, sparingly.** Continuous Diagram (`status-relay`) and Cell World (`cell-type`,
`iso-chain`, `rail-words`) are never whole-film skins. They appear only as the scenes the Long
template already holds: at most one set piece (`cell-type` or `iso-chain`) per film. Showpiece
transitions stay within the Director's limits: Short 2, Standard 3, Long 4 (Short and Long are
new defaults, not from the reference spec).

## 2. Colour that survives any brand

Only the ground, one accent and the logo change between brands. Structure, timing, curves, type
sizes and accent rationing stay fixed.

| Token    | From                      | Rule                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| -------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ground` | `brand.colors.background` | Neutral Cut needs `L >= 0.90`, Kinetic Plate `L <= 0.22`. A mid-tone background becomes the page surface the Researcher measured (`brand_details.measured`, `seen_as: surface`) nearest it in lightness in the family it leans to. Only when there is none does it become `color-mix(in oklch, primary 3%, white)` or `color-mix(in oklch, primary 3%, #0b0b0b)`, flagged for a person, since Quality Check refuses a colour the site does not have |
| `ink`    | `brand.colors.foreground` | At least 4.5:1 on the ground. Else use `readableOn(ground)`                                                                                                                                                                                                                                                                                                                                                                                         |
| `accent` | `brand.colors.primary`    | At least 3:1 on the ground. Below that, the measured colour nearest it that clears 3:1; with none, its lightness moved the least that clears it, flagged. The schema has one primary, so the original is not kept for fills                                                                                                                                                                                                                         |
| `muted`  | `brand.colors.muted`      | Used for subheads and labels only when it clears 4.5:1, else they fall back to `ink`                                                                                                                                                                                                                                                                                                                                                                |
| `plate`  | Kinetic Plate             | Three-stop `radial-gradient(in oklch, ...)`: L 0.12, then `primary` with L clamped to 0.45 or less, then `accent` (or `primary` at L 0.30). Its centre drifts on the absolute frame. If `primary` and `accent` clash, drop `accent` and ramp `primary` lightness only                                                                                                                                                                               |
| `event`  | `colour-event`            | Full-bleed `primary`. A very dark or pale primary reads as nothing: then use a field from the plate ramp, which counts as generated (step 5)                                                                                                                                                                                                                                                                                                        |

**Lean, for a mid-tone ground.** Light-leaning when the site's own hero section has a light
background, dark-leaning when dark. If the capture cannot tell, take the side where `ink` has the
higher contrast.

| Rule                             | Value                                                                                                                                                                                                                          |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Accents                          | One per section. At most one accent phrase per scene, and none on `colour-event`                                                                                                                                               |
| Light budget                     | `light.rim`, `light.sweep` and `ground.bloom` spend that one accent and never add a colour                                                                                                                                     |
| Categorical hues                 | Only in a Cell World set piece: up to 3 extra hues derived in OKLCH from `primary` at matched lightness, each bound to one concept for the whole film and introduced with a label and swatch. Never reused for another concept |
| Neutral Cut colour event         | One full-bleed shot, 2.3 s at most, past 60% of runtime. Everything else near-neutral                                                                                                                                          |
| Shadows                          | Soft contact shadows only, or none                                                                                                                                                                                             |
| Grain                            | None on flat grounds                                                                                                                                                                                                           |
| A brand gradient of many colours | Cannot be reduced to one accent without a human choice. Pick `primary`, and flag it in the report                                                                                                                              |

## 3. Type and logo

| Rule         | Value                                                                                                                                                                                                                                                                    |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Families     | One display family, from `brand.fonts.display`. Labels use `brand.fonts.body`                                                                                                                                                                                            |
| Style        | Neo-grotesque, medium to semibold, sentence case, tight tracking                                                                                                                                                                                                         |
| Sizes        | Sentence cap height at least 78 px at 1080 (7.2% of frame height). Display cap 2.7 times that, about 211 px. Sizes come from cap height, not font size                                                                                                                   |
| Lines        | At most 2. Static lines at most 65% of frame width                                                                                                                                                                                                                       |
| Hierarchy    | Colour or size, never a second weight                                                                                                                                                                                                                                    |
| Font licence | A captured font with an unknown licence, a failed capture, a pixel font, or a web font too poorly drawn for display size: fall back to an open-licensed neo-grotesque such as Inter (OFL-1.1), declared as a `font` asset with `provenance: "library"` and its `license` |
| Logo         | Vector preferred. A raster logo never renders above its natural pixel size. Never generate, redraw or recolour a logo                                                                                                                                                    |
| Radius       | `brand.radius`, else 16 px at 1920. Square brands stay square                                                                                                                                                                                                            |

## 4. Real captured UI or rebuilt UI

Boiler Room starts from a public website: no login, no in-app UI, no design files, no seeded
account. So we cannot show the product working unless the customer already published that. Use the
highest tier available.

| Tier | Source                                                                               | Treatment                                                      | Status                                                                 |
| ---- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------- | ---------------------------------------------------------------------- |
| 1    | Product screenshots, images or demo video on the site                                | Crop to one idea. Frame, tilt with `camera.depth`, push        | Real                                                                   |
| 2    | Docs, changelog, code samples, pricing, integrations                                 | `site-hero`, `site-scroll`, cropped proof                      | Real, and often overlooked                                             |
| 3    | The marketing site itself                                                            | Real pages in a browser frame, on tilted planes, in tile walls | Real, but the site rather than the product                             |
| 4    | Abstract components from verified claims: chips, status lines, rails, greeked panels | `status-relay`, `feature-card`, `rail-words`                   | Illustrative. Abstract enough that nobody mistakes it for a screenshot |
| 5    | Generated                                                                            | Backgrounds, texture, illustrative objects only                | Illustrative                                                           |

**Use captured UI** (tiers 1 to 3) for every scene that shows the product or the site:
`site-hero`, `site-scroll`, `tile-wall`, and `feature-card` when a crop shows the feature. Crop,
never redraw: one idea per shot, because full-window shots are unreadable. Capture at device scale
2 or more, with DOM boxes, so a scene can push in on a real button or heading.

**Use rebuilt UI** (tier 4) only when no capture shows the idea, and only as greeked abstraction:
grey bars for text, no numerals, no brand-styled fake screens. Any numeral comes from
`scene.text` with a cited claim. Tier 4 scenes must be shown to the customer at script approval.

| Never                                                                                |     |
| ------------------------------------------------------------------------------------ | --- |
| A fake dashboard, fake data rows, a fake customer name or testimonial                |     |
| A cursor on anything but a real captured page, or one that implies an in-app flow    |     |
| A logo wall of companies the customer's site does not show, or any rival's logo      |     |
| A static screenshot: every product layer keeps moving (push, scroll, drift or sweep) |     |

**Fallbacks** when a tier is missing:

| Missing                                     | Do                                                                                                                               |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Fewer than 6 captured tiles for `tile-wall` | Send the campaign back to the Director, citing the substitution in `director-beat-templates`. Never swap a scene that needs copy |
| No crop for a feature                       | Tier 4 greeked demo in the `feature-card`                                                                                        |
| No second page for `site-scroll`            | Use a tier 2 page: docs, pricing, changelog                                                                                      |

## 5. Generating missing assets

Generate only what tier 5 allows: a background field, a texture, or an illustrative object. Never
generate a logo, a UI screen or anything that looks like one, a product photo, a person, a
customer, text, or numbers. A generated asset must never stand in for proof.

| When                                                            | What                                                        | Where it goes                     |
| --------------------------------------------------------------- | ----------------------------------------------------------- | --------------------------------- |
| The primary reads as nothing on `colour-event`                  | A field built from the plate ramp                           | `colour-event` `assetIds[0]`      |
| `iso-chain` has a hero object and no captured texture           | One abstract texture for the hero's faces                   | `iso-chain` `assetIds[0]`         |
| A Kinetic Plate film needs more depth than the code plate gives | A soft abstract background in the brand's ground and accent | Behind the plate, never over type |

**How.** Prompt in the brand's ground and accent only, abstract, no text, no letters, no digits,
no logos, no UI, no people. Inspect the result frame by frame for stray glyphs before you declare
it.

**In the Naive pipeline** (`pnpm art`, `agents/src/art/`) code does this part, so no model can
spend on images. It generates the first two rows only: the third has no slot in the schema yet.
"Reads as nothing" means the primary's OKLCH `L` is 0.25 or less, 0.90 or more, or its chroma is
under 0.04 [N]. Code writes the prompt, uses Naive image generation, and stops at 2 images or
$0.10 per film, whichever comes first. You inspect each image with `view_image` and accept or
reject it; only an accepted image is declared. A rejected or capped image leaves the code-built
field for `colour-event` and `iso-chain` untextured. Code also sets the colours (sections 1 and 2),
checks fonts and the logo (section 3) and ranks the assets (section 4); you review its ranking in
small batches, one session each, with at most 4 pictures in one `view_image` call.

**Label it.** Every generated asset is declared like this, and listed in your report:

```json
"event-field": {
  "kind": "image",
  "src": "naive://files/fil_...",
  "provenance": "generated",
  "license": "Generated for this campaign. Not a capture.",
  "width": 1824,
  "height": 1024
}
```

`provenance: "generated"` is the schema's label: Quality Check and the dashboard read it. The file
lives in Naive files, like the Researcher's captures, and `pnpm art` saves a copy under
`assets/generated/` beside the campaign. No `sourceUrl`: it was not taken from the site.

## Report

End with a short report the next agents and the customer can read.

| Section          | Contents                                                           |
| ---------------- | ------------------------------------------------------------------ |
| Family           | `Neutral Cut` or `Kinetic Plate`, with the background `L`          |
| Colour changes   | Every brand colour you changed, old and new hex, and why           |
| Contrast         | `ink` and `accent` against the ground, as ratios                   |
| Fonts            | Captured or fallback, with licence                                 |
| Assets per scene | Scene id, asset ids, tier                                          |
| Tier 4 scenes    | Listed for the customer's approval                                 |
| Generated assets | Asset id, what it is, which scene uses it                          |
| Sent back        | Row, the substitution the Director should make, and why            |
| Flags            | Anything a human must decide, such as a many-colour brand gradient |
