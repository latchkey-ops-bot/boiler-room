---
name: quality-check
description: Reviews a rendered Boiler Room film against measurable pass and fail criteria (contact sheet, frames around every transition, phone-size legibility, brand match, claims match, timing, holds and audio) and writes a review report. Never approves a film without inspecting real rendered frames.
---

# Quality Check

You decide whether a rendered film ships. You check the real render against the numbers below,
open the frames yourself, and write a report the other agents can act on. You never edit the
campaign or the render.

**Nothing is approved without inspecting real rendered frames.** "Real" means frames extracted
from the exact file that will be delivered, rendered from the exact `campaign.json` under review.
A `campaign.json`, a Studio preview, a storyboard, a still from an earlier render, or another
agent's description of the film is not evidence. If you have not opened the frames, the verdict
is `blocked`.

Sources: `docs/motion/reference-spec.md` section 10, `docs/motion/transitions.md` (the QC frames
for each transition) and the acceptance stills in each `docs/motion/scenes/<type>.md`.

## Inputs

| Input                                              | Use                                                                                  |
| -------------------------------------------------- | ------------------------------------------------------------------------------------ |
| The rendered file                                  | The only source of frames and audio                                                  |
| The `campaign.json` it was rendered from           | Scene list, text, claims, assets, `transitionOut`                                    |
| `sceneFrames(campaign)` from `@boiler-room/schema` | The frame of every scene and seam. Never compute `seconds * 30`                      |
| The scene files in `docs/motion/scenes/`           | `markLegibleAt` per `logo-reveal` mode, each scene's kind, and its acceptance stills |

## Procedure

1. **Gate.** Run `node packages/schema/bin/validate.ts campaign.json`, which passes
   `sceneRegistry`. It must report `ok: true` with no `CLAIM_SUPERLATIVE` warning. Hash the
   render file (sha256). Otherwise stop: `blocked`.
2. **Probe.** The render must be 1920 x 1080 (or 3840 x 2160) at 30 fps, with exactly
   `sceneFrames(campaign).durationInFrames` frames and an audio stream.
3. **Extract.** Pull the contact-sheet frames, the seam frames and the acceptance stills listed
   below as PNG files. Open and look at every one.
4. **Measure.** Run the per-frame measures: static runs, true black, saturation, loudness.
5. **Judge.** Fill every check in the tables below with `pass`, `fail` or `n/a`, the measured
   value and the frames it rests on. A check passes only on frames you looked at: one you could
   not see, such as a seam with no frames extracted, is `n/a` or `fail`, never `pass`.
6. **Report.** Write the report in the format at the end.

### Commands

```sh
# Probe: size, rate, decoded frame count
ffprobe -v error -count_frames -select_streams v:0 \
  -show_entries stream=width,height,r_frame_rate,nb_read_frames -of json film.mp4

# One frame by index (0-based)
ffmpeg -v error -i film.mp4 -vf "select=eq(n\,105)" -frames:v 1 f0105.png

# Contact sheet: list the frame indexes, 6 across (older ffmpeg: -vsync vfr)
ffmpeg -v error -i film.mp4 -vf "select='eq(n\,0)+eq(n\,105)+eq(n\,173)',scale=480:-2,tile=6x4" \
  -fps_mode vfr -frames:v 1 contact.png

# Phone size: 360 px wide
ffmpeg -v error -i f0276.png -vf "scale=360:-2:flags=area" f0276-phone.png

# Static-run input: 320x180 area-scaled RGB, one frame after another on stdout
ffmpeg -v error -i film.mp4 -vf "scale=320:180:flags=area,format=rgb24" -f rawvideo - > frames.rgb

# Loudness: short-term (S), integrated (I) and true peak
ffmpeg -nostats -i film.mp4 -filter_complex ebur128=peak=true -f null -

# Saturation per frame
ffmpeg -v error -i film.mp4 -vf "signalstats,metadata=print:key=lavfi.signalstats.SATAVG" -f null -
```

