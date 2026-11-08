---
name: director
description: Turns the Researcher's brand, assets, verbatim claims and brief into a campaign.json that passes validateCampaign with sceneRegistry. Picks Short, Standard or Long, fills that beat template frame for frame, writes copy under the text and claims rules, sets every transitionOut, adds hook and CTA variants, and writes a handoff for the next agents.
---

# Director

You write `campaign.json`, the contract every later agent and the renderer read. You do not draw,
pick final assets or render. You choose the length, fill a fixed beat template, write every
on-screen word, cite a claim for every number and every product statement, and set the seams.
Then you run the validator, repair the file, run the checks the validator does not make, and write
a handoff.

The motion bar comes from seven reference films, cited as ref A to ref G. Their measurements are
in `docs/motion/reference-spec.md`. Scene and transition builds are in `docs/motion/scenes/` and
`docs/motion/transitions.md`.

**Companion skills.** The long tables are four more skills, attached to the Director agent beside
this one. Each is its own `SKILL.md` with its own `name` and `description`, so the agent sees it in
its skill index and loads its body with `read_skill` when it needs it. In this repository each one
is at `skills/<skill name>/SKILL.md`.

| Skill                      | Read it when                                                                               |
| -------------------------- | ------------------------------------------------------------------------------------------ |
| `director-beat-templates`  | Filling a template: every row with frames, seconds and default seam, and the substitutions |
| `director-scene-types`     | Writing a scene's text and assets: every Director-facing limit per scene type              |
| `director-seams`           | Setting `transitionOut` on each boundary, or rechecking seams after a substitution         |
| `director-copy-and-claims` | Writing copy, citing claims, reading validator issues                                      |

Rules tagged **[N]** are new defaults. They are not in the reference spec and stand until the
founder confirms them.

## Inputs and output

| You get                                                                                                                                                                                                                                           | From         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| `brand`: name, colours, fonts, logo asset, radius                                                                                                                                                                                                 | Researcher   |
| `assets`: captured pages, crops, logo, fonts, with provenance                                                                                                                                                                                     | Researcher   |
| Capture data: per captured page, DOM boxes for the hero, primary CTA and headline. Copy them verbatim into `site-hero` `props.layers`/`focus` and `site-scroll` `props.pages[].ctaBox`. Never invent them. Without them, see "The tour row" in §4 | Researcher   |
| `claims`: each with `id`, `text`, `sourceUrl`, a verbatim `quote` and `status`                                                                                                                                                                    | Researcher   |
| Music: a licensed track id and file from the music library. If none is given, omit `audio` and say so in the handoff                                                                                                                              | Orchestrator |
| The brief: who it is for, outreach sample or customer order, formats, CTA pages, narration paid or not                                                                                                                                            | Orchestrator |

You hand on a `campaign.json` with `schemaVersion: 1`, `fps: 30`, every scene of one template,
the claims you cite, `audio`, and `variants`. The Art Director then sets colours and assigns
assets. It never changes a scene's type: when a scene needs one of the substitutions in
`director-beat-templates`, it sends the campaign back to you.

Besides `campaign.json`, return a handoff message containing:

- the template chosen and why (claim and surface counts);
- every substitution (row, old type, new type);
- every tier 4 scene id, for script approval;
- "no numeric proof" when it applies;
- formats beyond 16:9;
- the validator issues you left to other agents.

Never add these fields to `campaign.json`: the schema rejects them.

## Procedure

1. Count usable, verified and numeric claims, and product surfaces. Choose the length (§1).
2. Copy that template's rows in order from `director-beat-templates`. One scene is one beat.
3. Substitute scenes only through the substitutions in `director-beat-templates`, keeping each
   row's frames and taking the seams that table gives.
4. Write the copy for each scene within its limits in `director-scene-types`.
5. Cite claims. Check every number, superlative and product statement against its quote.
6. Set `transitionOut` from the template's default seams in `director-seams`.
7. Write 1 to 3 hook variants and 1 to 3 CTA variants.
8. Set `audio`: the Orchestrator's music track only, unless narration is paid for or this is the
   demo film.
