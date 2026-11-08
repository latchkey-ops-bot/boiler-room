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
| `br-eng-lead`     | Sonnet 5.5 | `BUILD` and `SHIP` cards          | $10 / $1.50         |
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
pnpm company:status   # also lists how GitHub differs from the spec
pnpm company:verify   # one session per token holder, after its computer has paused; exits 1 on a failure
```

`company:sync`:

1. Checks GitHub from this machine, and warns about each gap without changing anything there:
   whether each token can push to each repo (GitHub serves the `git-receive-pack` ref
   advertisement only to a credential that can write; the token goes in a request header), and
   whether `main` and `dev` of both repos carry the `deletion`, `non_fast_forward` and
   `pull_request` rules. `company:status` prints the same check.
2. Creates or versions each agent and pushes its skill, as `agents:sync` does.
3. Ensures `br-ceo`'s board.
4. Creates the sweep, cron `0 */2 * * *` in `America/New_York` at $1.00 a fire, with
   `enabled: false`, so it is paused until someone resumes it (`naive deploy resume <id>`). It never
   resumes or pauses an existing sweep.
5. Writes `~/.netrc` (both `github.com` and `api.github.com`) on the computers of `br-eng-lead` and
   `br-engineer-1` with `BR_GITHUB_TOKEN_ENG`, and of `br-product` and `br-design` with
   `BR_GITHUB_TOKEN_DESIGN`. An agent's computer exists only once a session has needed a
   filesystem, so an agent without one first gets a boot session that runs `echo computer-ready`
   (about $0.015 on Sonnet). The token goes in by Naive's file write only; the shell commands, which
   Naive keeps for 30 days, hold only the path. A file whose SHA-256 already matches is left alone,
   so a re-minted token in the env file is written on the next sync.

`company:verify` starts one session per token holder. Each runs five fixed commands that hold only
paths and URLs, and code, not the model, judges the outputs. It passes only when `~/.netrc` is
there with mode 600, `GET /user` answers 200 (the token authenticates; a repo's `"push"` field
reports the user's role, not the token's grant, so it is not used), a `git push --dry-run` of an
empty commit to the token's own repo is accepted, and the same dry run to the other repo is
refused. A dry run sends no objects, but it does fetch the `git-receive-pack` advertisement, which
needs write access.

Toolsets deny by default and name every allowed tool. Every agent also names as off the invoker
(`vetta.tools_search`, `vetta.tools_execute`), the teammate tools, the company settings tools, and
every planned `br-app.*` tool, and keeps `allowed_apps` explicit. The inbox reader names all 54
AgentMail tools and allows only `get_message`. Three things the platform decides:
`submit_output` cannot be named (it is always offered), the `apps` tool stays off until the staging
app exists (`STAGING_APP_ID`), and design's browser stays off until there is a staging domain to
limit it to (`STAGING_DOMAIN`).

Not provisioned yet, because nothing uses them until GTM is activated: the GTM persona and the
inbox reader's AgentMail vault credential. The activation checklist is in `docs/company/roles/gtm.md`.

Verified on 2026-11-07, on the real company:

- A second sync changed nothing: nine agents `unchanged`, the board `existing`, the sweep
  `unchanged` and paused, every `~/.netrc` `unchanged`. After the release and verify changes, one
  sync moved `br-ceo`, `br-eng-lead`, `br-engineer-1`, `br-product` and `br-design` to v2 and
  updated the sweep's input (still paused), and the sync after it changed nothing.
- `~/.netrc` survives into a later session. `company:verify` waited until each computer was
  `paused`, then a new session on the same computer found the file (mode 600), ran `git ls-remote`,
  authenticated to the REST API with `curl --netrc`, and an authenticated `git push --dry-run` to
  its own repo was accepted. That run had no negative step: its `"push": true` came from the repo's
  view of the user, which proves only that the token authenticated. No token appeared in any
  session's events or in the computers' command history. Whether the file survives Naive replacing
  the machine is untested; the engineer's first step checks for it.
- The negative step catches the cross-repo reach. With the new `company:verify --no-wait`, all four
  sessions (`br-eng-lead` `ses_c9qvzy4fks90d1fd0w6r3whcr6`, `br-engineer-1`
  `ses_qye1nv6e8ztkv74jy9jat8v9ka`, `br-product` `ses_2esz3sfds5jasx8kb7e07qxq90`, `br-design`
  `ses_kp7mvq9387gzv903amrvny7tpt`, $0.18 in all) got `auth 200` and an accepted dry run on their
  own repo, and an accepted dry run on the other repo too, so each failed with "the token reaches
  both repos" and the command exited 1. The preflight from this machine agrees: both tokens get the
  `git-receive-pack` advertisement on both repos.
- The board: `br-ceo` created a card assigned to `br-product`, `br-product` was started on it about
  4 s later, moved it to `doing` and `done` with a note, and the board started a `br-ceo` digest
  session about 48 s after `done`, which read the card and created nothing.

In the Naive dashboard (from its route table, not an API): each agent has a page under
`/agents/<agt_ id>`, with its sessions and transcripts under `/sessions`, and `br-ceo`'s settings list
its roster as team members. The `/board` page shows only the board of the company's platform CEO
(`ceo_agent_id`), which this company does not use, so read the board with `pnpm company:status` or
`naive board show <br-ceo's agt_ id>`.