**MAD** for frame `n` is the mean absolute difference between frame `n` and frame `n - 1` over
every byte of `frames.rgb` (320 x 180 x 3 bytes a frame), in 8-bit levels. A frame is **static**
when its MAD is below 0.02.

## Contact sheet

One sheet per film: frame 0, each scene's main acceptance still (its rest frame from the scene
file), and the last frame. Label every tile with its absolute frame and scene id.

| Check                 | Pass                                                                                                      |
| --------------------- | --------------------------------------------------------------------------------------------------------- |
| Frame 0               | Content on screen: pixel variance above 0. Not blank, not a poster that then disappears                   |
| One idea per shot     | Each still reads as its scene type with one subject. No full-window screenshots                           |
| No invented product   | No dashboard, data rows, customer name, testimonial or logo that is not in the campaign's captured assets |
| No reference material | Nothing resembling a reference film's brand, copy, palette or footage                                     |
| Sequence              | Scenes appear in `campaign.scenes` order, the first surface by frame 210, a quiet end card last           |

## Transitions

For every seam `S = sceneFrames(...).scenes[i + 1].from`, extract the QC frames that
`docs/motion/transitions.md` lists for that scene's `transitionOut`. Those cover before (the
outgoing ramp), during (`S - 1`, `S`, `S + 1`) and after (the incoming settle frame). Lay each
seam's frames out as one strip.

A film rendered in chunks and stitched has a chunk seam every `framesPerChunk` frames (in the
render manifest), where render faults cluster: extract `C - 1` and `C` for every chunk seam `C`.
Code measures every frame for empty ground and for flashes (a run of up to 12 frames that jumps
away from the picture and back); extract the frame before and the first frame of every run it
flags too, and look at each pair.

| Check             | Pass                                                                                                                                                                                                                                                                        |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No cross-dissolve | No frame shows the outgoing and incoming content both at partial opacity. Allowed exceptions: the single overlap frame of `t4`, the overlays of `t12` and `t14`, and the black of `t16`                                                                                     |
| No blank flash    | `S` is not empty ground, except after `t5` (exactly 2 frames of uniform ground, 5 for a chapter blink into a pivot) and inside `t16`                                                                                                                                        |
| Chunk seams       | At every chunk seam `C`, frame `C` continues `C - 1`: no jump in layout, colour or content. No flagged frame shows copy, a number or a picture its scene does not hold                                                                                                      |
| `t1`              | The outgoing element moves into the cut and the incoming one moves on from it on the same axis, in the same direction. Declared velocities within 1.5x of each other                                                                                                        |
| `t3`              | `S - 1` is not frozen. `S` already shows incoming motion, the first word up and rising                                                                                                                                                                                      |
| `t5`              | Uniform ground on the blank frames: no pixel more than 2 levels from the ground colour. The returning headline is soft on its first frame, sharp 3 frames later, at the same pixel position as the card before                                                              |
| `t16`             | At least 4 frames with maximum pixel at most 12/255. Only at a ground change                                                                                                                                                                                                |
| Seam mix          | `count(t3)` in `[floor(s / 3), ceil(s / 3)]`. Showpieces (`t6`, `t7`, `t12` to `t15`) at most Short 2, Standard 3, Long 4 (Short and Long are new defaults, not from the reference spec). Every limited id at most 3 times and never on adjacent seams, except pinned seams |
| Start in motion   | At `S`, the incoming scene shows motion: its MAD at the first non-blank incoming frame is 0.02 or more. After `t5`, the 2 (or 5) blank frames are exempt                                                                                                                    |

## Phone-size legibility

For each scene with text, take its rest frame and downscale it to 360 px wide.

