# GTM: `br-gtm-lead`, `br-scout`, `br-social` and `br-inbox-reader`

GTM finds the people who need launch films, shows them a sample, and puts the day's films on X.
**It is active in code** (`GTM_ACTIVE` is `true` in `agents/src/definitions/company/gtm.ts`, since
2026-11-08) and goes live once the main session syncs it. How it runs each day is in
[../gtm-operations.md](../gtm-operations.md), which replaces this file's older email and tools
sections.

Two founder decisions hold for the whole hackathon:

- **No real email.** The email lane is dry run in code (`EMAIL_FORCED_DRY_RUN` in
  `agents/src/gtm/config.ts`), whatever the store's flags say. Drafts are written; nothing is sent.
- **X carries GTM, by the founder's hand.** X refused programmatic posts from `@boilerroomstudi`
  ("the network refused it", 4 attempts through Naive Social), so the executor posts nothing. It
  puts the day's posts on one `FOUNDER: gtm pack <date>` card, and the founder posts them. Nobody
  automates X through a browser or a phone.

## Agents

| Agent             | Purpose                                                                                                 | Model                         | Started by                                  |
| ----------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------- | ------------------------------------------- |
| `br-gtm-lead`     | Picks the day's startup for X (and for email drafts), writes email subjects and openers, plans outreach | `anthropic/claude-sonnet-5.5` | The GTM executor's `pick` brief, once a day |
| `br-scout`        | Qualifies the startups the executor found, from their own websites                                      | `anthropic/claude-haiku-5.5`  | The executor's `qualify` briefs             |
| `br-social`       | Chooses the caption template and quote for the day's X post                                             | `anthropic/claude-haiku-5.5`  | The executor's `pick` brief                 |
| `br-inbox-reader` | Reads one inbound email the executor fenced, and returns fixed fields                                   | `anthropic/claude-haiku-5.5`  | The executor's `inbox` phase (planned, S6)  |

No GTM agent posts, sends, orders or spends: the executor, which is code, does every action after
checking their typed output. There is no `br-gtm-inbox` deployment: the executor runs its own
schedule (gtm-operations.md section 2).

Haiku agents get the line "Never call two tools in the same step." in their system prompt. Haiku
otherwise fires tool calls in parallel, which broke ordered steps in earlier probes.

## Budgets

In code since 2026-11-08 (`GTM_ACTIVE_BUDGETS`), and on Naive once synced:

| Agent             | Budget                      |
| ----------------- | --------------------------- |
| `br-gtm-lead`     | $4 a day, $1.00 per task    |
| `br-scout`        | $5 a day, $1.00 per task    |
| `br-social`       | $2 a day, $1.00 per task    |
| `br-inbox-reader` | $1 a day, $0.15 per message |

The executor's own caps are tighter for its day: $7.00 a day for all of GTM, films included
(gtm-operations.md section 14). A sample film is also held to the website's real-film caps.

Unit prices seen: Find Work Email $0.042 a call, Enrich Person $0.032, Search Google $0.00015. A
social post costs $0.013, or $0.0325 when X is included, or $0.273 when X is included and the text
has a link.

## Tools

| Tool                                                                                 | GTM lead, scout, social | Inbox reader |
| ------------------------------------------------------------------------------------ | ----------------------- | ------------ |
| `read_skill`, `session_spend`, `submit_output`                                       | allow                   | allow        |
| `board_read`, `board_write`                                                          | off, each one named     | off          |
| Every social, data, app, sandbox, file, web and media tool; every MCP server; `apps` | off, each one named     | same         |
| Identity, vault, computer                                                            | none                    | none         |

No GTM agent is on the board (`GTM_ON_BOARD` in `gtm.ts` is empty). `board_write` lets its holder
start any agent by assigning it a card, every GTM agent reads outside text in its briefs, and Naive
cannot narrow `board_write` by prefix, assignee or session. Putting one on the board needs the
founder's ruling confirmed by the main session first, and should then give card work to an agent
that never takes an executor brief (gtm-operations.md section 6).

## Cards

| Card                                         | Written by              | Worked by | What it asks                                          |
| -------------------------------------------- | ----------------------- | --------- | ----------------------------------------------------- |
| `GTM: <date>`, `REMOVE:`, `FOUNDER: gtm ...` | the GTM executor (code) | nobody    | The day's record, removals, and what a person must do |

