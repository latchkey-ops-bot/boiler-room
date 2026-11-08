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
   each one sets, the images it needs, transitions that exist, and the format, hook and CTA chosen;
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
6. plans the film with `planFilm`: frame numbers from `sceneFrames`, the format's size, the skin
   and each scene's ground, and the transition the seam resolver chose for each boundary.

A throw at any step stops `remotion render` and `remotion still`. The error lists every issue with
the change that fixes it.

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
- The determinism check compares bytes, on frames spread over the film and on every transition's
  QC frames. One known difference is tolerated and reported: Chrome drawing a rounded corner one
  level apart in another tab, so a frame that differs by at most 1 level on at most 32 pixels
  passes with a note. Anything more fails, and both images are saved with how many pixels changed
  and by how much: a history bug in a template moves whole shapes.
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
- Transitions take no timeline time. Every built transition is drawn inside the two scenes it
  joins, so each scene is mounted for exactly its own frames and the film keeps the length the
  campaign gives it.
- The ground belongs to the film. The `Stage` draws it once, under every scene, on the film's
  clock, so a seam cuts the content and never the ground, and it stops where the end card holds.

## Layout

| Path               | Contents                                                           |
| ------------------ | ------------------------------------------------------------------ |
| `src/tokens.ts`    | The spec's measured scene values; provisional transition timings   |
| `src/core/`        | The spec curves, presence, scene timing, stagger, camera poses     |
| `src/brand/`       | Theme from `campaign.brand`, skin, logo checks, font loading       |
| `src/layout/`      | Stage size and safe areas, text fitting                            |
| `src/components/`  | Type, the brand mark, browser frame, `MorphBox`, `RisingWords`     |
| `src/scenes/`      | The five templates, registered under the schema's scene type names |
| `src/transitions/` | The catalog, the seam resolver, the seam wrapper, the timeline     |
| `src/film/`        | `<CampaignFilm>`, the `Stage`, the render gate, planning           |
| `src/root.tsx`     | Remotion entry point                                               |
| `scripts/`         | Stills, full renders, the determinism check                        |

## Scenes

The schema's `sceneRegistry` is the one list of scene types and their text limits. This package
registers a template against five of its names in `src/scenes/registry.ts`, exports them as
`IMPLEMENTED_SCENE_TYPES`, and renders only those. Each template sets the roles its scene file
lists, and `validateFilm` checks the counts.

| Type           | Copy                                                  | Props                       | Image                           |
| -------------- | ----------------------------------------------------- | --------------------------- | ------------------------------- |
| `word-slam`    | `headline`, the hook sentence; its first word slams   | `accent`                    | none                            |
| `site-hero`    | optional `label`, the URL in the address bar          | `frame: 'browser'`, `focus` | 1 captured page, device scale 2 |
| `feature-card` | `headline`, up to 2 `label`s, the cause and effect    | `demo`, `accent`            | 0 to 2 crops, else chips        |
| `stat-counter` | `headline`, the cited number; `label`, what it counts | `countUp: false`, `accent`  | none                            |
| `end-card`     | `cta`, optional `label`, the URL                      | `urlReveal`                 | none, shows the logo            |

`stat-counter` refuses `countUp: true`: count-ups wait for the founder, since a count-up shows numbers
no quote states. The count-up is built to its scene file and tested, so approving it means removing
that refusal. Its number is fitted to its box down to 0.13 W and its label is set at the sentence
cap height on at most two lines; copy that cannot be set that way stops the render with
`LAYOUT_UNFIT`, naming the scene and text id, rather than being set smaller. That check runs when
the scene renders, because nothing before the first frame measures copy yet.

`site-hero` refuses `frame: 'plane'`, `layers` and `activeLayer` as not built: plane mode tilts the
page in 3D, which the determinism check has shown makes a frame depend on render order. Its focus
blur and light sweep are not built either. Every other type in the library is refused by the
render gate until it has a template.

## Transitions

`transitionOut` is a catalog id from `docs/motion/transitions.md`, `t1` to `t17`. Anything else,
such as a fade, `push` or `carry`, is refused as `TRANSITION_UNKNOWN`. This package draws:

| Id   | Name                         | How                                                                                                                    |
| ---- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `t1` | Matched-velocity seam        | `SeamLayer`: `seamOut` on the outgoing anchor's last 11 frames, `seamIn` on the incoming one's first 14, and the carry |
| `t3` | Dead-stop cut into word rise | Nothing: the incoming scene plays its native entry from its first frame                                                |
| `t5` | Blink and rack               | The `Stage` draws only the ground for 2 frames, 5 for the chapter blink, then the scene racks its headline into focus  |

Those are every id the Short and Standard templates and their seam plans write, and both of the
resolver's fallbacks. The resolver in `src/transitions/resolve.ts` picks each boundary's id: a pin
first (into a pivot `type-card` is the T5 chapter blink), then the written id if it is legal for
the boundary and built, else T1 where both anchors move on one axis and sign within 1.5x, else
T3. `validateFilm` reports every boundary where the id played is not the one written, with both
scene ids, as a `TRANSITION_RESOLVED` or `TRANSITION_UNBUILT` warning. T6 and T7, the optional
showpieces into `colour-event`, wait for that scene and are resolved to T3 until then.

## Building a scene

A scene type is a `defineScene` entry in `src/scenes/registry.ts`, under its name in the schema's
`sceneRegistry`. Besides its component, props schema and roles, it declares:

- `kind` and `ground` per skin (`'neutral-cut'` and `'kinetic-plate'`), as its scene file says;
- `anchors`: each `{ id, entry?, exit?, colour?, box(f, request) }`. Velocities are data, or a
  function of props, so the resolver reads them before anything renders. `box` is the anchor's
  rect in frame pixels at spec frame `f`, from props, text and `specFit` only, never the DOM;
- `holdFrom`, for a scene that ends still, which stops the ground too.

Inside the component, `useSceneClock()` gives `f` and `dur` in spec frames, `abs`, `b` (blank
frames after a T5) and `inT` and `outT`, the ids the resolver chose. Wrap the anchor in
`<SeamLayer anchor="id">` and anything that travels with it in `<SeamLayer>`, and T1, including
the carry, is done. Play the native entry unless `inT === 't1'`, and rack the headline with
`blink(f, b)` after a T5. Type enters with `RisingWords` or a pop, never a fade.

## Commands

```sh
pnpm test                    # unit tests of the pure functions
pnpm typecheck
pnpm studio                  # Remotion Studio, with the examples as the public folder
pnpm stills                  # each scene settled and every transition's QC frames, into out/stills
pnpm render -- --campaign nova.campaign.json --format 9:16
pnpm determinism             # renders sampled and seam frames three times: in order, shuffled, in parallel
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
