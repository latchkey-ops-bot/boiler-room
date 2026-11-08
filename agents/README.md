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

| Agent             | Model      | Started by                                            | Budget (day / task) |
| ----------------- | ---------- | ----------------------------------------------------- | ------------------- |
| `br-ceo`          | Sonnet 5.5 | The founder's chat, the sweep (paused), board digests | $5 / $1.00          |
| `br-eng-lead`     | Sonnet 5.5 | `BUILD` and `SHIP` cards                              | $10 / $1.50         |
| `br-engineer-1`   | Sonnet 5.5 | `ENG` cards                                           | $10 / $1.50         |
| `br-product`      | Sonnet 5.5 | `DIR` cards                                           | $4 / $1.00          |
| `br-design`       | Sonnet 5.5 | `DESIGN` cards                                        | $5 / $1.00          |
| `br-gtm-lead`     | Sonnet 5.5 | Nothing until GTM is activated                        | $0 / $0             |
| `br-scout`        | Haiku 5.5  | Nothing until GTM is activated                        | $0 / $0             |
| `br-social`       | Haiku 5.5  | Nothing until GTM is activated                        | $0 / $0             |
| `br-inbox-reader` | Haiku 5.5  | The app, once GTM is activated                        | $0 / $0             |

`br-ceo` is the only coordinator and the organization's CEO (`ceo_agent_id`); Naive's default CEO
is never created. It has `board: true` and every agent above except the inbox reader on its roster,
each pinned at the version `company:sync` just made, so a member's new version also re-versions the
CEO. Nobody delegates: leads create cards and assign them.

```sh
pnpm company:sync     # idempotent: run it again and everything reads "unchanged"
pnpm company:status   # also lists how GitHub differs from the spec
pnpm company:verify   # one session per token holder, after its computer has paused, then the br-ceo check; exits 1 on a failure
pnpm company:verify --ceo   # only the br-ceo check: one session that reports the tools it is offered
pnpm company:verify --lockdown  # read-only, no session: board exposure and br-ceo's stored lockdown
pnpm company:halt --dry-run # the kill switch, below; --dry-run changes nothing
```

`company:sync`:

1. Reads the control plane's catalogue (`tools/list` on `https://api.vetta.sh/v1/mcp`) and stops,
   before changing anything, if it serves a tool that `src/company/control-plane-tools.ts` does not
   list.
2. Checks GitHub from this machine, and warns about each gap without changing anything there:
   whether each token can push to each repo (GitHub serves the `git-receive-pack` ref
   advertisement only to a credential that can write; the token goes in a request header), and
   whether `main` and `dev` of both repos carry the `deletion`, `non_fast_forward` and
   `pull_request` rules. Both take 0 approvals, because releases are autonomous.
   `company:status` prints the same check.
3. Creates or versions each agent and pushes its skill, as `agents:sync` does.
4. Binds `br-ceo` as the organization's CEO, once its stored toolset names every control-plane tool
   off: one `static_bearer` credential in the vault named exactly `Orchestrator control plane`, key
   `ceo_<br-ceo's agt_ id>`, `mcp_server_url` `https://api.vetta.sh/v1/mcp`, `agent_id` br-ceo. The
   platform never injects that credential (docs: api/vaults); it records the CEO and gives it a
   short-lived credential each turn, so the stored value is 32 random bytes that authenticate
   nothing. It then reads `ceo_agent_id` back. An existing binding is left alone. It never replaces
   another CEO: if the organization or the vault names a different agent, it stops. Binding needs
   an `admin` key, and so does every later update of `br-ceo`.
5. Ensures `br-ceo`'s board, which is now the company board.
6. Creates the sweep, cron `0 */2 * * *` in `America/New_York` at $1.00 a fire, with
   `enabled: false`, so it is paused until someone resumes it (`naive deploy resume <id>`). It never
   resumes or pauses an existing sweep.
7. Writes `~/.netrc` (both `github.com` and `api.github.com`) on the computers of `br-eng-lead` and
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

`company:verify` first runs the lockdown check, read-only and with no session: it fails on any agent
in the organization that the company board offers a board tool its definition does not give it,
and on any control-plane tool the live catalogue serves that `br-ceo`, as Naive stores it, does not
name off. `--lockdown` runs only that check.

`company:verify` then starts one `br-ceo` session that reports the tools it is offered, and code
compares them, and every tool it called, with `board_read`, `board_write`, `read_skill`,
`session_spend`, `submit_output` and `br-app.company_metrics`. Anything else fails it.

