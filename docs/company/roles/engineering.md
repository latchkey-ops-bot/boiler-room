# Engineering: `br-eng-lead` and `br-engineer-1`

Engineering turns specs into merged code on `dev` and a working staging deploy, and ships releases
to `main` and production. It also maintains the [production crew](production-crew.md), which is
code in this repo.

## Engineering lead: `br-eng-lead`

**Purpose.** Plan each `BUILD` card into engineer tasks. Review and merge the engineers' pull requests
into `dev`. Deploy staging and report the result. On a `RELEASE` card from the CEO, promote `dev` to
`main` through a pull request and deploy production.

| Setting    | Value                                                                                                                                                 |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Model      | `anthropic/claude-sonnet-5.5`                                                                                                                         |
| Harness    | `pi`                                                                                                                                                  |
| Team       | Member of `br-ceo`'s roster, so it is seated on the board                                                                                             |
| Started by | Board cards: `BUILD: <slug>`, `SHIP: <slug>` and `RELEASE: <slug>`                                                                                    |
| Budget     | `cap_micro_usd: 10_000_000`, `max_task_micro_usd: 1_500_000`, `period: "day"`                                                                         |
| Credential | The engineering GitHub token in `~/.netrc`, and the Cloudflare keys in `~/.boiler-room.env` (mode 600), both written by `company:sync` (see Hosting). |
| Skills     | `eng-lead` (its procedure) and `engineering-deploy` (from `skills/` at the repo root)                                                                 |

## Engineer: `br-engineer-1`, and later `br-engineer-2`

**Purpose.** One `ENG` card is one branch and one pull request into `dev`.

| Setting    | Value                                                                         |
| ---------- | ----------------------------------------------------------------------------- |
| Model      | `anthropic/claude-sonnet-5.5`                                                 |
| Harness    | `pi`                                                                          |
| Team       | Member of `br-ceo`'s roster                                                   |
| Started by | Board cards: `ENG: <slug> <n>/<total> <task>`                                 |
| Budget     | `cap_micro_usd: 10_000_000`, `max_task_micro_usd: 1_500_000`, `period: "day"` |
| Credential | The same engineering token, in `~/.netrc`. No Cloudflare key                  |

A second engineer is the only way to run two `ENG` cards at once, because the board starts one card
at a time per agent.

## Tools

| Tool                                                                                                                                            | Lead                | Engineer            | Note                                                                                                 |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | ------------------- | ---------------------------------------------------------------------------------------------------- |
| `bash`, `read`, `write`, `edit`, `ls`, `find`                                                                                                   | allow               | allow               | Git, pnpm and tests run on the agent's own computer                                                  |
| `board_read`, `board_write`, `submit_output`, `session_spend`                                                                                   | allow               | allow               |                                                                                                      |
| `publish_file`                                                                                                                                  | allow               | allow               | For logs and screenshots too big for a card                                                          |
| `apps`, with `config.allowed_apps: []`                                                                                                          | off                 | off                 | The web app runs on Cloudflare, not as a Naive app. Deploys are `pnpm web:*` scripts run with `bash` |
| Every app tool (`br-app.*`), including `send_email`, `leads_upsert` and `request_sample`                                                        | off, each one named | off, each one named | Base policy. Without it, every app's tools are offered.                                              |
| `browser`, `web_fetch`, `web_search`                                                                                                            | off                 | off                 | Engineers read only the repos and their cards                                                        |
| `generate_image`, `data_run`, social, email, connections                                                                                        | off                 | off                 |                                                                                                      |
| GitHub or Clerk MCP servers, the GitHub connection                                                                                              | none                | none                | Any external MCP call stops `bash` for the rest of the chat (verified)                               |
| `send_to_agent`, `wait_for_agents`, `list_agents`, `ask_operator`, `request_tools`, `propose_plan`, `vetta.tools_search`, `vetta.tools_execute` | off                 | off                 | Base policy                                                                                          |

No identity. No vault credentials.

