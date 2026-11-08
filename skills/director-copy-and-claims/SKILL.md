---
name: director-copy-and-claims
description: How Boiler Room's validator checks numbers and superlatives in campaign.json copy against cited verbatim quotes, with real validator output and the fixes. Read when writing copy, citing claims or repairing CLAIM_UNBACKED, CLAIM_SUPERLATIVE, CLAIM_GOAL or TEXT_TOO_LONG.
---

# Copy and claims

The rule: every number, percentage, multiplier or money amount on screen or in voiceover must
appear in the verbatim `quote` of a claim that the text item cites. `validateCampaign` in
`packages/schema` enforces it. This file says how it reads copy, so you can write copy that
passes for the right reason.

## Claims

| Field    | Rule                                                                                                                                                                                |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`     | A slug. Text items cite it in `claimIds`                                                                                                                                            |
| `quote`  | The exact words from `sourceUrl`. Never paraphrase or tidy it. The Researcher captured it, and you never edit it                                                                    |
| `text`   | The claim restated in plain words. It is not what the validator checks                                                                                                              |
| `status` | `extracted` until approved, then `approved`. Cite only `approved` claims on screen, unless the brief says outreach samples may use `extracted` claims. Long needs 5 verified claims |

You may write copy that is shorter than the quote, as long as each number keeps its value, unit,
noun and qualifier.

## How the validator reads a number

| It checks                                            | Example that passes                                      | Example that fails                             |
| ---------------------------------------------------- | -------------------------------------------------------- | ---------------------------------------------- |
| Value                                                | Quote "cut build times by 40%", copy "40% faster builds" | Copy "45% faster builds"                       |
| Kind: percent, multiplier, money, rank, plain number | Quote "3x more often", copy "3x more deploys"            | Copy "300% more deploys"                       |
| Unit                                                 | Quote "under 90 seconds", copy "under 90 s"              | Copy "90 minutes"                              |
| Unit against a noun                                  | Quote "10 minutes", copy "10"                            | Quote "10 minutes", copy "10 teams"            |
| What a count counts                                  | Quote "50,000 product teams", copy "50,000+ teams"       | Copy "50,000+ paying customers"                |
| What "millions of" counts                            | Quote "millions of people", copy "millions of people"    | Copy "millions of bookings"                    |
| Direction of a percent or multiplier                 | Quote "35% less time scheduling", copy "35% less time"   | Copy "35% more meetings"                       |
| Spelled numbers                                      | "twice" reads as 2x, "half" as 50%, "a dozen" as 12      | "Doubles your output" with no quote stating 2x |
| Ranges                                               | "2 to 4 weeks" reads 2 and 4 as weeks                    |                                                |
| Substrings                                           |                                                          | Quote "110 teams", copy "10 teams"             |

**What a count counts.** For a plain number, the words after it are read up to the next small
word such as "of", "with", "on" or "the", in the singular. The first word of the copy's phrase
must be in the quote's phrase, or the quote's first word in the copy's. So "900+ third party data
sources" is backed by "900+ sources", and "50,000 teams use it" by "50,000 product teams". A bare
number such as a stat headline `50,000+` counts whatever the quote counts, but its label is read
together with it (below), so the label must name what the quote counts. Percentages,
multipliers and money are not compared by noun; a percent or multiplier is compared by the word
straight after it: "more", "faster", "higher" against "less", "fewer", "lower". "35% less time"
and "35% faster" are different statements: write what the quote says.

**Read together.** All text items in one scene are also read in order as one sentence. A stat
headline `Under 90 s` and a label `A live preview per pull request` read as "Under 90 s A live
preview per pull request", and both cite the claim whose quote says "in under 90 seconds". A
number backed in one item can still fail when the next item gives it a new meaning.

**Words that are not numbers.** "one" alone is not a number ("one link per branch" is fine). "A
third party" is not a fraction. "Double-click" is not 2x in a quote.

## Qualifiers

Keep the quote's hedge. "More than 3,000 teams" can become a stat headline `3,000+` with the
label `teams review with Fernhook`. That passes and keeps the hedge. A `stat-counter` headline is
10 characters at most, so `3,000 teams` (11) fails with `TEXT_TOO_LONG`. Never turn "up to 40%"
into "40%", or "about 2x" into "2x": the validator passes them, and they overstate the claim.

## Superlatives

The validator warns, it does not fail, when copy uses one of these words with no cited claim:
fastest, quickest, best, leading, top-rated, #1, no. 1, number one, cheapest, largest, biggest,
greatest, highest, lowest, smartest, strongest, safest, easiest, unmatched, unrivalled,
unbeatable.

Director policy is stricter:

- Treat every `CLAIM_SUPERLATIVE` warning as an error.
- A cited superlative needs a quote that itself states the superlative, as a word of its own.
  The validator only checks that some claim is cited, not that its quote says "fastest". A
  compound is a different word: a quote saying "the fastest-growing companies" does not back
  "Fastest scheduling", and "our best-seller" does not back "the best". Copy may repeat the
  quote's own compound with what it describes.
- A number the quote states as a goal ("Our mission is to connect a billion people by 2031")
  may only appear as that goal, with the quote's goal word or year in the scene's text: "A
  billion people by 2031". Stated as a fact, it is `CLAIM_GOAL`.
- Words outside the list, such as "most powerful", "world-class" or "slowest", need the same:
  a quote, or a rewrite.

## Where numbers may not go

| Place                   | Why                                                                                                                                                                                                 |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scene.props`           | Props cannot cite. The validator flags any string in props that states a number, a text id with a digit in `props.accent.textId` included. Write parameters as JSON numbers, and never display them |
| `variants.ctas[].label` | Variant CTAs cannot cite. A number there is always `CLAIM_UNBACKED`                                                                                                                                 |
| `brand.name`            | A name that reads as a statistic ("10x Labs") needs a claim that quotes it, and every use must cite that claim                                                                                      |