Toolsets deny by default and name every allowed tool. Every agent also names as off the invoker
(`vetta.tools_search`, `vetta.tools_execute`), the teammate tools, the company settings tools, and
every planned `br-app.*` tool, and keeps `allowed_apps` explicit. `br-ceo` also names all 368
control-plane tools off, because the organization's CEO is offered the control plane and an MCP tool
a toolset does not name is offered at "ask" even under a deny default. The inbox reader names all 54
AgentMail tools and allows only `get_message`. Three things the platform decides:
`submit_output` cannot be named (it is always offered), the `apps` tool stays off until the staging
app exists (`STAGING_APP_ID`), and design's browser stays off until there is a staging domain to
limit it to (`STAGING_DOMAIN`).

### The company board seats every agent

Because `br-ceo` is the organization's CEO, its board is the company board, and the company board
seats every agent of the organization, on the roster or not (docs: team/board). A seated agent is
offered `board_read` and `board_write` even under a deny default: a throwaway agent with a deny
default and neither tool named was offered both. Naming a tool off removes it: with `board_write`
named off it was offered `board_read` only. So:

- The GTM agents name `board_write` off while GTM is inactive, and keep `board_read`. Activating
  GTM gives `board_write` back.
- The inbox reader names both off, as before.
- Every production-crew toolset (`toolset()` in `src/define.ts`) names both off. That covers
  `br-researcher` from this branch. `br-director`, `br-art-director` and `br-quality-check` are
  defined on their own branches and synced by their own jobs: until those branches take this
  `define.ts`, their live agents name neither tool, so each is offered both. Changing them from
  here was refused. The fix is theirs: rebase on this branch and run `agents:sync`, or name both
  tools off by hand. The same holds for a `br-researcher` synced from a branch without it, and for
  a per-run Researcher, which reads untrusted websites.

Naive has no organization-wide policy (docs: concepts/policies) and no way to seat only a roster on
the company board, so nothing here can close this for an agent another branch syncs. What this
branch does is find it: `company:sync` warns about each agent the board offers a tool its
definition does not give it (a crew or probe agent: any board tool; a GTM agent: `board_write`),
`company:status` lists them, and `company:verify` fails on them. A card any of them creates and
assigns starts its assignee at once, sweep or not.

### The control-plane lockdown is a list

`br-ceo` is protected by naming every control-plane tool off, and that list is a copy of a catalogue
Naive can grow at any time. MCP tools default to `ask`, and there is no server-wide switch (docs:
capabilities/tools, MCP connector), so a tool added upstream is offered to `br-ceo` at `ask` until
the next sync names it. `company:sync` refuses to run while the catalogue serves a tool the list
lacks, and `company:verify --lockdown` compares the live catalogue with `br-ceo`'s stored toolset,
with no session and no spend. Run it before trusting a `br-ceo` run, and before resuming the sweep.
An `ask` call parks the session as `awaiting_approval`, which `company:status` lists; approving it
would run the call.

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

In the Naive dashboard (read from its own code, not documented): the rail's **CEO** row and the
`/orchestrator` chat talk to the agent whose `metadata.role` is `orchestrator`, and with none the
dashboard shows a placeholder CEO. `br-ceo` carries that role (`CEO_METADATA`), so the CEO row is
`br-ceo`. The `/board` page shows the organization CEO's board, so it shows `br-ceo`'s.