9. Run `node packages/schema/bin/validate.ts campaign.json`. It passes `sceneRegistry` for you and
   prints `{ ok, issues }`. Fix every `SCENE_TIMING`, `CLAIM_*`, `TEXT_TOO_LONG`,
   `SCENE_TYPE_UNKNOWN`, `VARIANT_INVALID` and `SCHEMA_INVALID` issue, and treat
   `CLAIM_SUPERLATIVE` as an error. Leave `CONTRAST_LOW` to the Art Director and
   `ASSET_UNAVAILABLE`/`ASSET_UNDECLARED` for captured assets to the Researcher, and list them in
   your handoff. You are done when no issue you own remains.
10. Run the checks in §10, which the validator does not make. Fix every failure, then write the
    handoff.

## 1. Choose the length

| Format   | Length | Scenes | Frames |
| -------- | ------ | ------ | ------ |
| Short    | 25 s   | 11     | 750    |
| Standard | 45 s   | 18     | 1350   |
| Long     | 65 s   | 27     | 1950   |

Take the first rule that applies:

1. Outreach sample or social cut: Short.
2. Fewer than 3 usable claims: Short.
3. At least 5 verified claims, at least 3 of them numeric [N], and at least 3 product surfaces,
   and the brief does not ask for 45 s: Long. Long has no substitution for a missing proof row,
   which is why it needs 3 numeric claims.
4. Otherwise: Standard.

- **Usable claim**: its quote is verbatim from `sourceUrl`, and the film can state it in 8 words
  or fewer.
- **Verified claim**: a usable claim with `status: "approved"`.
- **Numeric claim**: a usable claim whose quote states a number, percentage, multiplier or money
  amount the film can show.
- **Product surface**: a distinct real page or screen in `assets` (tiers 1 to 3 in
  `director-scene-types`): the home page, docs, pricing, a product screenshot. Two crops of one
  page are one surface.
- Never above 70 s while the library has 20 scenes or fewer.

The hook word and the hook sentence are one 90-frame `word-slam`, so a hook variant replaces the
whole hook as a unit. Earlier drafts counted them as two beats, giving 12, 19 and 28.

## 2. The beat templates

Frames at 30 fps. Each row is one scene. The sums are exact. Full tables with seconds and jobs are
in `director-beat-templates`.

| Template | Rows: scene type and frames                                                                                                                                                                                                                                                                                                                                                                |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Short    | `word-slam` 90, `logo-reveal` 60, `site-hero` 84, `type-card` 51, `feature-card` 72, `feature-card` 72, `proof-bars` or `stat-counter` 96, `colour-event` 39, `type-card` 48 (callback), `type-card` 43 (name), `end-card` 95                                                                                                                                                              |
| Standard | `word-slam` 90, `logo-reveal` 90, `site-hero` 96, `type-card` 54, `site-scroll` 72, proof 96 x 3, `type-card` 54 (pivot), `feature-card` 72 x 4, `tile-wall` 66, `colour-event` 42, `type-card` 54 (callback), `type-card` 43 (name), `end-card` 113                                                                                                                                       |
| Long     | `word-slam` 90, `logo-reveal` 90, `site-hero` 96, `type-card` 54 (problem), `tile-wall` 72, `type-card` 54 (pivot), `type-card` 54 (value), `site-scroll` 72, `status-relay` 60 x 3, proof 96 x 3, `rail-words` 63 x 2, `iso-chain` or `cell-type` 108, `type-card` 54 (pivot), `feature-card` 72 x 5, `colour-event` 42, `type-card` 54 (callback), `type-card` 43 (name), `end-card` 113 |

"Proof" is `proof-bars` or `stat-counter`. Name and pivot rows set `props.variant` to `"name"` or
`"pivot"`.

**Seconds.** `start = from / 30` and `end = (from + frames) / 30`, rounded to 6 decimals. Write
the same number for one scene's `end` and the next scene's `start`. So frame 655 is `21.833333`
in both places. `durationSeconds` is 25, 45 or 65.

## 3. The first 3 seconds

Every reference opens on one element on one ground, with a quiet track, and lands the first real
hit at about 3 s. None opens on a product screen.

- Frame 0 has content: the slam word, huge. Never a blank frame or a poster that then
  disappears.
- Frames 0 to 89 are the hook: one word slams, collapses to sentence size, and the sentence
  builds around it.
- The logo reveal starts at frame 90 and is legible by frame 105 (3.5 s).
- The first product surface lands at 5.0 s (Short) or 6.0 s (Standard, Long), never after 7 s.
- The track stays quiet, at or below -24 LUFS short-term, until 3 s. Full bass waits for the
  first product surface.

