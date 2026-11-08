# @boiler-room/motion

Remotion templates that render a validated `campaign.json` as a film, in 16:9, 9:16 or 1:1, for
any brand. The templates are scene types of the scene library in `docs/motion/scenes`, built to
those files and to the measured values of `docs/motion/reference-spec.md`.

## How a film is made

`<CampaignFilm>` takes a campaign, a format, a hook id and a CTA id. Its `calculateMetadata`:

1. runs `validateForRender`: `validateCampaign` against the schema's `sceneRegistry` restricted to
   the types this package has templates for, and throws on `!ok`. A type the library specifies
   that has no template yet is refused as `SCENE_TYPE_UNBUILT`, naming it and the types that
   render;
2. runs `validateFilm`, for the rules only the templates know: props each template accepts, copy
   each one sets, the images it needs, transitions that exist and have something to move, an end
   card long enough to finish its build before its hold, and the format, hook and CTA chosen;
3. resolves the hook and CTA into an ordinary campaign with `resolveCut`, and validates that again,
   since choosing a CTA changes copy;
4. loads both brand fonts, and refuses one that is missing, corrupt or blocked, naming it;
5. loads the scene images and the logo to learn their size, whether the logo can be seen, and
   whether either animates. An animated GIF, APNG, WebP, AVIF or SVG plays on the browser's clock,
   not the film's, so a scene image that animates, or whose bytes its host will not let be read, is
   refused, and such a logo is replaced by the wordmark. A scene image outside 1:3 to 4:1, such
   as a full-page capture, or one the scene would enlarge more than 1.5 times by its last frame in
   this format, is refused with the size to supply instead. A `site-hero` needs a capture at device
   scale 2, as its scene file says;
6. plans the film with `planFilm`: frame numbers from `sceneFrames`, the format's size, and the
   transitions overlaid on scene boundaries.

A throw at any step stops `remotion render` and `remotion still`. The error lists every issue with
the change that fixes it, all on its first line, since that is the only line Remotion prints of an
error thrown in the page. `FilmRejected.report` has the same list one issue a line.

## Rules the templates keep

- Every frame is a pure function of its number. `scripts/determinism.ts` checks it: in one tab, in
  fresh pages, and across several tabs at once, with fixtures for one family name over two font
  files, an animated product image and an animated logo.
- Each font role is registered under a family of its own, so a display and a body file the brand
  gives one family name never compete for the same text.
- Transforms are 2D. Chrome chooses the raster scale of a 3D-transformed layer (`perspective`,
  `rotateX`) from the frames rendered before it, so a 3D tilt made a frame's pixels depend on the
  render order. The determinism check caught this, and the browser frame now opens with a 2D rise.
- A browser frame sits on whole pixels. Chrome reuses a blurred shadow it drew at one sub-pixel
  offset for the next frame, so a moving frame's shadow depended on the frames before it.
- The determinism check compares bytes. When a frame differs, it saves both images and says how
  many pixels changed and by how much: a level or two on a few edge pixels is Chrome raster
  variance, while a history bug in a template moves whole shapes.
- Copy comes only from `scene.text`, so numbers do too. Props are parameters such as a focus box.
  The browser frame's address bar shows a `site-hero`'s `label` text, and is empty otherwise.
- Colours, fonts, radius and logo come from `campaign.brand`. A muted colour that cannot be read is
  replaced with a readable mix, an accent that would vanish falls back to primary, and a logo that
  is missing, too small, the wrong shape, animated, unreadable or mostly invisible on the
  background is replaced by the brand name set in the display font. A logo on an opaque box of one
  colour, such as a JPEG's white, is judged by the ink on the box and drawn as a plate with the
  brand's corners.
- Copy reads in its own direction. A block takes the direction of its first letter, and the
  `word-slam`, which places each word itself, lays a right-to-left sentence out from the right, so
  Hebrew and Arabic read right to left and each word keeps its own direction.
- Layouts are computed from the composition size, never from a format name. Type is sized from
  cap height, as the scene files say: the ink of "H" in the loaded font is measured once, and copy
  is set at the spec's cap height, `capS` for a sentence and `capD` for a display word. Text is
  measured with `@remotion/layout-utils` and only ever made smaller to fit. Lines break at spaces,
  after a hyphen inside a compound, and between words of Chinese, Japanese and Thai
  (`Intl.Segmenter`), never before closing punctuation. A word that would still be set below a
  third of its size is broken between its characters.
