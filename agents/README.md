# @boiler-room/agents

The company's agents, defined in code and run on Naive through `@usenaive-sdk/managed-agents`.

## Agents as code

Each agent is an `AgentDefinition` in `src/definitions/`: name, model, system prompt, tools,
skills, budget and output schema. Skills live in `skills/<slug>/SKILL.md`.

```sh
pnpm agents:sync
```

`agents:sync` pushes each skill (content-addressed, so an unchanged skill mints nothing), pins the
agent to that exact skill version, and then creates or versions each agent by name. It stores a
SHA-256 of the definition in the agent's metadata, so an unchanged agent is left alone and a
changed one gets a new version. Two agents with one name is an error, never a guess.

Every toolset denies by default and names `vetta.tools_search`, `vetta.tools_execute`,
`ask_operator`, `request_tools` and `propose_plan` as off, because a deny default still offers the
first two until they are named.

## The company

The company around the product, specified in `docs/company/` on `dev`, is defined in
`src/definitions/company/`. Each role's operating procedure is a skill in `skills/<role>/SKILL.md`,
so the prompts stay short.

| Agent             | Model      | Started by                        | Budget (day / task) |
| ----------------- | ---------- | --------------------------------- | ------------------- |
| `br-ceo`          | Sonnet 5.5 | The sweep (paused), board digests | $5 / $1.00          |
| `br-eng-lead`     | Sonnet 5.5 | `BUILD`, `SHIP`, `RELEASE` cards  | $10 / $1.50         |
| `br-engineer-1`   | Sonnet 5.5 | `ENG` cards                       | $10 / $1.50         |
| `br-product`      | Sonnet 5.5 | `DIR` cards                       | $4 / $1.00          |
| `br-design`       | Sonnet 5.5 | `DESIGN` cards                    | $5 / $1.00          |
| `br-gtm-lead`     | Sonnet 5.5 | Nothing until GTM is activated    | $0 / $0             |
| `br-scout`        | Haiku 5.5  | Nothing until GTM is activated    | $0 / $0             |
| `br-social`       | Haiku 5.5  | Nothing until GTM is activated    | $0 / $0             |
| `br-inbox-reader` | Haiku 5.5  | The app, once GTM is activated    | $0 / $0             |

`br-ceo` is the only coordinator. It has `board: true` and every agent above except the inbox
reader on its roster, each pinned at the version `company:sync` just made, so a member's new
version also re-versions the CEO. Nobody delegates: leads create cards and assign them.

```sh
pnpm company:sync     # idempotent: run it again and everything reads "unchanged"
pnpm company:status
pnpm company:verify   # one session per token holder, after its computer has paused
```

`company:sync`:

1. Creates or versions each agent and pushes its skill, as `agents:sync` does.
2. Ensures `br-ceo`'s board.
3. Creates the sweep, cron `0 */2 * * *` in `America/New_York` at $1.00 a fire, with
   `enabled: false`, so it is paused until someone resumes it (`naive deploy resume <id>`). It never
   resumes or pauses an existing sweep.
4. Writes `~/.netrc` (both `github.com` and `api.github.com`) on the computers of `br-eng-lead` and
   `br-engineer-1` with `BR_GITHUB_TOKEN_ENG`, and of `br-product` and `br-design` with
   `BR_GITHUB_TOKEN_DESIGN`. An agent's computer exists only once a session has needed a
   filesystem, so an agent without one first gets a boot session that runs `echo computer-ready`
   (about $0.015 on Sonnet). The token goes in by Naive's file write only; the shell commands, which
   Naive keeps for 30 days, hold only the path. A file whose SHA-256 already matches is left alone.

Toolsets deny by default and name every allowed tool. Every agent also names as off the invoker
(`vetta.tools_search`, `vetta.tools_execute`), the teammate tools, the company settings tools, and
every planned `br-app.*` tool, and keeps `allowed_apps` explicit. The inbox reader names all 54
AgentMail tools and allows only `get_message`. Three things the platform decides:
`submit_output` cannot be named (it is always offered), the `apps` tool stays off until the staging
app exists (`STAGING_APP_ID`), and design's browser stays off until there is a staging domain to
limit it to (`STAGING_DOMAIN`).

Not provisioned yet, because nothing uses them until GTM is activated: the GTM persona and the
inbox reader's AgentMail vault credential. The activation checklist is in `docs/company/roles/gtm.md`.

## The Researcher

```sh
pnpm research https://example.com
pnpm research https://example.com --material ./deck.pdf --material https://example.com/press.png
```