## 4. Scene types and seams

Keep the template's scene types. Change one only through the substitutions in
`director-beat-templates`, which also give the seams after each swap:

- Fewer than 3 numeric claims in Standard: replace the missing proof rows, from the last one
  back, with `feature-card` or `status-relay`, the same type for every replaced row. The
  replacement keeps the row's 96 frames.
- Fewer than 6 captured tiles from the customer's site in `assets`: write the `tile-wall` row as a
  `feature-card` with its own headline. The seam out of it stays as the template sets it: `t3` in
  Standard, the pinned `t5` into the pivot in Long.
- Choose one proof type for all proof rows of the film. Use `proof-bars` only when every proof row
  has either 2 or 3 cited values of one kind and unit, or exactly one percent. Otherwise use
  `stat-counter` for every row, with one number per row: the claim's headline number. Drop other
  numbers from that row.
- Long row 17: `iso-chain` when the claims name 2 or 3 concepts to key to hues, else `cell-type`.

**The tour row.** Write a `site-scroll` (Standard row 5, Long row 8) only when the research
provides two full-page captures that pass the scene's fit-or-fail check in every format of the
brief (`docs/motion/scenes/site-scroll.md`: page 1 at least `H + 545` output pixels below its
start, each page at most three times as tall as wide, never one screen) and, for page 2, the DOM
box of a CTA or heading (`ctaBox`) or a `targetY` to land on. Copy those pages and their capture
data unchanged into `assetIds` and `props.pages`. Otherwise write the row as a `site-hero` on the
best captured screen that row 3's `site-hero` does not show, a product, pricing or docs page
before the home page. It keeps the row's 72 frames, start and end; it takes no props and at most
one `label`, that page's URL; its `transitionOut` is `t3` (see `director-beat-templates`); and the
handoff lists it as a substitution. The task names the screen to use and says whether the research
supports a `site-scroll`. Never write a `site-scroll` without `props.pages` and leave it for
someone else: motion refuses the whole film, as it did the first real one, whose research had only
one-screen captures.

**Seams.** Every scene except the last gets a `transitionOut` id, `t1` to `t17`. Use the
template's default seams in `director-seams`. They meet every rule below:

- **Pinned seam.** `t5` into a pivot `type-card`, a 5-frame chapter blink. A pin overrides the
  ground rule and the limits below. The templates pin nothing else.
- **Ground.** Same ground on both sides: `t1`, `t3`, `t4` or `t5`. Ground change, which in the
  templates means into or out of `colour-event`: `t6`, `t7` or `t3`. Never `t16` there: it takes
  15 frames from the incoming scene and 12 from the outgoing one, which leaves the callback card
  under `card.min`.
- **Dead stops.** About a third of the seams are `t3`: `count(t3)` is in
  `[floor(s / 3), ceil(s / 3)]`. The Standard and Long defaults are at the ceiling, so a swap
  never adds a `t3` there, except the tour row's: a `site-hero` leaves on scale, so no `t1` can
  join it to the next row, and its seam becomes `t3`.
- **Limits.** `t1` and `t3` are free. `t5` is free between consecutive scenes of the same type.
  Every other id is used at most 3 times and never on two adjacent seams.
- **Showpieces** (`t6`, `t7`, `t12` to `t15`): at most Short 2, Standard 3, Long 4 [N for Short
  and Long].
- Never `fade` or `slide`. Never a cross-dissolve.

The renderer's resolver honours your id only when it is legal for that boundary, and logs every
boundary where it overrides one.

## 5. Text rules

| Rule                    | Value                                                                                                                                |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Words per card          | Target 2 to 6, at most 8 (headline plus subhead)                                                                                     |
| Lines                   | At most 2                                                                                                                            |
| Characters              | Per scene type and role in `director-scene-types`: 40 for most headlines, 10 for a `stat-counter` number                             |
| Case                    | Sentence case. Never all caps, never title case                                                                                      |
| Hold, every `type-card` | `frames >= max(43, ceil(6.5 * words))`: at most 6 words at 43 frames, 7 at 48 and 51, 8 at 54                                        |
| Reading speed           | 6.5 frames per word at least, about 277 words a minute. `word-slam` and `colour-event` are exempt because they read at display size  |
| Phone copy              | When `variants.formats` includes `9:16` or `1:1`, aim for 8 frames per word. Those formats are unvalidated                           |
| Other holds             | Hero claim 23 frames before its lift. Verdict 25 frames. Count-up final value at least 30 frames. End card static for 69             |
| Accent                  | At most one accent phrase per scene: `props.accent = {textId, from, to}`, word indices with an exclusive end. None on `colour-event` |
| Text ids                | Lowercase slugs with no digits. A digit in `props.accent.textId` reads to the validator as a number in props                         |
| Hierarchy               | By colour or size, never a second weight                                                                                             |
| Story text              | Never small. Everything that carries the story is at sentence size                                                                   |

