---
name: engineering-deploy
description: How Boiler Room's engineering lead and engineers ship the web app (apps/web) on Cloudflare. Deploying staging from a SHIP card, shipping a bug fix from a HOTFIX card, what a RELEASE card means and how production is released, rolling back, running D1 migrations safely, handling secrets, reading logs, and what to verify after every deploy.
---

# Engineering: deploying the web app

The website and the app are one Next.js app, `apps/web`, running as a Cloudflare Worker. Its
database is Cloudflare D1 and its film files live in Cloudflare R2. Every deploy goes through a
`pnpm web:*` script in the repo root. The scripts wrap `wrangler`, check what can go wrong, and run
the smoke check for you. Never call `wrangler deploy` by hand.

People read the same procedures in `docs/deploy.md`.

## What runs where

| Environment | Worker                       | URL                                                      | D1                       | R2                             | Deploys from             | Who deploys   |
| ----------- | ---------------------------- | -------------------------------------------------------- | ------------------------ | ------------------------------ | ------------------------ | ------------- |
| Local       | workerd on your computer     | `http://localhost:3000` (dev), `:8787` (preview)         | `.wrangler/state`        | `.wrangler/state`              | Your working tree        | You           |
| Staging     | `boiler-room-web-staging`    | `https://boiler-room-web-staging.boilerroom.workers.dev` | `boiler-room-staging`    | `boiler-room-films-staging`    | The tip of `origin/dev`  | `br-eng-lead` |
| Production  | `boiler-room-web-production` | Not deployed yet                                         | `boiler-room-production` | `boiler-room-films-production` | The tip of `origin/main` | The founder   |

Staging makes simulated films (`PIPELINE=simulated`): no crew runs, and every screen labels them.
Production never does (`PIPELINE=naive`): until the Naive pipeline is wired, starting a film there
answers 503.

## Before you start

1. **The keys.** The scripts read `~/.boiler-room.env` (or the file named by `BR_ENV_FILE`). It
   holds `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `CLERK_SECRET_KEY` and
   `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`. Check it exists with `test -f ~/.boiler-room.env && echo
   present`. Never print it, `cat` it, `grep` it or copy a value out of it. If it is missing, move
   your card to `blocked` with the note `credential missing`.
2. **Long steps.** A `bash` call is killed after about 30 seconds. A build and deploy takes about 3
   minutes. Put every long step in a script file and run it in the background, then poll the log:

   ```bash
   cat > ~/step.sh <<'SH'
   cd ~/boiler-room && pnpm install --frozen-lockfile && pnpm web:deploy:staging
   echo "STEP_EXIT $?"
   SH
   nohup bash ~/step.sh > ~/step.log 2>&1 &
   ```

   Poll with `tail -n 30 ~/step.log` until it prints `STEP_EXIT`. Never background a loop inline.
3. **The commit.** `web:deploy:staging` deploys only a clean tree whose `HEAD` is the tip of
   `origin/dev`. Run `git -C ~/boiler-room fetch origin && git -C ~/boiler-room checkout --detach
   origin/dev` first.

## Deploy staging from a `SHIP: <slug>` card

You are `br-eng-lead`. Follow your SHIP procedure to review and merge the pull requests into `dev`,
then:

1. Check out the merged `dev` as above. Run `pnpm install --frozen-lockfile`, `pnpm lint`,
   `pnpm typecheck` and `pnpm test` in a background script. Stop on any failure.
2. If any merged pull request added a file under `apps/web/drizzle/`, read
   [D1 migrations](#d1-migrations) and run `pnpm web:db:migrate:staging`. It must finish before the
   deploy. The deploy refuses to run while staging has migrations it has not applied.
3. Run `pnpm web:deploy:staging` in a background script. It builds the Worker, deploys it with the
   commit as the version tag, and runs the smoke check against the live URL.
4. Do the checks in [After every deploy](#after-every-deploy).
5. If the smoke check fails, roll back at once (see [Roll back](#roll-back)), then find out why.
6. Move `SHIP` to `done`. The note gives the merged pull requests, the `dev` commit, the version id
   and tag from the deploy output, the URL, the migrations you applied (or none), and the smoke
   result line by line.

Engineers do not deploy. An engineer runs `pnpm web:dev` or `pnpm web:preview` to try a change, and
`pnpm web:test:smoke` against the local Worker before opening a pull request that touches
`apps/web`.

## Ship a bug fix from a `HOTFIX: <slug>` card

A bug fix takes the same road as any change, only faster: a pull request into `dev`, staging, then
production. Nothing skips staging.

1. **Lead:** read the card. Write an `ENG: <slug> fix 1/1` card for an engineer with the bug, how to
   reproduce it, and the acceptance criterion "the reproduction no longer fails". Create
   `SHIP: <slug>` blocked by it, as for any build.
2. **Engineer:** branch `fix/<slug>` from `origin/dev`. First write a test that fails because of the
   bug, then fix it, then open a pull request into `dev`. The body names the card, the failing test
   and the checks you ran.
3. **Lead, on the `SHIP` card:** review, merge, and deploy staging as above. Reproduce the bug on
   staging and confirm it is gone. Put both in the `SHIP` note.
4. **Production:** a fix reaches production only through a release (next section). In the `SHIP`
   note, say the fix is ready for release and why it is urgent, so the CEO can ask the founder.

If the bug is live on staging and makes it worse than the version before, roll staging back first
and fix second.

## Releases: the `RELEASE` card and production

A release promotes what is on `dev`, already proven on staging, to `main` and to production.

**Who releases.** Under the current company policy, releases are the founder's: nobody in the
company merges into `main` or deploys production, and the production scripts stop for a person to
type `production` at a terminal. The eng-lead skill on the `feat/company-agents` branch (commit
`d11f6ef`) sets this policy. `docs/company/README.md` on `dev` still describes the lead promoting
`dev` to `main`; the newer policy wins until the founder says otherwise. So if a `RELEASE: <slug>`
card is assigned to you, do not merge and do not deploy. Prepare the release instead:

1. Check that staging runs the tip of `origin/dev`: `curl -s <staging URL>/api/health` shows
   `version`, the first 12 characters of that commit.
2. Run `pnpm web:smoke <staging URL>` and the checks in [After every deploy](#after-every-deploy).
3. List the migrations in `apps/web/drizzle/` that production has not run, from the pull requests
   since the last release.
4. Move the card to `blocked` with the note `releases are the founder's`, and in a comment give the
   `dev` commit, the staging smoke result, the migrations to run, and the release steps below.