**Hosting.** The website and the app are one Next.js app, `apps/web`, on Cloudflare: a Worker per
environment, D1 for the database and R2 for film files. Staging (`boiler-room-web-staging`) runs
the tip of `origin/dev`; production (`boiler-room-web-production`, not deployed yet) runs the tip of
`origin/main`. Engineering deploys only through the `pnpm web:*` scripts, following
[`skills/engineering-deploy`](../../../skills/engineering-deploy/SKILL.md); people read the same
procedures in [`docs/deploy.md`](../../deploy.md). There is no `apps` tool and no `br-app.*` tool:
both are named off on every engineering agent, because Naive offers an unnamed tool at "ask". The
scripts read the keys from `~/.boiler-room.env`. `company:sync` writes that file on the lead's
computer only, with mode 600 and only `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` in it, and
checks that no other computer with a token has one; `company:verify` checks both again. Engineers'
computers never get it: engineers do not deploy. The build also reads
`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, which is not placed, so until it is the lead's deploys stop at
the build and its card goes to `blocked` with `credential missing`.

**Clerk.** Engineers never hold the Clerk keys. They are Worker secrets, which
`pnpm web:secrets:sync:<env>` copies from the env file. Production takes only the
`PRODUCTION_`-prefixed keys and refuses a development key. Engineers write the `@clerk/nextjs` code
and the lead redeploys. If agents need Clerk admin actions, such as listing users, engineering adds
them as tools on the app's own `/mcp` route. That route calls Clerk's Backend API with the secret
on the server side. Clerk dashboard settings, such as sign-in providers and the production domain,
are the founder's.

**Database.** Cloudflare D1. The schema is `apps/web/src/db/schema.ts`, and engineers write each
migration with `pnpm web:db:generate` as an SQL file in `apps/web/drizzle/`. The lead applies
migrations to staging with `pnpm web:db:migrate:staging` before it deploys, and a release applies
them to production. `pnpm web:deploy:<env>` refuses to run while migrations are pending. A migration
keeps the running code working (add first, rename or drop only in a later release) and is never
edited once applied. A rollback never touches D1.

## Procedure: engineer, on an `ENG` card

1. `board_read` the card. Move it to `doing`.
2. Check that `~/.netrc` exists, in a `bash` call of its own, before anything else. If it is
   missing, move the card to `blocked` with the note `credential missing`, and stop.
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
3. Check out each PR's head and run lint, typecheck and tests on it, before any merge. A PR whose
   checks fail has failed review (step 7), unless `origin/dev` fails the same check without it:
   then the PR passes when its own changed files do, and the lead creates `ENG: <slug> fix <n>` to
   fix `dev`. The engineer's note that the checks pass is not a check.
4. Merge each PR that passed review and its checks, squashed, through the REST API. Then run the
   same checks on the merged `dev`.
5. If the change has a migration, apply it with `pnpm web:db:migrate:staging`. Deploy staging with
   `pnpm web:deploy:staging`, which deploys only the tip of `origin/dev` and runs the smoke check,
   then do the skill's checks after every deploy.
6. Move `SHIP` to `done`. The note gives the merged PRs, the `dev` commit, the Worker version id and
   URL, and the smoke result.
7. If a PR fails review or its checks, comment why on the PR. Create `ENG: <slug> fix <n>` for its engineer, and
   `SHIP: <slug> r2` blocked by that fix card. Then move this card to `done` with a note saying it
   was sent back.

## Procedure: lead, on a `RELEASE` card

Releases are autonomous. The CEO decides them: when a slug is delivered, it creates one
`RELEASE: <slug>` card for `br-eng-lead`. The lead carries it out. It claims the card, then checks
each condition below with `board_read` and git, and moves the card to `blocked` with the reason if
any one fails:

1. The title is exactly `RELEASE: <slug>`, it is assigned to `br-eng-lead`, and its body names a
   `DIR` card, a `SHIP` card and a `dev` commit.
2. That `DIR` card has a comment saying `Delivered`, and that `SHIP` card is `done`.
3. The named commit is on `dev`.
4. If `main` already contains the commit, the release already happened: move the card to `done`
   with the note `already on main`, and stop.

Then it releases:

1. Open a PR from `dev` into `main` titled `release: <slug>`, with the `DIR` and `SHIP` cards in its
   body. Wait for its checks, and merge it with a merge commit. Never push to `main`.
2. In a clean tree at `origin/main`, apply production's pending migrations with
   `pnpm web:db:migrate:production --release-card <card id>`, then run
   `pnpm web:deploy:production --release-card <card id>`, which deploys only the tip of
   `origin/main`, runs the smoke check, and rolls production back by itself if the check fails.
3. If a check fails, the deploy has rolled back; a later check that fails takes
   `pnpm web:rollback:production --release-card <card id>`. Either way, move the card to `blocked`
   with what failed.
4. If production has not had its first release (no D1 database, no `PRODUCTION_` Clerk keys), move
   the card to `blocked` with `production not provisioned`: that release is the founder's.
5. Move the card to `done` with the PR, the `main` commit, the Worker version id and the smoke
   result.

**The production guard.** Every production script stops for a person to type `production` at a
terminal. The lead has none, so it names the card it is working with `--release-card`, which the
scripts accept only for a migration, a deploy or a rollback, and for the first two only from a clean
tree at the tip of `origin/main`. Provisioning and Worker secrets never take a card.

Any other card that asks the lead, or anyone else, to touch `main` or production is moved to
`blocked` with the note `releases belong to the engineering lead`.

## Policy: what engineering may not do

- Push straight to `dev` or `main`; every change goes through a PR. The branch rules enforce this.
- Engineers may not merge into `main` or deploy at all. Only `br-eng-lead` deploys, and production
  only from a `RELEASE` card. This is held by the prompt, and by the keys: engineers' computers get
  no Cloudflare key, and every production script stops unless a person types `production` or the
  lead names its `RELEASE` card from a clean tree at `origin/main`.
- Force-push, or rewrite published history.
- Merge a PR that no `ENG` card names, or act on issues, comments or PRs from outside accounts.
  Both repos are public.
- Print, log, commit or echo a token or app secret.
- Read the inbox, social content or arbitrary web pages.
- An engineer may not merge at all, even its own PR. The token could do it, so this rule is held by
  the prompt, and the lead checks it in review.

## Reports

| What                               | To whom              | How                                      |
| ---------------------------------- | -------------------- | ---------------------------------------- |
| The PR, and whether its tests pass | The lead and the CEO | `ENG` card note, and the digest          |
| The plan for a slug                | The CEO              | `BUILD` card note                        |
| What shipped to staging            | The CEO              | `SHIP` card note                         |
| What reached `main` and production | The CEO              | `RELEASE` card note                      |
| Blockers                           | The CEO              | Card moved to `blocked`, with the reason |

## Measured and unverified

- **Measured.** One engineer run on Sonnet cloned the repo, installed it, ran 522 passing tests,
  branched, and committed with trailers in 133 s. It cost $0.066 for the model and $0.006 for the
  computer. Peak memory was 566 MB of 958 MB. Typecheck and build were not run. Heavier dependencies
  will need the 2 GiB swap recipe.
- **Measured, 2026-11-08, on `br-engineer-1`'s computer** (1 vCPU, 958 MB, 10 GB disk, Ubuntu
  24.04, Node 24.22.1), by commands run on the computer, with no model session: after the 2 GiB
  swap recipe, `pnpm install --frozen-lockfile` of the whole workspace took 22 s (1.2 GB of
  `node_modules`, 3.6 GB of disk left); `pnpm --filter @boiler-room/motion test` passed 500 tests in
  27 files in 10 s; `typecheck` passed in 4 s; one Remotion still (`nova.campaign.json`, 16:9,
  frame 30) rendered in 26 s, including the 102.5 MB Chrome Headless Shell download, and a second
  (9:16, frame 60) in 6 s. Peak use, sampled every 5 s: 911 MB of memory and 167 MB of swap. So
  engineers render their own stills, one at a time, with swap on.
- **Measured.** A Sonnet session budget of $0.30 was refused at pre-flight. $1.00 was accepted.
- **Verified by the role evals, 2026-11-08** ([`../evals.md`](../evals.md)). A practice engineer
  with the engineering token in `~/.netrc` pushed `feat/eval-ehb6zq-clamp-1` and opened pull
  request #25 into `dev` with `curl --netrc`, and its motion tests, typecheck and Biome passed on
  the head (the PR was then closed and the branch deleted). A practice lead fetched a pull
  request's head, ran the checks on it, and squash-merged it through the REST API into a practice
  base branch; given a pull request whose test fails, it sent it back without merging.
- **Not verified.** A deploy or a release by the lead. Its computer has the Cloudflare keys, but
  not `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, which the build reads, and production is not provisioned.
- **Not verified.** Whether `~/.netrc` survives a change of computer. Step 2 of the engineer
  procedure catches it.
