---
name: director-copy-and-claims
description: How Boiler Room's validator checks numbers and superlatives in campaign.json copy against cited verbatim quotes, with real validator output and the fixes. Read when writing copy, citing claims or repairing CLAIM_UNBACKED, CLAIM_SUPERLATIVE or TEXT_TOO_LONG.
---

# Copy and claims

The rule: every number, percentage, multiplier or money amount on screen or in voiceover must
appear in the verbatim `quote` of a claim that the text item cites. `validateCampaign` in
`packages/schema` enforces it. This file says how it reads copy, so you can write copy that
passes for the right reason.

## Claims

| Field    | Rule                                                                                                             |
| -------- | ---------------------------------------------------------------------------------------------------------------- |
| `id`     | A slug. Text items cite it in `claimIds`                                                                         |
| `quote`  | The exact words from `sourceUrl`. Never paraphrase or tidy it. The Researcher captured it, and you never edit it |
| `text`   | The claim restated in plain words. It is not what the validator checks                                           |
| `status` | `extracted` until approved, then `approved`. Long needs 5 `approved` claims                                      |

You may write copy that is shorter than the quote, as long as each number keeps its value, unit,
noun and qualifier.

## How the validator reads a number

| It checks                                            | Example that passes                                      | Example that fails                             |
| ---------------------------------------------------- | -------------------------------------------------------- | ---------------------------------------------- |
| Value                                                | Quote "cut build times by 40%", copy "40% faster builds" | Copy "45% faster builds"                       |
| Kind: percent, multiplier, money, rank, plain number | Quote "3x more often", copy "3x more deploys"            | Copy "300% more deploys"                       |
| Unit                                                 | Quote "under 90 seconds", copy "90 seconds"              | Copy "90 minutes"                              |
| Noun                                                 | Quote "10 minutes", copy "10"                            | Quote "10 minutes", copy "10 teams"            |
| Spelled numbers                                      | "twice" reads as 2x, "half" as 50%, "a dozen" as 12      | "Doubles your output" with no quote stating 2x |
| Ranges                                               | "2 to 4 weeks" reads 2 and 4 as weeks                    |                                                |
| Substrings                                           |                                                          | Quote "110 teams", copy "10 teams"             |

**Read together.** All text items in one scene are also read in order as one sentence. A stat
headline `90 seconds` and a label `or less, from push to preview` read as "90 seconds or less,
from push to preview", and both cite the claim whose quote says "under 90 seconds". A number
backed in one item can still fail when the next item gives it a new meaning.

**Words that are not numbers.** "one" alone is not a number ("one link per branch" is fine). "A
third party" is not a fraction. "Double-click" is not 2x in a quote.

## Qualifiers

Keep the quote's hedge. "More than 3,000 teams" can become "3,000+ teams", which keeps the
meaning, or a headline `3,000 teams` with a label `and more review with Fernhook`. Both pass. Never
turn "up to 40%" into "40%", or "about 2x" into "2x": the validator passes them, and they overstate
the claim.

## Superlatives

The validator warns, it does not fail, when copy uses one of these words with no cited claim:
fastest, quickest, best, leading, top-rated, #1, no. 1, number one, cheapest, largest, biggest,
greatest, highest, lowest, smartest, strongest, safest, easiest, unmatched, unrivalled,
unbeatable.

Director policy is stricter:

- Treat every `CLAIM_SUPERLATIVE` warning as an error.
- A cited superlative needs a quote that itself states the superlative. The validator only checks
  that some claim is cited, not that its quote says "fastest".
- Words outside the list, such as "most powerful", "world-class" or "slowest", need the same:
  a quote, or a rewrite.

## Where numbers may not go

| Place                   | Why                                                                                                                                               |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scene.props`           | Props cannot cite. The validator flags strings in props that read as copy with a number. Write parameters as JSON numbers, and never display them |
| `variants.ctas[].label` | Variant CTAs cannot cite. A number there is always `CLAIM_UNBACKED`                                                                               |
| `brand.name`            | A name that reads as a statistic ("10x Labs") needs a claim that quotes it, and every use must cite that claim                                    |

## Real validator output

These were produced by running `validateCampaign` on the worked example in `SKILL.md` with three
edits.

| Edit                                                 | Issue                                                                                                                              |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `proof-number` set to `60 seconds`                   | `error CLAIM_UNBACKED scenes[6].text[0].value`: "60 seconds" states "60", but the quotes of preview-speed do not state it          |
| `value-line` set to `The fastest previews anywhere.` | `warning CLAIM_SUPERLATIVE scenes[3].text[0].value`: "The fastest previews anywhere." makes a superlative claim without citing one |
| CTA label set to `Try it free for 14 days`           | `error CLAIM_UNBACKED variants.ctas[1].label`: "Try it free for 14 days" states "14", but it cites no claim                        |

Every issue carries a `fix` string. Apply it, then run the validator again.

## Other issues you will meet

| Code                 | Means                                                               | Fix                                                                                                                   |
| -------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `SCENE_TIMING`       | A gap, overlap, or `durationSeconds` mismatch                       | Copy `start` and `end` from `director-beat-templates`. One scene's `end` is the next scene's `start`, the same number |
| `TEXT_TOO_LONG`      | Over the scene's character limit                                    | Shorten the line. Never move copy to props                                                                            |
| `CLAIM_UNKNOWN`      | `claimIds` names a claim not in `claims`                            | Cite an existing claim id                                                                                             |
| `ASSET_UNDECLARED`   | An asset id not in `assets`, or the wrong kind                      | Use a declared asset of the right kind                                                                                |
| `CONTRAST_LOW`       | Foreground under 4.5:1 or primary under 3:1 on the background       | The Art Director fixes brand colours. Do not recolour the brand yourself                                              |
| `SCENE_TYPE_UNKNOWN` | A `type` not in the registry                                        | Use one of the 15 scene types                                                                                         |
| `VARIANT_INVALID`    | Duplicate variant ids, a hook id equal to a scene id, empty formats | Rename or remove                                                                                                      |
