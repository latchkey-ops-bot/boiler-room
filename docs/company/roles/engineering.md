# Engineering: `br-eng-lead` and `br-engineer-1`

Engineering turns specs into merged code on `dev` and a working staging deploy. It also maintains the
[production crew](production-crew.md), which is code in this repo.

## Engineering lead: `br-eng-lead`

**Purpose.** Plan each `BUILD` card into engineer tasks. Review and merge the engineers' pull requests
into `dev`. Deploy staging and report the result.

| Setting | Value |
| --- | --- |
| Model | `anthropic/claude-sonnet-5.5` |
| Harness | `pi` |
| Team | Member of `br-ceo`'s roster, so it is seated on the board |
| Started by | Board cards: `BUILD: <slug>` and `SHIP: <slug>` |
| Budget | `cap_micro_usd: 10_000_000`, `max_task_micro_usd: 1_500_000`, `period: "day"` |
| Credential | The `br-engineering` GitHub token in `~/.netrc`. It reaches `boiler-room` only. |

## Engineer: `br-engineer-1`, and later `br-engineer-2`

**Purpose.** One `ENG` card is one branch and one pull request into `dev`.

| Setting | Value |
| --- | --- |
| Model | `anthropic/claude-sonnet-5.5` |
| Harness | `pi` |
| Team | Member of `br-ceo`'s roster |
| Started by | Board cards: `ENG: <slug> <n>/<total> <task>` |
| Budget | `cap_micro_usd: 10_000_000`, `max_task_micro_usd: 1_500_000`, `period: "day"` |
| Credential | The same `br-engineering` token, written to its own computer |

A second engineer is the only way to run two `ENG` cards at once, because the board starts one card
at a time per agent.

## Tools

| Tool | Lead | Engineer | Note |
| --- | --- | --- | --- |
| `bash`, `read`, `write`, `edit`, `ls`, `find` | allow | allow | Git, pnpm and tests run on the agent's own computer |
| `board_read`, `board_write`, `submit_output`, `session_spend` | allow | allow | |
| `publish_file` | allow | allow | For logs and screenshots too big for a card |
| `apps`, with `config.allowed_apps: [<staging app id>]` | allow | off, with the same explicit `allowed_apps` | Deploy, `db_migrate` and `db_query`, on staging only |
| Every app tool (`br-app.*`), including `send_email`, `leads_upsert` and `request_sample` | off, each one named | off, each one named | Base policy. Without it, every app's tools are offered. |
| `browser`, `web_fetch`, `web_search` | off | off | Engineers read only the repos and their cards |
| `generate_image`, `data_run`, social, email, connections | off | off | |
| GitHub or Clerk MCP servers, the GitHub connection | none | none | Any external MCP call stops `bash` for the rest of the chat (verified) |
| `send_to_agent`, `wait_for_agents`, `list_agents`, `ask_operator`, `request_tools`, `propose_plan`, `vetta.tools_search`, `vetta.tools_execute` | off | off | Base policy |

No identity. No vault credentials.

**Clerk.** No agent holds the Clerk keys. They are Naive app secrets, set by the provisioning script.
Engineers write the `@clerk/nextjs` code and the lead redeploys. If agents need Clerk admin actions,
such as listing users, engineering adds them as tools on the app's own `/mcp` route. That route
calls Clerk's Backend API with the secret on the server side. Clerk dashboard settings, such as
sign-in providers and the production domain, are the founder's.

**Database.** Use the Naive app's own Postgres. Engineers write migrations as files in the repo. The
lead applies them to staging with `db_migrate`, which is idempotent by name. Two caveats: `db_rest`
runs as the service role and bypasses row-level security, and deleting the app deletes its database.

## Procedure: engineer, on an `ENG` card

1. `board_read` the card. Move it to `doing`.
2. Check that `~/.netrc` exists. If it is missing, move the card to `blocked` with the note
   `credential missing`, and stop.
3. Clone or fetch `https://github.com/latchkey-ops-bot/boiler-room`. Then
   `git checkout -b feat/<slug>-<n> origin/dev`.