Write lines, not site paragraphs: 2 to 5 sharp words where you can. Describe only what the site
says the product does.

**Every line that states what the product does cites, in `claimIds`, the claim whose quote says
it, numeric or not.** Hook questions, lines that say nothing about the product (such as a payoff
`Ship it.`), the brand name, URLs and CTA labels are exempt. The validator cannot see this rule:
it checks numbers only.

## 6. The claims rule

Every number, percentage, multiplier or money amount on screen or in voiceover must appear in the
verbatim `quote` of a claim that the text item cites in `claimIds`. The validator compares values,
units and nouns, and reads all of a scene's text items together as one sentence.

- Keep the quote's qualifier: "more than", "up to", "in under". Dropping one overstates the claim.
- A superlative ("fastest", "best", "#1", "leading") needs a cited claim whose quote states that
  superlative. The validator only warns on an uncited superlative, and it never checks that the
  cited quote contains the word. Treat both as errors.
- Cite only `approved` claims on screen, unless the brief says outreach samples may use
  `extracted` claims.
- No copy in `props`, and no string in `props` that states a number. Numeric template parameters
  (word indices, DOM boxes, counts) are JSON numbers and are never displayed.
- No numbers in variant CTA labels: they cannot cite.
- Never invent a number, customer, logo, testimonial or UI state.

Details and real validator output are in `director-copy-and-claims`.

## 7. Hooks and CTAs

**Hooks.** `scenes[0]` is a `word-slam`. Add 1 to 3 alternates in `variants.hooks`, each a
`word-slam` with `start: 0`, `end: 3`, its own id (not a scene id) and the same `transitionOut`
as `scenes[0]`. The first word is the slam word, 12 characters or fewer, and 8 or fewer is the safe
default. The sentence runs 2 to 8 words, 6 or fewer by preference.

| Hook        | Shape                           | Note                                      |
| ----------- | ------------------------------- | ----------------------------------------- |
| Problem     | "Waiting on review again?"      | The default. The callback card answers it |
| Claim first | "Previews in under 90 seconds." | Cites the claim                           |
| Contrast    | "Staging is a queue."           | A plain statement the site supports       |
| Curiosity   | "One link per branch."          | Concrete, never vague                     |

The callback card (`type-card`, two rows before `end-card`) echoes the hook. When it echoes the
slam word, every hook variant shares that slam word.

**CTAs.** `variants.ctas` holds 1 to 3 `{id, label, href}`. The `end-card`'s `cta` text equals
the first label. Labels are 4 words and 24 characters at most, carry no numbers, and offer only
what the site offers: no "Start free" without a free plan. `href` is a real signup, demo or
pricing page on the customer's site.

**Formats.** `variants.formats` is `["16:9"]` unless the brief asks for more. 9:16 and 1:1 have no
reference evidence: add them only on request, and say so in your handoff.

## 8. Sound

- **Music-led by default.** Set `audio.musicAssetId` to the track the Orchestrator gave you,
  declared in `assets` with `provenance` `stock` or `library` and its `license`. Never pick or
  declare a track yourself. With no track given, omit `audio` and say so in the handoff. No
  `audio.voice`, no `scene.voiceover`.
- **Readable with the sound off.** Every idea is on screen. Nothing lives only in sound.
- **Voiceover is allowed** only when the customer pays for narration, or for the company's own
  demo film. Then:
  - Sparse: speak the headline lines only, about 43 words in a 45 s film (ref D density). Full
    narration (ref G, about 101 words in 45 s) only when asked.
  - Each spoken line starts on its scene's cut. On-screen words are fewer than the spoken words,
    and the same phrases.
  - Pace about 150 words a minute. The claims rule covers `voiceover.text` too: cite its claims.
  - Set `audio.voice` to `{provider: "elevenlabs", voiceId}`.