| Check            | Pass                                                                                                                                                                                                                                                                                                                |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Words recovered  | OCR on the 360 px frame returns every word of each `scene.text` value at sentence size or larger, ignoring case and punctuation. The small slots listed under Story text are exempt. Without OCR, read it yourself and say so in the report                                                                         |
| Cap height       | On the full-size frame, the ink height of a capital is at least 78 px at 1080 (7.2% of frame height) for every headline, subhead, CTA and label that carries the story                                                                                                                                              |
| Lines            | At most 2 lines per text item, and each static line at most motion's line box: 65% of the frame width at 16:9, 86% at 9:16 and 80% at 1:1. Measure the 9:16 and 1:1 films against their own width, never 65%                                                                                                        |
| Story text       | No story-carrying text under sentence size. Under `capS` only: the end-card URL, the `site-hero`/`site-scroll` address pill, `feature-card` node labels, `proof-bars` bar names, `iso-chain` labels and `status-relay` chip labels. None of these carries the story, and each repeats words already shown at `capS` |
| Inside the frame | Every text box inside the safe area, except layers declared as bleed on their entry and exit frames. Each bleed word wholly inside the safe area for at least 10 consecutive frames                                                                                                                                 |

The end-card URL's default `decode` reveal shows letters shifted by up to 3 until each one resolves,
by its spec (`docs/motion/scenes/end-card.md`). Judge the URL on a frame after its last letter
resolves, and never report the shifted letters before it.

## Brand match

| Check                    | Pass                                                                                                                                                                                                                                                                                           |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ground                   | A ground-only patch of 20 x 20 px matches the campaign's `brand.colors.background` within 3 levels per channel (Neutral Cut), or sits on the derived plate (Kinetic Plate). Not on a `tile-wall`, whose tiles cover the frame but for narrow gutters, or a `colour-event`, whose ground is the primary or a generated field by its spec |
| Ink and accent           | Type in `brand.colors.foreground` (or its `readableOn` fallback). On Neutral Cut the only saturated hue outside the colour event is `brand.colors.primary`. On Kinetic Plate the plate's hues are allowed too. Inside a Cell World set piece, up to 3 keyed hues, each with a label and swatch |
| Logo                     | Matches the declared logo asset: same shape and colours, never stretched. A raster logo never shown above natural size                                                                                                                                                                         |
| Fonts                    | Display text in the brand display family, or the declared fallback                                                                                                                                                                                                                             |
| Accent ration            | At most one accent phrase per scene, the one `props.accent`, and none on `colour-event`. At most one lit element per shot                                                                                                                                                                      |
| Neutral Cut colour event | One full-bleed saturated stretch, starting at or after 60% of the film's frames, lasting 69 frames or fewer                                                                                                                                                                                    |
| Kinetic Plate            | The plate carries the saturation. Type stays neutral                                                                                                                                                                                                                                           |

## Claims match

| Check             | Pass                                                                                                                                                                                           |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Numbers on screen | Every number readable in any extracted frame appears in that scene's `scene.text`, and `validateCampaign` passed, so each is in a cited quote                                                  |
| Count-ups         | Only if the founder has approved them. From zero to exactly the cited value, rising only, final value held 30 frames or more                                                                   |
| Superlatives      | None on screen unless a cited quote states that superlative                                                                                                                                    |
| Voiceover         | If present, the spoken numbers match the cited quotes. Spot-check against the voiceover text                                                                                                   |
| Assets            | Captured assets are real pages of the customer's site. Generated assets have `provenance: "generated"`, show no text, digits, logos, UI or people, and are listed in the Art Director's report |
| Third parties     | No rival's logo. No third-party logo the customer's own site does not show                                                                                                                     |

## Timing and holds

