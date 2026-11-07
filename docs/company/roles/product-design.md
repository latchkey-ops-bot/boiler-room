# Product and design: `br-product` and `br-design`

Product and design turn the CEO's direction into a spec that engineering can build and test. They
own the design repo, `latchkey-ops-bot/boiler-room-design`, and they never write to the code repo.

## Product: `br-product`

**Purpose.** Turn a `DIR` card into a testable spec, then hand it to design and engineering.

| Setting | Value |
| --- | --- |
| Model | `anthropic/claude-sonnet-5.5` |
| Harness | `pi` |
| Team | Member of `br-ceo`'s roster |
| Started by | Board cards: `DIR: <slug>` |
| Budget | `cap_micro_usd: 4_000_000`, `max_task_micro_usd: 1_000_000`, `period: "day"` |
| Credential | The `br-design` GitHub token in `~/.netrc`. It reaches `boiler-room-design` only. |

## Design: `br-design`

**Purpose.** Design the screens, states and visuals that a spec needs, check the staging app
against them, and look after the brand's visual system.

| Setting | Value |
| --- | --- |
| Model | `anthropic/claude-sonnet-5.5` |
| Harness | `pi` |
| Team | Member of `br-ceo`'s roster |
| Started by | Board cards: `DESIGN: <slug>` |
| Budget | `cap_micro_usd: 5_000_000`, `max_task_micro_usd: 1_000_000`, `period: "day"`. At most 4 image renders per card. |
| Credential | The same `br-design` token, written to its own computer |

## Tools

| Tool | Product | Design | Note |
| --- | --- | --- | --- |
| `bash`, `read`, `write`, `edit`, `ls`, `find` | allow | allow | To commit to the design repo, and for Playwright screenshots |
| `board_read`, `board_write`, `submit_output`, `session_spend` | allow | allow | |
| `publish_file` | allow | allow | |
| `web_search` | allow | off | Market research, from result snippets only |
| `browser` | off | allow, limited to the staging app's domain | Requests to any other domain are refused (verified) |
| `generate_image` | off | allow | It asks by default, so it must be named |
| `find_stock_photo`, `view_image` | off | allow | `view_image` is for critiquing its own screenshots |
| `br-app.feedback_summaries` (the app's own MCP tool, read only) | allow | allow | Planned. Fixed-field summaries from the inbox reader, never raw email. |
| `company.set_brand`, `company.set_logo` | off | off | They always need owner approval |
| `web_fetch`, `apps`, `data_run`, social, email, connections | off | off | |
| Base policy tools | as in [README section 3](../README.md#3-roles) | | |

No identity. No vault credentials. No external MCP servers.

## The artefacts

**`specs/<slug>.md`**, written by product on branch `spec/<slug>`:

```text
# <slug>
Direction: <crd_ id of the DIR card>
Problem: who has it, and what it costs them.
Acceptance criteria:
  1. A check that a test or a person can run, and get a yes or no.
  2. ...
Out of scope: ...
UI: yes or no
Data and claims: what is stored, and the source of every number shown.
Open questions: each one is also a comment on the DIR card.
```

**`design/<slug>/`**, written by design on the same branch:

- `README.md`: screens, states (empty, loading, error, done), visible copy, and the tokens and
  components it uses
- `*.png`: one image per screen and state

## Procedure

1. **Product, on a `DIR` card.** Read the card and both repos. Write the spec. Push `spec/<slug>`
   and open a PR into `dev`. If the spec needs UI, create `DESIGN: <slug>` assigned to `br-design`.
   Create `BUILD: <slug>` assigned to `br-eng-lead`, `blocked_by` the `DESIGN` card if there is
   one. Its body links the spec PR and repeats the acceptance criteria. If there is no UI, merge
   the spec PR now. Move `DIR` to `done` with the PR link.
2. **Design, on a `DESIGN` card.** Check out `spec/<slug>`. To see the current app, take a
   screenshot of staging with Playwright: turn on the 2 GiB swap first, then launch Chromium with
   `--no-sandbox --disable-dev-shm-usage --disable-gpu`. Add `design/<slug>/` and push it to the
   same branch. Merge the spec PR into `dev`. Move `DESIGN` to `done`. That clears `BUILD` and
   starts the lead.
3. **Design, after `SHIP`.** When a `SHIP` card with UI lands, the CEO may assign
   `DESIGN: <slug> check`. Design screenshots staging, compares it with `design/<slug>/`, and files
   any differences as a new `DIR` proposal in its note.

## Policy: what product and design may not do

- Write to `boiler-room`. Their token cannot.
- Put a number in a spec or design without its source. This is the same claims rule that
  `CLAUDE.md` sets for films.
- Use another company's logo or brand assets, except in a customer's own film.
- Post, email, or publish anything outside the org.
- Read the inbox or social content directly. They see only the reader's fixed-field summaries.
- Render more than 4 images per card. Media is billed after the call, so the per-task ceiling does
  not stop a render.

## Reports

| What | To whom | How |
| --- | --- | --- |
| A spec, ready to build | The CEO and the lead | `DIR` note, and the `BUILD` card |
| A design, ready to build | The lead | `DESIGN` done, which clears `BUILD` |
| Open questions | The CEO | Comments on the `DIR` card |

## Measured and unverified

- **Measured.** One image render on `recraft/recraft-v4.1-flash` cost $0.007. The browser
  tool returns a 2560x1440 JPEG. Playwright on a 1 GiB computer needs the 2 GiB swap. With it, a
  full-page capture took 16.6 s.
- **Not verified.** Product or design creating cards for the lead. It is the same create-and-assign
  path that was run for lead to engineer.
- **Not verified.** Pushes with the `br-design` token. No token exists yet.