### Releases are the founder's

The company's work stops at `dev` and staging. When a slug is delivered, the CEO creates
`FOUNDER: release <slug>`, unassigned and `blocked`, naming the `DIR` and `SHIP` cards and the `dev`
commit. The founder promotes `dev` to `main` and deploys production. No agent merges into `main` or
deploys production, and the lead moves any `RELEASE` card to `blocked` with the note
`releases are the founder's`.

### Before anyone resumes the sweep

Pausing the sweep is not enough on its own: a card assigned to an agent starts it, sweep or not.
Until both of these are true, only prompts keep an agent off the other repo and off `main` and
`dev`, and `company:sync` and `company:status` say so:

1. **Each token reaches one repo.** Re-mint both fine-grained tokens with "Only select
   repositories": `BR_GITHUB_TOKEN_ENG` gets `boiler-room` only, `BR_GITHUB_TOKEN_DESIGN` gets
   `boiler-room-design` only, each with Contents and Pull requests read and write. Put them in
   `~/.boiler-room.env`, run `pnpm company:sync` (it rewrites `~/.netrc` on all four computers),
   then `pnpm company:verify`, which must pass for all four.
2. **`main` and `dev` have rules, on both repos.** Add the rulesets from
   `docs/company/README.md` section 5 C: `protect-main` and `protect-dev`, each with Restrict
   deletions, Block force pushes, and Require a pull request with 0 approvals, and an empty bypass
   list. The tokens have no Administration permission, so no agent and no script here can add them.
   Then check that a push straight to `dev` is refused.

### Where the build differs from the spec

Each item gives the spec in `docs/company/` on `dev`, then the build, then why.

- **Releases.** Spec section 7: the CEO creates `RELEASE: <slug>` and `br-eng-lead` promotes `dev`
  to `main` and deploys production, with no person involved. Build: `FOUNDER: release <slug>`, and
  the founder promotes. A promotion to `main` or a production deploy is the founder's in every
  case, until he confirms otherwise in writing.
- **The work-in-progress limit.** `roles/ceo.md` step 4: at most two open `DIR` cards, where open
  means not `done`. Build: at most two open slugs. A slug is open until the CEO comments
  `Delivered` or `Not delivered` on its `DIR` card, or its last `SHIP` card is done. Product moves
  `DIR` to `done` when the spec PR opens, so counting cards limited nothing.
- **Duplicate cards.** Section 2: a retried write with the same title is a no-op. Build: only within
  one session, because card ids derive from the board, the writing session and the title. The CEO
  checks the board before it creates `FOUNDER: release`, `FOUNDER: stalled cards` or a retried
  `DIR`, which is titled `DIR: <slug> r2`.
- **Token reach.** Sections 5 and 6: each token reaches one repo. Live: both tokens can push to both
  repos (checked 2026-11-07). Re-minting them is the founder's (above).
- **Branch rules.** Section 5 C: rules on `main` and `dev`. Live: none on either repo (checked
  2026-11-07). Adding them is the founder's (above).

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