## Real validator output

These come from running `node packages/schema/bin/validate.ts`, which passes `sceneRegistry`, on
the worked example in the `director` skill with one edit each. The tests in `packages/schema` run
the same edits on every change.

| Edit                                                                               | Result                                                                                                                             |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `proof-number` set to `Under 60 s`                                                 | `error CLAIM_UNBACKED scenes[6].text[0].value`: "Under 60 s" states "60", but the quotes of preview-speed do not state it          |
| `payoff-line` set to `The best previews.`                                          | `warning CLAIM_SUPERLATIVE scenes[7].text[0].value`: "The best previews." makes a superlative claim without citing one             |
| `value-line`, which cites `preview-speed`, set to `The fastest previews anywhere.` | No issue: the validator only checks that some claim is cited. Director policy rejects it, because the quote does not say "fastest" |
| CTA label set to `Try it free for 14 days`                                         | `error CLAIM_UNBACKED variants.ctas[1].label`: "Try it free for 14 days" states "14", but it cites no claim                        |

Every issue carries a `fix` string. Apply it, then run the validator again.

## Other issues you will meet

| Code                 | Means                                                               | Who fixes it                                                                                                               |
| -------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `SCHEMA_INVALID`     | A missing field, a wrong type, or a key the schema does not allow   | You. Never add keys such as `notes` or `template`: that goes in your handoff                                               |
| `SCENE_TIMING`       | A gap, overlap, or `durationSeconds` mismatch                       | You. Copy `start` and `end` from `director-beat-templates`. One scene's `end` is the next scene's `start`, the same number |
| `TEXT_TOO_LONG`      | Over the scene type's character limit for that role                 | You. Shorten the line. Never move copy to props                                                                            |
| `CLAIM_UNKNOWN`      | `claimIds` names a claim not in `claims`                            | You. Cite an existing claim id                                                                                             |
| `SCENE_TYPE_UNKNOWN` | A `type` not in `sceneRegistry`                                     | You. Use one of the 15 scene types in `director-scene-types`                                                               |
| `VARIANT_INVALID`    | Duplicate variant ids, a hook id equal to a scene id, empty formats | You. Rename or remove                                                                                                      |
| `ASSET_UNDECLARED`   | An asset id not in `assets`, or the wrong kind                      | You, when you referenced the wrong id. The Researcher, when a captured asset is missing: list it in your handoff           |
| `ASSET_UNAVAILABLE`  | A declared asset's file cannot be fetched                           | The Researcher. List it in your handoff                                                                                    |
| `CONTRAST_LOW`       | Foreground under 4.5:1 or primary under 3:1 on the background       | The Art Director. Do not recolour the brand yourself. List it in your handoff                                              |