Input is a URL and, optionally, customer material. The run needs no approval at any step.

1. The capture tool (`src/capture/`) is bundled with esbuild into one file, `br-research.mjs`, with
   the verifier and the schema validator inside it, and uploaded to Naive files once per version.
   Customer material is uploaded too (files with `files.upload`, URLs with `files.import`) with a
   manifest; it is cited and stored with provenance `uploaded`.
2. The `br-researcher` agent is synced, and one session starts with `output_schema` and
   `structured_output_required`.
3. On its own computer the agent fetches the tool and runs `setup`, `discover`, `capture`, writes
   the result from the template the capture produced, and runs `verify` until it passes.
4. The gate checks the submitted result (below). Failures go back to the session with a fix for
   each, and the agent repairs and resubmits, up to `--max-repairs` rounds. A claim that still
   fails is dropped; nothing unverified reaches the output.
5. The result, the stored page text, the screenshots and logo, the event log and a cost report are
   saved under `out/research/<host>/`.
6. The agent is deleted, because that is the only way to remove its computer, and the run waits
   until the computer is gone. `--keep-agent` keeps both for a faster next run.

### Capture rules, enforced in code

- At most 15 page loads per site (a ledger refuses the 16th), 1.5 s apart, robots.txt honoured.
- Read-only: non-GET navigations are aborted, downloads are off, nothing is clicked or typed. The
  only interaction is scrolling. Sign-in pages are never loaded. The model has no `web_fetch`,
  `web_search` or `browser` tool, so every page goes through the capture tool.
- `/demo`, `/tour`, `/playground`, `/sandbox`, `/product` and `/how-it-works` are probed on every
  site, compared with the answer for a path that cannot exist, so soft 404s do not count.
- Text (`innerText`, `textContent` without scripts, meta tags and alt text) and styles are read
  before cookie banners are hidden with CSS and before any screenshot. Screenshots are 1920x1080:
  the top of each page and each product UI candidate.
- Brand tokens come from computed styles, so they work with or without CSS variables and in any
  colour syntax: the painted background, the most used readable text colour, the brand colour from
  button fills, links and headings, accents, muted text, radius, light or dark, and fonts with how
  they load. Text in product mockups does not count.
- The logo is an SVG file if the header has one, then inline SVG, then a raster logo, then a
  favicon. Each download is checked by its bytes, so an HTML page served as `logo.svg` is refused.
  With no logo at all, the product name is set as a wordmark and marked `generated`, and the
  customer is asked for the real one.
- A Chromium is run on a 1 GiB machine with a 2 GiB swapfile, one page at a time, always closed.

### The gate

- Schema: `researchOutputSchema`, which is the brand, assets and claims parts of the campaign
  schema unchanged, plus `brand_details`, `brief`, `needs_upload` and `evidence`.
- The campaign validator on those parts (`validateResearchParts` in `@boiler-room/schema`), with
  every asset checked against Naive files.
- The verbatim rule: every claim's quote must be in the stored text of its source page, after
  whitespace is normalised. A figure that only appears inside a product mockup is refused as
  sample data. Brief items may only cite claims that exist, and every number in them must be in a
  cited quote. Calls to action must be verbatim on their page.
- Provenance: the gate downloads `pages.json` itself and requires its SHA-256 to match a digest the
  capture tool printed in this session's tool output, so a bundle edited after the capture is
  refused. Assets must be files this session published, or customer material with provenance
  `uploaded`.

`pnpm research --drill-repair` refuses the first submission on purpose, to prove the repair loop
on a live session.

### Output

| File                | Contents                                                   |
| ------------------- | ---------------------------------------------------------- |
| `research.json`     | The accepted result                                        |
| `report.json`       | Session, agent version, gate rounds, rejected claims, cost |
| `pages.json`        | The stored page text the claims were checked against       |
| `files/`            | The logo and screenshots, downloaded from Naive files      |
| `events.jsonl`      | The session's events, with the key scrubbed                |
| `submission-N.json` | Each result the agent submitted                            |

Asset `src` values name Naive files as `naive://files/<fil_ id>`; `fileIdOf` reads them.

## Testing the capture tool locally

`BR_LOCAL=1` makes the tool skip swap, system packages and killing stray browsers, which are only
safe on the agent's own computer. Bundle it with `bundleTool()`, put it next to a `node_modules`
holding `playwright`, and run `node br-research.mjs discover <url>` then `wait`.

Biome does not format `skills/`: its Markdown formatter breaks YAML front matter.