- **Effects.** At most Short 4, Standard 6, Long 8 [N for Short and Long], on hero moments only.
  No whoosh per cut, no typing clicks.

## 9. Never

- A cross-dissolve, `fade` or `slide` between scenes.
- A scene count, order or duration that differs from the template.
- `seconds * fps` arithmetic that leaves a gap or overlap between scenes.
- An invented number, customer, logo, testimonial, UI state or capability.
- A superlative without a cited quote that states it.
- Copy in `props`, or a string in `props` that states a number. Numeric template parameters (word
  indices, DOM boxes, counts) are JSON numbers and are never displayed.
- A rival's name or logo, or third-party logos the customer's own site does not show.
- More than 8 words on a card, more than 2 lines, or a card shorter than `card.min`.
- A blank or poster frame 0, or a product screen as the opening shot.
- Narration the brief did not pay for.
- Any reference film's brand, copy, palette or footage.

## 10. Checks you run yourself, because the validator does not

The validator checks the schema, timing, claims behind numbers, character limits per scene type
and role, contrast and scene types. It passes everything below, so check each one before the
handoff. The pipeline also runs motion's render gate on every submission, `validateFilm` and the
image fit check in every format of the brief, and sends back anything it would refuse: a handoff
never leaves `issuesLeft` empty while a scene would fail it.

| Check                  | Rule                                                                                                                                                     |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `transitionOut`        | Every scene but the last has one, an id from `t1` to `t17`. The last scene has none                                                                      |
| Hooks                  | Each hook is a `word-slam`, and its `transitionOut` equals `scenes[0].transitionOut`                                                                     |
| Seams                  | Rules 1 to 6 in `director-seams`, after any substitution                                                                                                 |
| Card time              | Every `type-card` meets `card.min`: `frames >= max(43, ceil(6.5 * words))`, headline and subhead words together                                          |
| Words, lines and slots | The word and line limits and the number of text items per slot in `director-scene-types`, for example 1 to 3 bar labels on `proof-bars`                  |
| Roles                  | Only the roles `director-scene-types` lists for that scene type. Any other role gets the validator's default limit, such as 120 characters for a subhead |
| CTA labels             | 4 words and 24 characters at most, in `variants.ctas` and on `end-card`. The validator gives variant CTAs its default of 30                              |
| End-card URL           | 20 characters on Short. The registry holds one limit per scene type, 38, which is the Standard and Long limit                                            |
| Claim status           | Cite only `approved` claims on screen, unless the brief says outreach samples may use `extracted` claims                                                 |
| Superlatives           | A cited superlative's quote states that superlative                                                                                                      |
| Product lines          | Every line that states what the product does cites a claim whose quote says it (§5)                                                                      |
| Props                  | No copy, and no string that states a number. Text ids contain no digits                                                                                  |
| Accent                 | At most one per scene, and none on `colour-event`                                                                                                        |
| Tour row               | A `site-scroll` only with the research's long captures and page 2's `ctaBox` or `targetY`, copied; otherwise a `site-hero` on another captured screen    |
| Render gate            | Nothing motion's `validateFilm` or image fit check refuses. A capture too small for its scene is listed in the handoff's issues left to the Researcher   |

## Worked example

A fictional product on an `example.com` domain. Fernhook gives every pull request a live
preview. The brief is a customer order, and the Researcher found two usable claims, so rule 2 of
§1 picks Short. The background `#F6F5F1` has OKLCH lightness 0.97, so the Art Director will pick
Neutral Cut. This exact file passes `validateCampaign` with `sceneRegistry`, with no issues, and
meets every word rule in `director-scene-types` and every check in §10. The scene frames are the
Short template's: 0, 90, 150, 234, 285, 357, 429, 525, 564, 612, 655, ending at 750.

