# @boiler-room/motion

Remotion templates that render a validated `campaign.json` as a film, in 16:9, 9:16 or 1:1, for
any brand.

## How a film is made

`<CampaignFilm>` takes a campaign, a format, a hook id and a CTA id. Its `calculateMetadata`:

1. runs `validateCampaign` with this package's `sceneRegistry`, and throws on `!ok`;
2. runs `validateFilm`, for the rules only the templates know: props each template accepts, copy
   each one sets, the images it needs, transitions that exist, and the format, hook and CTA chosen;
3. resolves the hook and CTA into an ordinary campaign with `resolveCut`, and validates that again,
   since choosing a CTA changes copy;
4. loads the scene images and the logo to learn their size, and whether the logo can be seen;
5. plans the film with `planFilm`: frame numbers from `sceneFrames`, the format's size, and the
   transitions overlaid on scene boundaries.

A throw at any step stops `remotion render` and `remotion still`. The error lists every issue with
the change that fixes it.

## Rules the templates keep

- Every frame is a pure function of its number. `scripts/determinism.ts` checks it.
- Transforms are 2D. Chrome chooses the raster scale of a 3D-transformed layer (`perspective`,
  `rotateX`) from the frames rendered before it, so a 3D tilt made a frame's pixels depend on the
  render order. The determinism check caught this, and the browser frame now opens with a 2D rise.
- Copy comes only from `scene.text`, so numbers do too. Props are parameters such as a focus point.
  The browser frame draws an empty address bar, since a URL would be copy.
- Colours, fonts, radius and logo come from `campaign.brand`. A muted colour that cannot be read is
  replaced with a readable mix, an accent that would vanish falls back to primary, and a logo that
  is missing, too small, the wrong shape or mostly invisible on the background is replaced by the
  brand name set in the display font.
- Layouts are computed from the composition size, never from a format name, and a browser frame is
  always sized to show its whole image. Text is fitted to its box with `@remotion/layout-utils`
  and is only ever made smaller to fit.
- Transitions take no timeline time. Each scene is mounted for its own frames plus the frames it
  shares with a neighbour, so the film keeps the length the campaign gives it.

## Layout

| Path               | Contents                                                               |
| ------------------ | ---------------------------------------------------------------------- |
| `src/tokens.ts`    | Durations, easing, springs, stagger. Provisional until the motion spec |
| `src/core/`        | Presence, scene timing, stagger, camera poses                          |
| `src/brand/`       | Theme from `campaign.brand`, logo checks, font loading                 |
| `src/layout/`      | Stage and safe areas, per-scene layouts, text fitting                  |
| `src/scenes/`      | The scene registry and the four scenes                                 |
| `src/transitions/` | Timeline, push, shared-element carry                                   |
| `src/film/`        | `<CampaignFilm>`, `calculateMetadata`, `validateFilm`, planning        |
| `src/root.tsx`     | Remotion entry point                                                   |
| `scripts/`         | Stills, full renders, the determinism check                            |

## Scenes

| Type               | Copy                                        | Props           | Image                |
| ------------------ | ------------------------------------------- | --------------- | -------------------- |
| `kinetic-title`    | headline, optional subhead and label        | `align`         | none                 |
| `interface-reveal` | headline, optional subhead, body and label  | `focus`, `zoom` | captured or uploaded |
| `feature-sequence` | headline, then up to four features          | `stops`         | optional             |
| `cta`              | headline, `cta`, optional subhead and label | none            | none, shows the logo |

Transitions: `push`, and `carry`, which moves the product image between two scenes that show it,
or the brand mark otherwise.

## Commands

```sh
pnpm test                    # unit tests of the pure functions
pnpm typecheck
pnpm studio                  # Remotion Studio, with the examples as the public folder
pnpm stills                  # stills of both examples in every format, into out/stills
pnpm render -- --campaign nova.campaign.json --format 9:16
pnpm determinism             # renders sampled frames twice, the second time shuffled
```

Routine renders are silent.

## Licences of what this uses

| What                                                                              | Licence                                                                |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `@remotion/layout-utils`, `@remotion/fonts`, `@remotion/paths`, `@remotion/noise` | MIT                                                                    |
| `remotion`, `@remotion/cli`, `@remotion/bundler`, `@remotion/renderer`            | Remotion License, which needs a company licence for some organisations |
| `lucide-react` (the cursor)                                                       | ISC                                                                    |
| Easing values in `src/tokens.ts`, from IBM Carbon `@carbon/motion`                | Apache-2.0                                                             |
| Example fonts Sora, Inter, Fraunces, Source Serif 4, from Fontsource              | OFL-1.1, licence files beside each font                                |