**The founder's line is the CEO chat** at `/orchestrator`. Each chat there is an ordinary `br-ceo`
session: same system prompt, the `ceo` skill (which has a section for the founder's chat), the
lockdown above, and a cap of `max_task_micro_usd`, $1.00 per chat, which is what a session falls
back to when no budget is given (docs: api/sessions); the $5 daily cap bounds every chat together.
A channel is not the line: a session marked `metadata.room` with the agent's id is a channel's
transcript, and a message there runs no turn (docs: api/sessions, "A channel's session runs
nothing"); the dashboard uses channels for groups, which hand each message to their members. The
CEO chat lists only sessions with no `metadata.room`.

Verified on 2026-11-07 (UTC 2026-11-08), after binding:

- `company:sync` updated `br-ceo` to v3 (368 control-plane tools named off, `metadata.role`
  `orchestrator`) and the three GTM agents to v2, then bound `br-ceo`: vault
  `vlt_ngr73z1y572atmkh0q5fqx292n`, credential `vcr_7yf3bbqx521ccznvaex3b39pxc`, and
  `ceo_agent_id` read back as `agt_3hm8pa6q84rtcp9arek8hvqsab`. The next sync changed nothing.
- `company:verify --ceo`, session `ses_x7y22spbvs01x7eqc33zt87j5j` ($0.015): offered
  `board_read`, `board_write`, `read_skill`, `session_spend`, `submit_output`, and nothing else.
- One message, "What is on the board right now?", in a plain `br-ceo` session with no budget given
  (`ses_99909082cnw6e6m5w776wy8sqf`, cap $1.00, $0.022): it read its skill and answered from the
  board's one card by status and assignee, said no `DIR` card exists yet, and created nothing.
- The seat probe (throwaway `br-probe-ceo-seat`, three Haiku sessions, deleted after): both board
  tools allowed, offered both; `board_write` named off, offered `board_read` only; neither named,
  offered both.

Verified on 2026-11-08 UTC, after the member release rule, the sweep hold and the kill switch:

- `company:sync` moved `br-ceo` to v4, the four builders and the three GTM agents to v3, and the
  sweep's input (still paused); the binding was `unchanged`. The next sync changed nothing. It
  warned that `main` on both repos merges with 0 approvals, and that the company board offers
  `board_read` and `board_write` to `br-art-director` (v6), `br-director` (v6), `br-quality-check`
  (v1) and `br-researcher` (v1), none of which this branch syncs.
- `company:verify --ceo`: the lockdown check failed on those four agents and found every served
  control-plane tool (368) named off on the stored `br-ceo`; the `br-ceo` v4 session
  `ses_hf2rh8bpvmdc5grnj2tttfzmsx` ($0.015) was offered `board_read`, `board_write`, `read_skill`,
  `session_spend` and `submit_output`, and called only `submit_output`.
- `company:halt --dry-run` found the sweep already paused and no live `br-ceo` session, and changed
  nothing. The halt itself was not run on the live company. `company:status` listed no session
  waiting for a person and no duplicate title.
- Not run live: a member given a card with an unknown prefix, or one that asks for `main`. Both
  rules are prompt text, checked by tests only.

### Releases are autonomous

By the founder's ruling of 2026-11-07 (also in the founder's `~/.claude/CLAUDE.md`), releases need no
person. When a slug is delivered, the CEO creates `RELEASE: <slug>` for `br-eng-lead`, naming the
`DIR` and `SHIP` cards and the `dev` commit, unless a card with that title already exists. The lead
checks that the slug really is delivered, that the commit is on `dev` and not yet on `main`, then
opens a pull request from `dev` into `main`, merges it, deploys production with the repo's deploy
command once one exists, runs the smoke check and rolls back on failure.

The guard is every member's, not only engineering's, because any agent that writes cards can assign
one to any member. `RELEASE_RULE` in `src/definitions/company/common.ts` is in the prompt of every
agent a card starts: only `br-eng-lead`, following its procedure on a `RELEASE` card, touches `main`
or production. Any other card that asks for that, whatever its prefix and whoever wrote it, goes to
`blocked` with the note `releases belong to the engineering lead`. A card whose prefix the member's
procedure has no section for is not done as its body asks: it goes to `blocked` with the note
`no procedure for this card` (`UNKNOWN_CARD_RULE`). Cards record no creator, so the lead's release
guard rests on the board's state (a `Delivered` comment and a `done` `SHIP` card) rather than on who
wrote the card. A forged `RELEASE` card can at worst promote work that is already reviewed on `dev`.

These are prompts. What GitHub enforces is the `protect-main` and `protect-dev` rulesets: no
deletion, no force push, and a pull request for every change, with 0 approvals because releases are
autonomous.

### Before anyone resumes the sweep

Pausing the sweep is not enough on its own: a card assigned to an agent starts it, sweep or not.
Until both of these are true, only prompts keep an agent off the other repo and off `main` and
`dev`, and `company:sync` and `company:status` say so:

1. **Each token reaches one repo.** Re-mint both fine-grained tokens with "Only select
   repositories": `BR_GITHUB_TOKEN_ENG` gets `boiler-room` only, `BR_GITHUB_TOKEN_DESIGN` gets
   `boiler-room-design` only, each with Contents and Pull requests read and write. Put them in
   `~/.boiler-room.env`, run `pnpm company:sync` (it rewrites `~/.netrc` on all four computers),
   then `pnpm company:verify`, whose four token checks must pass. Its lockdown check also fails
   while any agent the company board over-exposes is unfixed (see "The company board seats every
   agent").
2. **`main` and `dev` have rules, on both repos.** Add the rulesets from
   `docs/company/README.md` section 5 C: `protect-main` and `protect-dev`, each with Restrict
   deletions, Block force pushes, and Require a pull request, and an empty bypass list. On `main`,
   require at least 1 approval from a person whose account holds no agent token; `dev` stays at 0,
   because the lead merges into it. The tokens have no Administration permission, so no agent and
   no script here can add them. Then check that a push straight to `dev` is refused. The preflight
   reads `required_approving_review_count` from GitHub's public rules endpoint; it cannot see the
   bypass list.

### Before you raise a budget or approve a call

A session that stops on its budget is `budget_paused`, and raising its agent's budget resumes it from
its old context: a clone of `br-ceo` paused after it had closed its standing card, and once its cap
was raised it read cards made since, commented `Delivered` and created a `FOUNDER: release` card. One
`br-ceo` cap is shared by the sweep, the digests and the founder's chats, so one raise can resume
several. An `awaiting_approval` session holds a tool call that runs if anyone approves it.

1. Run `pnpm company:status`. It lists every company agent's sessions that are `budget_paused` or
   `awaiting_approval`, and every title that more than one card on the board carries.
2. Interrupt each listed session of that agent first. `pnpm company:halt --held` interrupts all of
   them and changes nothing else.
3. Then raise the budget, or approve.

The `ceo` skill also holds a sweep to its standing card: it reads the card first and before every
write, and stops writing the moment the card is not `doing`.

### The kill switch

Removing the binding does not unbind `br-ceo`: deleting the `Orchestrator control plane` credential
and its vault leaves `ceo_agent_id` set (verified on a probe), and `PATCH /v1/organizations` takes
only `name`, `timezone`, `logo_svg` and `brand` (docs: api/organizations), so nothing sets it back
to `null`. Only deleting the agent clears it. So the kill switch acts on `br-ceo` itself:

```sh
pnpm company:halt --dry-run          # what it would do; changes nothing
pnpm company:halt                    # $0 budget, sweep paused, every live br-ceo session interrupted
pnpm company:halt --unbind=<agt id>  # all that, then delete br-ceo: clears ceo_agent_id
pnpm company:sync --unhalt           # restores a halted br-ceo
```

`company:halt` gives `br-ceo` a $0 budget first, so no turn can run anywhere, then pauses the sweep,
then interrupts every `br-ceo` session that is running, queued, or idle waiting for someone
(`budget_paused`, `awaiting_approval` and the rest), twice, to catch one started in between. It
stores `halted` in place of the definition hash, and `company:sync` refuses to touch a halted
`br-ceo` until `--unhalt`, which first interrupts every held `br-ceo` session, because restoring the
budget would resume them. Sync never resumes the sweep.

`--unbind` needs `br-ceo`'s own id. Deleting it also deletes its sweep and leaves its open cards
unassigned (docs: api/agents), and the next `company:sync` creates a new `br-ceo` with a new id and
binds that one. Both changes to `br-ceo` need an `admin` key, as every change to a bound CEO does.

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
  one session, because card ids derive from the board, the writing session and the title, and
  `board_write` takes no idempotency key (the REST create does). Two sweeps started 90 ms apart each
  created `FOUNDER: release zz-probe-4`. So the CEO lists the board before it creates
  `FOUNDER: release`, `FOUNDER: stalled cards` or a retried `DIR` (titled `DIR: <slug> r2`), lists
  it again right before a `FOUNDER: release`, writes only while its standing card is `doing`, and
  closes a duplicate with the note `duplicate of <id>`. That narrows the race to about a second;
  it does not close it. `company:status` lists every duplicate title.
- **Token reach.** Sections 5 and 6: each token reaches one repo. Live: both tokens can push to both
  repos (checked 2026-11-07). Re-minting them is the founder's (above).
- **Branch rules.** Section 5 C: rules on `main` and `dev`, with 0 approvals. Build: `main` needs at
  least 1 approval from a person, because releases are the founder's and every agent token can
  merge. Adding the rules is the founder's (above).
- **Who writes cards.** The spec seats the roster on the CEO's board. Live: `br-ceo` is the
  organization's CEO, so its board seats every agent of the organization. The GTM agents and the
  crew name `board_write` off; see "The company board seats every agent".

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