`OUTREACH:`, `LEADS:` and `POST:` cards, and the skill sections that work them, wait on
`GTM_ON_BOARD`: while it is empty, no one writes or works them.

## Email

Email is dry run for the whole hackathon. The cold sender, the reply lane and the AgentMail inbox
reader are specified in gtm-operations.md sections 10.3, 10.4 and 12; none sends anything while
`EMAIL_FORCED_DRY_RUN` is `true`.

## Policy: what GTM may not do

- Run code, write files, deploy, or hold any repo token.
- Send to an address that is not on the allowlist, or more than the daily quota. The app enforces
  this, not the prompt.
- Post a number that does not come from a quoted source. This is the claims rule from `CLAUDE.md`.
- Post or send a sample film made from another company's brand to anyone but that company, except
  the founder's own hand post on X from the day's pack (the founder's decision). The website shows a
  sample only on its unlisted film page and to Boiler Room's own account, never on the showcase.
- Post on X by code, or through a browser or a phone. The founder posts the pack by hand.
- Reply to social comments. There is no tool for it.
- Read raw email. Only the reader sees it, and the reader can send nothing.

## Reports

| What                       | To whom     | How                                          |
| -------------------------- | ----------- | -------------------------------------------- |
| Leads, picks, films, posts | The CEO     | The `GTM: <date>` card's note (the report)   |
| The day's posts, by hand   | The founder | `FOUNDER: gtm pack <date>`                   |
| Posts made                 | The CEO     | The next day's report: POSTED and NOT POSTED |

## What the founder does each day

1. After the day's run, open `FOUNDER: gtm pack <date>` on the company board. The run is by hand,
   `pnpm gtm:day --live --board`; the systemd timer stays off. The card is there only when a real,
   QC-passed sample film is ready.
2. Before the first post, set the `@boilerroomstudi` bio to say how to ask for a removal: every
   caption ends "Removal on request: see our bio".
3. For each post on it: open the film page, download the film, and post it on X from
   `@boilerroomstudi` with the caption exactly as written. Where the card names an X post, quote-post
   it; otherwise post the film on its own. Every number in a caption must be quoted from the
   startup's own site; the code's captions hold none.
4. Move the card to `done`. Until then, nothing counts as posted: the next day's report counts the
   posts on a done pack card as POSTED and every other as NOT POSTED.
5. To stop a day, comment `HOLD` on the `GTM: <date>` card. To take a film down, comment
   `REMOVE <lead id>`; a startup can also press "Remove this film" on its film page.

## Activation checklist

Done in code on 2026-11-08 (this branch): `GTM_ACTIVE`, the budgets above, the website's
sample-film routes, pack mode, and the forced email dry run. The GTM agents stay off the board and
off `br-ceo`'s roster (`GTM_ON_BOARD` is empty) until the main session confirms otherwise with the
founder.

Left, in order (gtm-operations.md section 15):

1. The main session merges and runs `company:sync`.
2. Staging: `BR_HOUSE_ACCOUNT_ID` set to Boiler Room's account, `pnpm web:db:migrate:staging`, the
   GTM token minted (`pnpm web:runner:keys:staging mint --gtm-token`) and synced
   (`pnpm web:secrets:sync:staging`), `GTM_APP_URL` set to the staging URL, and a deploy.
3. `company:verify --lockdown` passes: every agent the company board seats is offered only the board
   tools its definition gives it.
4. The flags (`pnpm gtm:flags`): `mode live`, `film_lane live`, `x_lane pack`, the founder's `usr_`
   id, and, after one canary film reports its cost, `film_canary_cost_reported`.
5. Update the system map in `boiler-room-design`.

## Not verified

- Posting, scheduling and metrics on Naive Social. X refused every programmatic post from
  `@boilerroomstudi`, so posting is by the founder's hand from the pack.
- The webhook route, the app starting a reader session, the scoped key that allows it, and the
  GTM lead's hourly fire. The key's scopes come from the docs.
- Whether an app tool that returns email text sets Naive's read flag. Only a tool returning `pong`
  was tested.
- A $0 agent parking a card that was assigned to it (docs).
- Whether a card-started session selects the agent's persona. Social tools appear only in a session
  that selects it (verified). If a card-started session does not, `br-social` and the GTM lead's
  identity tools must run from a deployment that names the persona.
- Whether `data_run` sets the read flag.