| Check          | Pass                                                                                                                                                        |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Static runs    | No run of more than 30 consecutive static frames, except the end card's hold and one tension hold of up to 26 frames                                        |
| Product layers | Zero static frames inside `site-hero`, `site-scroll`, `tile-wall`, `feature-card`, `status-relay` and `rail-words`, except the blank frames of a `t5` entry |
| Mark deadline  | `90 + markLegibleAt <= 105`, and frame 105 shows the full logo: full scale, unmasked, unblurred                                                             |
| First hit      | A strong hit (the slam or the logo resolve) by frame 105, 3.5 s                                                                                             |
| First surface  | A real product surface on screen by frame 210, 7 s                                                                                                          |
| Card time      | Each `type-card` lasts `max(43, ceil(6.5 * words))` frames or more                                                                                          |
| Beats          | No scene under 15 frames. None over 120 except the end card or a set piece. Median scene length 51 to 72 frames (1.7 to 2.4 s)                              |
| End hold       | The end card's last 53 to 89 frames are static (target 69)                                                                                                  |
| Camera lock    | No product shot holds one framing for more than 120 frames (4 s)                                                                                            |
| Hero hold      | `proof-bars`: the lift starts at local frame 23, so 23 frames of hero (21 after a `t5` blink). Verdict held 25 frames before any exit                       |

## Audio

| Check      | Pass                                                                                                                                    |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Opening    | Short-term loudness at or below -24 LUFS over 0 to 3 s                                                                                  |
| Integrated | -14 LUFS, within 1 LU                                                                                                                   |
| True peak  | -1 dBTP or lower                                                                                                                        |
| End        | Music fades over the end card and ends between the last frame and 2 s before it                                                         |
| Effects    | At most Short 4, Standard 6, Long 8 (Short and Long are new defaults, not from the reference spec). No whoosh per cut, no typing clicks |
| Sound off  | Every idea reads with the sound muted. Nothing lives only in voice                                                                      |

## Report format

Write one JSON report, then a short summary in prose.

```json
{
  "campaignId": "fernhook-launch",
  "render": {
    "file": "out/fernhook-launch.mp4",
    "sha256": "…",
    "width": 1920,
    "height": 1080,
    "fps": 30,
    "frames": 750
  },
  "verdict": "changes-needed",
  "framesInspected": [
    { "frame": 0, "file": "qc/f0000.png", "why": "frame 0" },
    { "frame": 105, "file": "qc/f0105.png", "why": "mark deadline" }
  ],
  "checks": [
    {
      "id": "static-runs",
      "result": "pass",
      "measured": "longest run 9 frames at 612",
      "threshold": "30, except the end card",
      "frames": [612]
    },
    {
      "id": "phone-legibility",
      "result": "fail",
      "measured": "label 'A live preview per pull request' unreadable at 360 px",
      "threshold": "every word recovered",
      "frames": [451]
    }
  ],
  "issues": [
    {
      "severity": "major",
      "check": "phone-legibility",
      "sceneId": "proof",
      "frame": 451,
      "what": "Label renders at 39 px cap",
      "fix": "Render the stat-counter label at capS (78 px)",
      "owner": "motion"
    }
  ]
}
```

| Field             | Rule                                                                                                                                                                                                              |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `verdict`         | `approved` only when every check is `pass` or `n/a` and every listed frame was opened. `blocked` when there is no render, the campaign fails validation, or frames were not inspected. Otherwise `changes-needed` |
| `framesInspected` | Every frame you opened, with the file you opened and why                                                                                                                                                          |
| `checks`          | One entry per row in the tables above, with its measured value                                                                                                                                                    |
| `issues`          | One per failure. `severity` is `blocker` (claims, invented content, validation), `major` (any other failed check) or `minor` (taste, with no failed threshold)                                                    |
| `owner`           | Who fixes it: `director` (copy, claims, timing, seams), `art-director` (colour, assets, family), `motion` (a scene or transition not built to its file), `researcher` (a missing or wrong capture)                |
| `fix`             | What to change, specific enough to act on without asking                                                                                                                                                          |

Taste still matters after every threshold passes. Note it as `minor` issues, and never let it
override a failed check.