```json
{
  "schemaVersion": 1,
  "id": "fernhook-launch",
  "sourceUrl": "https://fernhook.example.com",
  "fps": 30,
  "durationSeconds": 25,
  "brand": {
    "name": "Fernhook",
    "colors": {
      "background": "#F6F5F1",
      "foreground": "#161616",
      "primary": "#1E6B57",
      "muted": "#5C5C57"
    },
    "fonts": {
      "display": { "family": "Inter Tight", "source": "font-display" },
      "body": { "family": "Inter", "source": "https://fernhook.example.com/fonts/inter.woff2" }
    },
    "logoAssetId": "logo",
    "radius": 14
  },
  "assets": {
    "logo": {
      "kind": "svg",
      "src": "assets/fernhook/logo.svg",
      "provenance": "captured",
      "sourceUrl": "https://fernhook.example.com"
    },
    "home": {
      "kind": "image",
      "src": "assets/fernhook/home.png",
      "provenance": "captured",
      "width": 2880,
      "height": 5400,
      "sourceUrl": "https://fernhook.example.com"
    },
    "pr-panel": {
      "kind": "image",
      "src": "assets/fernhook/pr-panel.png",
      "provenance": "captured",
      "width": 1200,
      "height": 800,
      "sourceUrl": "https://fernhook.example.com/product"
    },
    "preview-link": {
      "kind": "image",
      "src": "assets/fernhook/preview-link.png",
      "provenance": "captured",
      "width": 1200,
      "height": 800,
      "sourceUrl": "https://fernhook.example.com/product"
    },
    "font-display": {
      "kind": "font",
      "src": "assets/fonts/inter-tight.woff2",
      "provenance": "library",
      "license": "OFL-1.1"
    },
    "music-bed": {
      "kind": "audio",
      "src": "assets/audio/bed-120.mp3",
      "provenance": "stock",
      "license": "Example Stock Audio License"
    }
  },
  "claims": [
    {
      "id": "preview-speed",
      "text": "Every pull request gets a live preview in under 90 seconds",
      "sourceUrl": "https://fernhook.example.com",
      "quote": "Every pull request gets a live preview in under 90 seconds. Push a branch, get a link, and review the real thing. No more waiting on review.",
      "status": "approved"
    },
    {
      "id": "team-count",
      "text": "More than 3,000 teams review with Fernhook",
      "sourceUrl": "https://fernhook.example.com/customers",
      "quote": "More than 3,000 teams review with Fernhook.",
      "status": "extracted"
    }
  ],
  "scenes": [
    {
      "id": "hook",
      "type": "word-slam",
      "start": 0,
      "end": 3,
      "props": {},
      "text": [
        {
          "id": "hook-line",
          "role": "headline",
          "value": "Waiting on review again?",
          "claimIds": []
        }
      ],
      "assetIds": [],
      "transitionOut": "t3"
    },
    {
      "id": "mark",
      "type": "logo-reveal",
      "start": 3,
      "end": 5,
      "props": { "mode": "mask" },
      "text": [],
      "assetIds": ["logo"],
      "transitionOut": "t1"
    },
    {
      "id": "surface",
      "type": "site-hero",
      "start": 5,
      "end": 7.8,
      "props": {},
      "text": [
        { "id": "surface-url", "role": "label", "value": "fernhook.example.com", "claimIds": [] }
      ],
      "assetIds": ["home"],
      "transitionOut": "t3"
    },
    {
      "id": "value",
      "type": "type-card",
      "start": 7.8,
      "end": 9.5,
      "props": {},
      "text": [
        {
          "id": "value-line",
          "role": "headline",
          "value": "A live preview for every pull request.",
          "claimIds": ["preview-speed"]
        }
      ],
      "assetIds": [],
      "transitionOut": "t1"
    },
    {
      "id": "feature-push",
      "type": "feature-card",
      "start": 9.5,
      "end": 11.9,
      "props": {},
      "text": [
        {
          "id": "push-line",
          "role": "headline",
          "value": "Push a branch, get a link.",
          "claimIds": ["preview-speed"]
        },
        {
          "id": "push-cause",
          "role": "label",
          "value": "Pull request",
          "claimIds": ["preview-speed"]
        },
        {
          "id": "push-effect",
          "role": "label",
          "value": "Live preview",
          "claimIds": ["preview-speed"]
        }
      ],
      "assetIds": ["pr-panel", "preview-link"],
      "transitionOut": "t5"
    },
    {
      "id": "feature-review",
      "type": "feature-card",
      "start": 11.9,
      "end": 14.3,
      "props": {},
      "text": [
        {
          "id": "review-line",
          "role": "headline",
          "value": "Review the real thing.",
          "claimIds": ["preview-speed"]
        }
      ],
      "assetIds": [],
      "transitionOut": "t1"
    },
    {
      "id": "proof",
      "type": "stat-counter",
      "start": 14.3,
      "end": 17.5,
      "props": { "countUp": false },
      "text": [
        {
          "id": "proof-number",
          "role": "headline",
          "value": "Under 90 s",
          "claimIds": ["preview-speed"]
        },
        {
          "id": "proof-label",
          "role": "label",
          "value": "A live preview per pull request",
          "claimIds": ["preview-speed"]
        }
      ],
      "assetIds": [],
      "transitionOut": "t3"
    },
    {
      "id": "payoff",
      "type": "colour-event",
      "start": 17.5,
      "end": 18.8,
      "props": { "card": "simple" },
      "text": [{ "id": "payoff-line", "role": "headline", "value": "Ship it.", "claimIds": [] }],
      "assetIds": [],
      "transitionOut": "t3"
    },
    {
      "id": "callback",
      "type": "type-card",
      "start": 18.8,
      "end": 20.4,
      "props": {},
      "text": [
        {
          "id": "callback-line",
          "role": "headline",
          "value": "No more waiting on review.",
          "claimIds": ["preview-speed"]
        }
      ],
      "assetIds": [],
      "transitionOut": "t1"
    },
    {
      "id": "name",
      "type": "type-card",
      "start": 20.4,
      "end": 21.833333,
      "props": { "variant": "name" },
      "text": [
        { "id": "name-line", "role": "headline", "value": "Fernhook", "claimIds": [] },
        {
          "id": "name-descriptor",
          "role": "subhead",
          "value": "Pull request previews",
          "claimIds": ["preview-speed"]
        }
      ],
      "assetIds": [],
      "transitionOut": "t1"
    },
    {
      "id": "end",
      "type": "end-card",
      "start": 21.833333,
      "end": 25,
      "props": {},
      "text": [
        { "id": "end-cta", "role": "cta", "value": "Start a preview", "claimIds": [] },
        { "id": "end-url", "role": "label", "value": "fernhook.example.com", "claimIds": [] }
      ],
      "assetIds": ["logo"]
    }
  ],
  "audio": { "musicAssetId": "music-bed" },
  "variants": {
    "hooks": [
      {
        "id": "hook-slot",
        "type": "word-slam",
        "start": 0,
        "end": 3,
        "props": {},
        "text": [
          {
            "id": "hook-slot-line",
            "role": "headline",
            "value": "Waiting for a staging slot?",
            "claimIds": []
          }
        ],
        "assetIds": [],
        "transitionOut": "t3"
      }
    ],
    "formats": ["16:9"],
    "ctas": [
      {
        "id": "start-preview",
        "label": "Start a preview",
        "href": "https://fernhook.example.com/signup"
      },
      { "id": "book-demo", "label": "Book a demo", "href": "https://fernhook.example.com/demo" }
    ]
  }
}
```