4. Make the change the card asks for, following `CLAUDE.md`.
5. Run `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm typecheck` and `pnpm test`. The `bash`
   tool times out at 30 s, so run anything long as `nohup bash step.sh > step.log 2>&1 &` and poll
   the log. Always put the long step in a script file. In the probe, a loop backgrounded inline
   hung the tool call, while the script form returned at once. Before each long step, read
   `session_spend`. At $1.00 of the $1.50 ceiling, comment progress and move the card to `blocked`
   with the note `budget`. A session that hits the ceiling leaves its card stuck in `doing`.
6. Commit. End the message with `Board-Card: <crd_ id>` and `Naive-Session: <ses_ id>`.
7. Push the branch over HTTPS. Open a PR into `dev` with `curl --netrc` against
   `POST /repos/latchkey-ops-bot/boiler-room/pulls`. The PR body links the card.
8. Comment the PR URL on the card. Move the card to `done` with a note giving the PR URL and the
   test summary. If the change cannot be made, move it to `blocked` and give the reason instead.

## Procedure: lead, on a `BUILD` card

1. Read `specs/<slug>.md` and `design/<slug>/` from `boiler-room-design` `dev`. It is public, so it
   needs no token. Record the commit you read.
2. Split the work into `ENG` cards, each small enough for one PR. Give each the acceptance criteria
   it must meet, and order them with `blocked_by`.
3. Create `SHIP: <slug>`, assigned to yourself and `blocked_by` every `ENG` card.
4. Move `BUILD` to `done`, with a note listing the plan and the spec commit.

## Procedure: lead, on a `SHIP` card

1. For each PR named in an `ENG` card's note, and only those: read the diff, and check it against
   the acceptance criteria and `CLAUDE.md`.
2. Refuse any diff that matches a secret pattern, such as `sk_live_`, `sk_test_`, `github_pat_` or
   `BEGIN OPENSSH PRIVATE KEY`.
3. Merge each passing PR into `dev`, squashed, through the REST API. Then run lint, typecheck and
   tests on the merged `dev`.
4. Deploy staging with the `apps` tool, and smoke-check it with `curl`.
5. Move `SHIP` to `done`. The note gives the merged PRs, the `dev` commit, the deployment id and
   URL, and the smoke result.
6. If a PR fails review, comment why on the PR. Create `ENG: <slug> fix <n>` for its engineer, and
   `SHIP: <slug> r2` blocked by that fix card. Then move this card to `done` with a note saying it
   was sent back.

## Policy: what engineering may not do

- Merge into `main`, deploy production, or push straight to `dev` or `main`. The branch rules
  enforce the first and last. The others are held by the prompt and the `allowed_apps` limit.
- Force-push, or rewrite published history.
- Merge a PR that no `ENG` card names, or act on issues, comments or PRs from outside accounts.
  Both repos are public.
- Print, log, commit or echo a token or app secret.
- Read the inbox, social content or arbitrary web pages.
- An engineer may not merge at all, even its own PR. The token could do it, so this rule is held by
  the prompt, and the lead checks it in review.

## Reports

| What | To whom | How |
| --- | --- | --- |
| The PR, and whether its tests pass | The lead and the CEO | `ENG` card note, and the digest |
| The plan for a slug | The CEO | `BUILD` card note |
| What shipped to staging | The CEO | `SHIP` card note |
| Blockers | The CEO | Card moved to `blocked`, with the reason |

## Measured and unverified

- **Measured.** One engineer run on Sonnet cloned the repo, installed it, ran 522 passing tests,
  branched, and committed with trailers in 133 s. It cost $0.066 for the model and $0.006 for the
  computer. Peak memory was 566 MB of 958 MB. Typecheck and build were not run. Heavier dependencies
  will need the 2 GiB swap recipe.
- **Measured.** A Sonnet session budget of $0.30 was refused at pre-flight. $1.00 was accepted.
- **Not verified.** A real push or PR. The probe's push was refused because no credential was
  registered. Git and the REST API reading `~/.netrc` is untested.
- **Not verified.** The agent-side `apps` deploy action. Only the REST deploy route was run.
- **Not verified.** Whether `~/.netrc` survives a change of computer. Step 2 of the engineer
  procedure catches it.
