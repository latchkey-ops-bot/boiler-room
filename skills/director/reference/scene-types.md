---
name: director-scene-types
description: The 15 Boiler Room scene types for campaign.json, with each one's kind, text slots, character limits, assets, props and when to choose it. Read when writing a scene's text and assets or substituting a scene.
---

# Scene types

`scene.type` is one of these 15 ids. Build specs are in `docs/motion/scenes/<id>.md`. "Limits" are
the `SceneLimits.text` character limits the registry gives `validateCampaign`. Word limits are
the Director's to keep. Every number in any slot needs a cited claim.

| `type`         | Kind     | Job                                             | Text slots                                                                                                                              | Assets                                              | Props                                                             |
| -------------- | -------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ----------------------------------------------------------------- |
| `word-slam`    | type     | The hook, always scene 1                        | `headline` 2 to 8 words, 40 chars. First word is the slam word, 12 chars or fewer                                                       | none                                                | `accent?`                                                         |
| `logo-reveal`  | mark     | Mark legible by frame 105                       | `subhead` tagline from the site, 6 words, 32 chars, optional                                                                            | `brand.logoAssetId`                                 | `mode?`: `mask`, `blur`, `tiles`, `iris`                          |
| `site-hero`    | product  | First real surface                              | `label` URL, 32 chars, optional                                                                                                         | 1 captured page, device scale 2 or more             | `frame?`, `layers?`, `focus?`, `activeLayer?` (capture data only) |
| `type-card`    | type     | Value, problem, callback, name, pivot           | `headline` 40 chars, `subhead` 40 chars, 8 words in total, within `card.min`                                                            | none                                                | `variant?`: `name`, `pivot`. `accent?`                            |
| `site-scroll`  | product  | Tour of the real site                           | `label` URL per page, 32 chars, up to 2                                                                                                 | 2 full-page captures, page 2 with a real CTA        | `pages` (capture data only)                                       |
| `proof-bars`   | proof    | Hero claim, then data-true bars, then a verdict | `headline` hero claim, 2 to 6 words, 40 chars. `label` per bar, 1 to 3, 24 chars, one number each. `subhead` verdict, 4 words, 24 chars | none                                                | `accent?`                                                         |
| `stat-counter` | proof    | One cited number                                | `headline` the number and unit, 10 chars. `label` 6 words, 40 chars, with the quote's qualifier                                         | none                                                | `countUp?` (stays `false` until the founder approves count-ups)   |
| `feature-card` | product  | One feature, one cause and effect               | `headline` 2 to 6 words, 40 chars. `label` cause and effect, 2 words and 16 chars each                                                  | 0 to 2 captured crops, else tier 4 greeked          | `demo?`, `accent?`                                                |
| `tile-wall`    | product  | Scale, from captured pages                      | none                                                                                                                                    | 6 to 18 captured tiles from the customer's own site | `motionBlur?`                                                     |
| `status-relay` | product  | How it works, in tier 4                         | `headline` status line, 2 to 6 words, 40 chars. `label` per chip, 2 words, 12 chars, up to 3                                            | none, or an SVG actor                               | `accent?`                                                         |
| `rail-words`   | product  | Breadth, fast                                   | `headline` top rail, `subhead` bottom rail, 1 or 2 words and 14 chars each                                                              | optional captured crop for the centre               | `accent?`                                                         |
| `colour-event` | type     | The payoff, full-bleed brand colour             | `headline` 1 to 3 words, 20 chars                                                                                                       | none, or a generated field                          | `card?`: `simple`, `frosted`                                      |
| `cell-type`    | setpiece | Dot-matrix type into a panel                    | `headline` 1 to 3 words, 16 chars                                                                                                       | none                                                | `accent?`                                                         |
| `iso-chain`    | setpiece | Squares to cubes to a hexagon                   | `label` per object, up to 3, 16 chars. `headline` 5 words, 32 chars, optional                                                           | optional hero texture                               | `count?`, `hero?`, `hues?`                                        |
| `end-card`     | mark     | Lockup, CTA, URL, quiet hold                    | `cta` 4 words, 24 chars. `label` URL: 20 chars on Short, 38 on Standard and Long                                                        | `brand.logoAssetId`                                 | `urlReveal?`: `decode`, `type`                                    |

## Kinds and rhythm

Kinds feed the rhythm rule [D]: type and proof alternate, a run of one scene type sharing a
headline slot counts as one unit (up to 5 scenes), and a mark resets the count. The templates
already follow it. Do not reorder rows to "improve" rhythm.

## Asset tiers

Use the highest tier the site gives. The Art Director has the full rules.

| Tier | Source                                                                               | Honest status                             |
| ---- | ------------------------------------------------------------------------------------ | ----------------------------------------- |
| 1    | Product screenshots, images or demo video already on the site                        | Real                                      |
| 2    | Docs, changelog, code samples, pricing, integrations pages                           | Real                                      |
| 3    | The marketing site itself                                                            | Real, but shows the site, not the product |
| 4    | Abstract components from verified claims: chips, status lines, rails, greeked panels | Illustrative. Greeked, no numerals        |
| 5    | Generated: backgrounds, texture, illustrative objects                                | Illustrative. `provenance: "generated"`   |

Tier 4 scenes (`status-relay`, `rail-words`, greeked `feature-card`) must be visible to the
customer at script approval. Never a fake dashboard, fake data rows, a fake customer name, a fake
testimonial, or a logo wall of companies not on the customer's own site.

## Props

Props are template parameters, never copy. Strings are short ids such as `"name"` or `"mask"`.
Numbers are JSON numbers, and only capture data (DOM boxes) or indices. `props.accent` is
`{textId, from, to}`: word indices into one text item, end exclusive, at most one per text item.