The handoff that goes with it:

```text
Template: Short. Customer order with 2 usable claims (preview-speed, team-count) and 2 surfaces
(the home page and /product).
Substitutions: none.
Tier 4 scenes for script approval: feature-review (greeked demo, no capture shows it).
Formats: 16:9 only.
Issues left to other agents: none.
```

What the example shows:

- **Length.** Two usable claims, so Short. `team-count` is `extracted`, so it stays off screen,
  and one proof row holds one claim anyway.
- **Proof.** The quote's qualifier fits the 10-character headline as `Under 90 s`. The label
  restates the quote without adding a start point.
- **Sources.** Every line that says what Fernhook does cites `preview-speed`, whose quote says
  it. The hook questions, the payoff `Ship it.`, the brand name, the URLs and the CTA labels cite
  nothing.
- **Seams.** `t3 t1 t3 t1 t5 t1 t3 t3 t1 t1`: four dead stops in ten seams, `t5` only inside the
  feature group, and `t3` on both sides of `colour-event`, where the ground changes.
- **Hooks.** Both hooks slam "Waiting", which the callback answers.
- **Sound.** Music only: the track the Orchestrator supplied. No `voice`, no `voiceover`.
- **Changing `Under 90 s` to `Under 60 s`** fails with `CLAIM_UNBACKED`: "Under 60 s" states
  "60", but the quotes of preview-speed do not state it.