- Motion is in spec frames, frames at 30 fps, as every measured value is. `core/curves.ts` converts
  in one place, so a 24 fps campaign keeps the same timing in seconds and decays at the same speed.
  Type never springs or overshoots: words pop in and rise on `wordRise`, and only a UI node uses
  `spring.pop`.
- Transitions take no timeline time. Each scene is mounted for its own frames plus the frames it
  shares with a neighbour, so the film keeps the length the campaign gives it.

## Layout

| Path               | Contents                                                           |
| ------------------ | ------------------------------------------------------------------ |
| `src/tokens.ts`    | The spec's measured scene values; provisional transition timings   |
| `src/core/`        | The spec curves, presence, scene timing, stagger, camera poses     |
| `src/brand/`       | Theme from `campaign.brand`, logo checks, font loading             |
| `src/layout/`      | Stage and safe areas, text fitting                                 |
| `src/scenes/`      | The four templates, registered under the schema's scene type names |
| `src/transitions/` | Timeline, push, shared-element carry                               |
| `src/film/`        | `<CampaignFilm>`, `calculateMetadata`, the render gate, planning   |
| `src/root.tsx`     | Remotion entry point                                               |
| `scripts/`         | Stills, full renders, the determinism check                        |

## Scenes

The schema's `sceneRegistry` is the one list of scene types and their text limits. This package
registers a template against four of its names in `src/scenes/registry.ts`, exports them as
`IMPLEMENTED_SCENE_TYPES`, and renders only those. Each template sets the roles its scene file
lists, and `validateFilm` checks the counts.

| Type           | Copy                                                | Props                       | Image                           |
| -------------- | --------------------------------------------------- | --------------------------- | ------------------------------- |
| `word-slam`    | `headline`, the hook sentence; its first word slams | `accent`                    | none                            |
| `site-hero`    | optional `label`, the URL in the address bar        | `frame: 'browser'`, `focus` | 1 captured page, device scale 2 |
| `feature-card` | `headline`, up to 2 `label`s, the cause and effect  | `demo`, `accent`            | 0 to 2 crops, else chips        |
| `end-card`     | `cta`, optional `label`, the URL                    | `urlReveal`                 | none, shows the logo            |

An `end-card` holds still for its last 69 spec frames, and its logo and URL must be in place on the
frame before. The schema allows a 38-character URL, the Standard limit, but how much of it fits
depends on the card's length and reveal: a 95-frame Short card decodes 20 characters, and a
113-frame card decodes 38 or types 16. `validateFilm` refuses a card too short for its URL or
logo as `SCENE_TOO_SHORT`, naming the longest URL that fits and the length that fits this one.

`site-hero` refuses `frame: 'plane'`, `layers` and `activeLayer` as not built: plane mode tilts the
page in 3D, which the determinism check has shown makes a frame depend on render order. Its focus
blur and light sweep are not built either. Every other type in the library is refused by the
render gate until it has a template.

Transitions: `push`, and `carry`, which moves the product image between two scenes that show it,
or else the brand mark. Only `word-slam` and `end-card` draw the mark, so a carry between scenes
that share no image needs both to be one of those, and `validateFilm` refuses any other as
`TRANSITION_EMPTY`. A cut keeps both scenes as they are to the boundary, as the spec's
dead-stop cut does. The spec's transition catalog is not built yet.

## Commands

```sh
pnpm test                    # unit tests of the pure functions
pnpm typecheck
pnpm studio                  # Remotion Studio, with the examples as the public folder
pnpm stills                  # stills of both examples in every format, into out/stills
pnpm render -- --campaign nova.campaign.json --format 9:16
pnpm determinism             # renders sampled frames three times: in order, shuffled, in parallel
pnpm text-direction          # checks that Hebrew and Arabic headlines read right to left
```

Routine renders are silent.

## Licences of what this uses

| What                                                                              | Licence                                                                |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `@remotion/layout-utils`, `@remotion/fonts`, `@remotion/paths`, `@remotion/noise` | MIT                                                                    |
| `remotion`, `@remotion/cli`, `@remotion/bundler`, `@remotion/renderer`            | Remotion License, which needs a company licence for some organisations |
| Easing values in `src/tokens.ts`, from IBM Carbon `@carbon/motion`                | Apache-2.0                                                             |
| Example fonts Sora, Inter, Fraunces, Source Serif 4, from Fontsource              | OFL-1.1, licence files beside each font                                |
