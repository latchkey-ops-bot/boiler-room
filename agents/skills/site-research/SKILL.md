---
name: site-research
description: How the Researcher captures a product website and writes a verified research result - brand, assets, claims, brief and needs_upload.
---

# Site research

You turn one product website into a research result that a writer can build a launch film from
without visiting the site. Every fact in it must be traceable to text the capture tool stored.
Code checks your result: the verifier rejects any claim whose quote is not, character for
character after whitespace is collapsed, in the stored text of its source page.

## The capture tool

`br-research.mjs` does every page load. Commands, run with `node <path to br-research.mjs> ...`:

| Command                        | What it does                                                                                                                                                                          |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `setup`                        | Installs Playwright and Chromium and turns on swap. Background job.                                                                                                                   |
| `discover <url>`               | Loads the home page, reads robots.txt, the sitemap and llms.txt, probes `/demo`, `/tour`, `/playground`, `/sandbox`, `/product`, `/how-it-works`, and suggests pages. Background job. |
| `capture <url> <page urls...>` | Captures the pages you chose, measures the brand, downloads the logo, resolves fonts, reads customer material, and writes the bundle, manifest, template and summary. Background job. |
| `wait`                         | Waits up to 25 seconds and prints the running job's summary when it ends with `BR_JOB_DONE`. Run it again while it says the job is still running.                                     |
| `verify <result.json>`         | Checks your result exactly as the gate will. Prints `VERIFY OK` or numbered problems with fixes.                                                                                      |

It refuses more than 15 page loads per site, never loads sign-in pages, honours robots.txt, and
never clicks or types. If a job fails, read the error, fix the cause (usually a wrong address) and
start it again. Do not loop on the same failing command more than twice.

## Choosing pages (at most 15 in total, home included)

Take the home page, then one each of pricing, the main product or features page, the docs landing
page and about, when the site has them. Add every probe that says FOUND: those are where public
product UI lives. Fill the rest with product, solution, use-case, customers and security pages
from the navigation. Skip blog posts, legal pages, careers, sign-in and sign-up pages, and pages
on other domains. The suggested list is a good default.

## Claims

A claim is a statement the film may make. Extract 12 to 40, the ones a launch film would use:

- the home page headline and subhead, word for word
- what the product does, its main features and how it works
- who it is for, integrations and platforms
- numbers: prices, plan limits, performance figures, customer counts, ratings
- proof: named customers, certifications, awards, funding, if stated

Each claim has:

- `id`: a short lowercase slug, unique, such as `home-headline` or `price-team-plan`
- `text`: the claim in your own plain words, with no number the quote does not state
- `sourceUrl`: the captured page the quote is on, exactly as listed in the capture summary, or a
  customer material URL
- `quote`: copied from the page text file, character for character. Copy a whole sentence or a
  whole line. Keep the site's capitalisation, punctuation and symbols. Never fix typos, never join
  text from two places, never translate. Text under "not visible" and "Page title, meta tags and
  alt text" in a text file is quotable too.
- `status`: always `"extracted"`. Only a person approves claims.

Figures inside product mockups, dashboards, terminals and code samples are sample data. The text
files list them under "Text inside product mockups". Names like "acme", "Jane Doe" or
"example.com" in product scenes mark sample data too. Never make these claims: put each in
`brief.non_claims` with the page and the reason. The verifier rejects a claim whose figures only
appear inside a mockup.

## Brief

- `one_liner` and `what_it_is`: what the product is, in plain words, from the live home page.
- `audiences`, `features`: each item cites the claims that back it in `claim_ids`. Any number you
  write must be stated by a cited claim's quote.
- `pricing`: plans with prices as written on the site, each citing its claim; `null` when the site
  publishes no pricing.
- `ctas`: calls to action, with the label exactly as on the page and the page it is on. The
  template lists the ones the tool saw; keep the real ones, drop cookie buttons and duplicates.
- `headline_claim_id`: the claim quoting the home page headline.
- `positioning_note`: how the live site differs from any description you were given, else `null`.
- `conflicts`: places where the site contradicts itself, such as two different prices for one plan.
- `pages`: every page you read, with its kind and screenshot asset.
- `product_ui`: `public` when a real product screen or a live demo is public, `mock-only` when the
  site only shows illustrated mockups, `login-required` when the product sits behind sign-in, else
  `none`. Say in `notes` what was seen.

## needs_upload

List what the film needs and the site could not give, one item each, written so a busy founder can
act on it without context. The template proposes some; check them against what you saw.

- Product UI behind a login: ask for 3 to 6 screenshots or a short screen recording from a demo
  account with no real customer data.
- No logo, only a favicon, or no version for dark backgrounds: ask for an SVG.
- A product video that is only embedded: ask for the source file.
- Figures that need a source before a film repeats them.

Set `blocking: true` only when the film cannot be made well without the item.

## Brand

The template's brand comes from computed styles on the home page and is already valid. Keep it
unless a summary note says the measurement is doubtful. Fix the brand name if the guess is wrong:
use the product's name as the site writes it. If you change a colour, it must still be a colour
the site uses, the foreground must keep 4.5:1 contrast on the background and the primary 3:1.

## Assets and evidence

Publish every file the capture summary lists with `publish_file` (folder `boiler-room/<host>`)
and replace each `PUBLISH:` placeholder with the `fil_` id it returns. Asset `src` values look like
`naive://files/fil_abc123`. Keep the asset ids the template uses. Customer material already has a
file id: an image from it is an asset with provenance `uploaded`, and claims from its text cite its
URL from the summary. `evidence.pages_file_id` and `evidence.capture_file_id` are the ids of the
published `pages.json` and `capture.json`. Never edit either file.

## When the gate sends problems back

After you submit, the gate checks your result again on its own copy of the stored text. If it
sends problems, fix each one in `result.json`, run `verify` until it prints `VERIFY OK`, and call
`submit_output` again with the whole corrected result. If a quote cannot be found word for word,
remove the claim and every reference to it rather than rewording it.