**The release steps,** which the founder runs from a terminal:

1. Open a pull request from `dev` into `main` and merge it. Never push to `main`.
2. Check out `origin/main` in a clean tree.
3. `pnpm web:db:migrate:production`, if there are migrations.
4. `pnpm web:deploy:production`. It deploys only the tip of `origin/main` and runs the smoke check.
5. Do the checks in [After every deploy](#after-every-deploy) against production.
6. Close the `RELEASE` card with the `main` commit, the version id and the smoke result.

The first production release also needs `pnpm web:provision:production` and
`pnpm web:secrets:sync:production`, and a Clerk production instance on a custom domain. See
`docs/deploy.md`, "First production release".

## Roll back

A rollback makes an earlier Worker version live again. It takes seconds and needs no build.

1. `pnpm web:rollback:staging` lists the recent versions with their tags (the commit) and rolls back
   to the version before the live one. To pick one: `pnpm web:rollback:staging <version-id>`.
2. Run `pnpm web:smoke <URL>`. `/api/health` now shows the older commit as `version`.
3. Say on your card what you rolled back from and to, and why.

A rollback does not touch D1. The old code runs against the new schema, which is why every
migration must keep working with the code before it. Never "roll back" a migration by hand.

Production rollbacks (`pnpm web:rollback:production`) are the founder's, like releases.

## D1 migrations

The schema lives in `apps/web/src/db/schema.ts`. Migrations are SQL files in `apps/web/drizzle/`,
written by Drizzle and applied by wrangler, which records each one in the database's
`d1_migrations` table.

**Write one:**

1. Change `schema.ts`.
2. `pnpm web:db:generate`. Drizzle writes the next `drizzle/NNNN_<name>.sql` and updates
   `drizzle/meta/`. Read the SQL. Commit both.
3. `pnpm web:db:migrate:local`, then `pnpm web:test`. The API tests apply every migration to a fresh
   database.

**Keep it backwards compatible.** The deployed code must keep working after the migration runs,
because migrations go first and a rollback keeps the new schema. In practice:

- Add a column as nullable or with a default. Add tables and indexes freely.
- Never rename or drop a column or table in one step. Expand, then contract: release 1 adds the new
  column and writes both; release 2 reads the new one; release 3 drops the old one, once no deployed
  version uses it.
- Never change what an existing column means.
- Never edit or delete a migration that has run anywhere. Write a new one.
- A data backfill is its own migration, and it must be safe to run on a database that already has
  the new rows.

**Migrate before you deploy.** `pnpm web:db:migrate:<env>` lists what it will apply, then applies
it. `pnpm web:deploy:<env>` refuses to run while migrations are pending. Apply to staging first;
production gets the same files in the same order at release.

**If a migration goes wrong,** stop and move the card to `blocked`. D1 keeps 30 days of history
(Time Travel): `wrangler d1 time-travel info` shows it, and a restore puts the whole database back
to a moment. A restore on staging needs the founder's go; on production only the founder does it.

## Secrets

| Secret                                          | What it is                                                    | Where it lives                                    |
| ----------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------- |
| `CLERK_SECRET_KEY`                              | Clerk's server key                                            | The env file, and a Worker secret per environment |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`             | Clerk's browser key. Public, but inlined into the build       | The env file, and a Worker secret per environment |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | What the scripts use to reach Cloudflare. Never in the Worker | The env file only                                 |

- `pnpm web:secrets:sync:<env>` copies the Worker secrets from the env file to Cloudflare, one
  `wrangler secret put` each, with the value on stdin. A value named `STAGING_<NAME>` or
  `PRODUCTION_<NAME>` wins for that environment, so the environments can use different Clerk
  instances.
- Local development gets them from `apps/web/.dev.vars`, which `pnpm web:dev` writes. It is
  gitignored. Never commit it, and never write a secret into `wrangler.jsonc`, a `.env` file in the
  app (Next would bundle it into the Worker), a card, a commit, a log or a command line.
- Changing a secret takes effect on the next request; no deploy is needed.
- Before every merge, refuse any diff that matches `sk_live_`, `sk_test_`, `pk_live_`, `pk_test_`,
  `github_pat_`, `ghp_` or `BEGIN OPENSSH PRIVATE KEY`.

## Logs

- `pnpm web:logs:staging` streams the live Worker's requests, `console` output and exceptions. Add
  wrangler tail flags to filter: `pnpm web:logs:staging --status error`, or
  `--search "Unhandled API error"`. It runs until you stop it, so in an agent's `bash` run it as
  `timeout 25 pnpm web:logs:staging --format json > ~/tail.log` and read the file.
- The API logs `Unhandled API error` with the stack for every 500, and `Health: D1 did not answer`
  when D1 is down. The response to the caller never includes the detail.
- Workers observability is on, so the Cloudflare dashboard keeps searchable logs for the founder.

## After every deploy

The deploy script runs the smoke check. It must pass, and you check the rest yourself:

1. **Smoke check passed:** `/api/health` is 200 with `db: ok`; the landing page renders; the
   showcase renders; `/api/films` answers 401 to a signed-out caller; `/films` redirects to sign-in.
2. **The right code is live:** `/api/health` shows `version` equal to the commit you deployed and
   `env` equal to the environment.
3. **A film runs end to end (staging):** sign in, start a video from a URL, and watch it reach
   "Needs you" within a minute. Approve the script and watch it reach "Delivered".
4. **No new errors:** `timeout 25 pnpm web:logs:<env> --status error` shows nothing new.
5. **Write it down:** the version id, the tag, the URL and each check's result go in your card's
   note.

If any check fails and the version before was fine, roll back first, then investigate.

## Rules

- Deploy only committed code at the tip of `origin/dev` (staging) or `origin/main` (production).
  `--any-commit` exists for staging tests only; redeploy `dev` afterwards.
- Never deploy production, merge into `main`, roll back production or touch production D1. Those are
  the founder's.
- Migrations go before the deploy, stay backwards compatible, and are never edited once applied.
- Never print, log, commit or echo a secret, and never put one on a command line.
- Never force-push or rewrite published history. Every change reaches `dev` through a pull request.
