# Deploying the web app

The website and the app are one Next.js app in `apps/web`, running on Cloudflare. This page is for
people: what runs where, how to set it up, and how a change reaches customers. The engineering
agents follow the same procedures in
[`skills/engineering-deploy/SKILL.md`](../skills/engineering-deploy/SKILL.md).

## What runs where

```mermaid
flowchart LR
  browser["Founder's browser"] --> worker["Cloudflare Worker<br/>Next.js pages and API"]
  worker --> d1[("D1<br/>accounts, films, events,<br/>approvals, deliverables")]
  worker --> r2[("R2<br/>film files")]
  worker --> clerk["Clerk<br/>sign-in"]
  worker -->|"create, pause, resume, destroy"| naive["Naive<br/>one computer per real film"]
  naive -.->|"signed callbacks, uploads"| worker
```

| Environment | Worker                       | URL                                                      | D1                       | R2                             | Deploys                  | Who                                |
| ----------- | ---------------------------- | -------------------------------------------------------- | ------------------------ | ------------------------------ | ------------------------ | ---------------------------------- |
| Local       | workerd on your computer     | `http://localhost:3000`, or `:8787` for the built Worker | `.wrangler/state`        | `.wrangler/state`              | Your working tree        | Anyone                             |
| Staging     | `boiler-room-web-staging`    | https://boiler-room-web-staging.boilerroom.workers.dev   | `boiler-room-staging`    | `boiler-room-films-staging`    | The tip of `origin/dev`  | `br-eng-lead`                      |
| Production  | `boiler-room-web-production` | Not deployed yet                                         | `boiler-room-production` | `boiler-room-films-production` | The tip of `origin/main` | `br-eng-lead`, on a `RELEASE` card |

Staging makes simulated films: no crew runs, the script is a sample, and every screen says
"Simulated". The founders named in `REAL_FILM_USERS` get real films there instead, once real films
are set up (see "Real films on staging"). Production never makes simulated films. Until real films
are set up there, starting a
film in production answers "The film crew is not connected yet".

## The stack, and why

| Piece                    | Version         | Notes                                                                                 |
| ------------------------ | --------------- | ------------------------------------------------------------------------------------- |
| Next.js, App Router      | 16.4.5          | The OpenNext adapter accepts Next `>=16.4.5` or the latest 15.5                       |
| OpenNext Cloudflare      | 1.20.16         | Builds Next into a Worker with static assets                                          |
| wrangler                 | 4.158.0         | In `apps/web`, not global. Every script runs it with `pnpm exec`                      |
| Clerk, `@clerk/nextjs`   | 7.9.25          | Runs in `src/middleware.ts` on the Edge runtime                                       |
| Drizzle ORM, drizzle-kit | 0.45.4, 0.31.11 | Schema and migrations for D1. drizzle-kit writes flat SQL files that wrangler applies |

One choice looks odd and is deliberate: the app uses `middleware.ts`, which Next 16 calls deprecated,
instead of `proxy.ts`. Next 16's `proxy.ts` always runs on the Node.js runtime, and the OpenNext
Cloudflare adapter supports only Edge middleware. The build prints a deprecation warning; ignore it
until the adapter supports Node middleware. This combination was built and run on workerd before
anything else was written: Clerk protected a page, an API route answered 401, and a route read D1.

## Credentials

Every script reads keys from `~/.boiler-room.env` at run time (or the file in `BR_ENV_FILE`). Values
go to wrangler through its environment or stdin, never on a command line, and are never printed.

| Name                                            | Used for                                                       |
| ----------------------------------------------- | -------------------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | Creating D1 and R2, migrating, deploying, secrets, logs        |
| `CLERK_SECRET_KEY`                              | Sign-in, on the server. Becomes a Worker secret                |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`             | Sign-in, in the browser. Inlined at build, and a Worker secret |

Any of them can be set per environment with a prefix: `STAGING_CLERK_SECRET_KEY` wins over
`CLERK_SECRET_KEY` for staging. Production reads only `PRODUCTION_CLERK_SECRET_KEY` and
`PRODUCTION_NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, never the unscoped keys, and the build and secret
sync stop if either is a development key (`sk_test_` or `pk_test_`). Today staging uses Clerk's
development instance.

The token in the env file today could create the staging D1 database and R2 bucket, apply
migrations, set secrets, deploy, list versions and tail logs. A Cloudflare token reaches the whole
account, not one Worker, so it could deploy production too. What stops an agent today is the
production guard: every production script waits for a person to type `production` at a terminal,
and an agent has no terminal. Releases are the engineering lead's (see "How a change reaches
customers"), so until the founder removes that guard, the lead's release stops at the merge into
`main`.

**For the engineering lead's computer (founder action, not done yet):** the lead needs the same
file with `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` and the two Clerk keys, written by the
provisioning script with mode 600, like the GitHub token in `~/.netrc`. Without it, the lead moves a
`SHIP` card to `blocked` with `credential missing`.

## Working on it locally

Requires Node 24 and pnpm 10.

```sh
pnpm install
pnpm web:dev          # http://localhost:3000, with local D1 and R2
pnpm web:preview      # builds the real Worker and runs it on workerd at http://localhost:8787
pnpm web:test         # unit tests: URL rule, pipeline, API on a real local D1
pnpm web:test:smoke   # Playwright against the built Worker (builds it first)
pnpm typecheck && pnpm lint
```

`pnpm web:dev` writes `apps/web/.dev.vars` (gitignored) with Clerk's keys from the env file, applies
the migrations to the local D1 in `apps/web/.wrangler/state`, and starts Next. Never put keys in a
`.env` file in `apps/web`: OpenNext bundles those into the Worker.

The smoke test needs a browser once: `pnpm --filter @boiler-room/web exec playwright install
chromium`.

## Every command

| Command                                | Does                                                                                                |
| -------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `pnpm web:dev`                         | Local dev server                                                                                    |
| `pnpm web:preview`                     | The built Worker, locally                                                                           |
| `pnpm web:test`, `pnpm web:test:smoke` | Unit tests; Playwright smoke test (set `BASE_URL` to test a deployed environment)                   |
| `pnpm web:build`                       | Builds the Worker for local preview, or `pnpm web:build staging`                                    |
| `pnpm web:smoke <url>`                 | The smoke check against any URL                                                                     |
| `pnpm web:db:generate`                 | Writes the next migration from `src/db/schema.ts`                                                   |
| `pnpm web:db:migrate:local`            | Applies migrations to the local D1                                                                  |
| `pnpm web:db:migrate:<env>`            | Applies pending migrations to staging or production                                                 |
| `pnpm web:provision:<env>`             | Creates the environment's D1 and R2 if missing, and writes the D1 id into `wrangler.jsonc`          |
| `pnpm web:secrets:sync:<env>`          | Copies the Worker secrets from the env file to Cloudflare                                           |
| `pnpm web:deploy:<env>`                | Builds, deploys and smoke-checks. Refuses uncommitted code, the wrong commit, or pending migrations |
| `pnpm web:rollback:<env> [version-id]` | Lists recent versions and makes an earlier one live                                                 |
| `pnpm web:logs:<env> [tail flags]`     | Streams the live Worker's logs, for example `--status error`                                        |

`<env>` is `staging` or `production`. Every production command stops for you to type `production`.

## How a change reaches customers

1. **Build.** An engineer opens a pull request into `dev` (an `ENG` card).
2. **Staging.** The engineering lead merges it, migrates staging if the change has a migration, runs
   `pnpm web:deploy:staging`, and checks it (a `SHIP` card).
3. **Release.** Releases are autonomous. A release promotes `dev`, already proven on staging, to
   `main` and to production. The CEO creates a `RELEASE` card for the engineering lead once a slug
   is delivered, and the lead runs it; nobody else merges into `main` or deploys production:

   ```sh
   # 1. Open a pull request from dev into main, and merge it with a merge commit.
   git fetch origin && git checkout --detach origin/main   # a clean tree
   pnpm install --frozen-lockfile
   pnpm web:db:migrate:production    # only if the release has migrations
   pnpm web:deploy:production        # builds, deploys, smoke-checks
   ```

A **bug fix** takes the same road: a `HOTFIX` card, a pull request into `dev` with a test that
failed before the fix, staging, then a release.

## First production release

Once, before the first `pnpm web:deploy:production`:

1. **Clerk production instance.** Create it in the Clerk dashboard. It needs a custom domain, so
   pick the domain for production first. Add its keys to the env file as
   `PRODUCTION_CLERK_SECRET_KEY` and `PRODUCTION_NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`.
2. **Domain.** Add the domain to Cloudflare and route it to `boiler-room-web-production` (a
   `routes` entry in `env.production` of `wrangler.jsonc`, by pull request).
3. `pnpm web:provision:production`, then commit the database id it writes into `wrangler.jsonc` by
   pull request into `dev`, and release it.
4. `pnpm web:secrets:sync:production`
5. `pnpm web:db:migrate:production`
6. `pnpm web:deploy:production`

## Rolling back

`pnpm web:rollback:staging` lists recent versions, each tagged with the commit it was built from,
and makes the one before the live one live again, in seconds. Pass a version id to pick another.
Then run `pnpm web:smoke <url>`: `/api/health` shows the older commit as `version`.

A rollback never touches D1. That is why every migration must work with the code before it.

## Database migrations

Change `apps/web/src/db/schema.ts`, run `pnpm web:db:generate`, read the SQL it writes, and commit it.
Migrations are applied **before** the code that needs them is deployed, and must keep the code
already running working: add columns as nullable or with a default; rename or drop only in a later
release, once nothing uses the old shape; never edit a migration that has run. The skill has the
details. D1 keeps 30 days of history (Time Travel) if a restore is ever needed.

## Real films on staging

A real film runs on its own Naive computer, forked from a prebuilt snapshot that holds the crew's
code, its dependencies, Chrome's libraries and Remotion's browser. A Worker cannot run a 20-minute
job, so the website only starts, pauses, resumes and destroys computers; a runner on the computer
does the work and reports back.

```mermaid
sequenceDiagram
  participant B as Founder
  participant W as Worker
  participant N as Naive
  participant C as Film computer
  B->>W: start a video
  W->>N: fork the base snapshot, write the bootstrap file, start the runner
  C->>W: hello, then signed events and uploads (research, script)
  W->>N: checkpoint the disk, pause the computer
  B->>W: approve the script
  W->>N: resume (or fork the checkpoint), start the runner again
  C->>W: signed events and uploads (art, render, quality check, MP4s)
  W->>N: destroy the computer, delete the checkpoint
```

| Piece                                                                         | Where                                                                                                                                                                                                                                                                                          |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The contract with the runner: signatures, events, uploads, the launch command | One file, `services/film-runner/src/contract.ts`, which the runner runs on the computer and the website imports as `@boiler-room/film-runner/contract` (through `apps/web/src/server/runner/contract.ts`). `apps/web/test/runner-contract.test.ts` runs the real runner against the website's routes |
| Signed routes the runner calls: `hello`, `instructions`, `events`, `files`    | `/api/runner/v1/films/{filmId}/…`, served by `worker.ts` before OpenNext, which would read every body whole first; an upload streams into R2. Every call carries an HMAC-SHA256 signature with a key for its own film and run, a timestamp within 5 minutes and a fresh nonce. The website derives each key from `RUNNER_SIGNING_SECRET`; D1 holds nothing secret |
| What a film is doing                                                          | D1 `film_runs` and `run_events`, read by `NaivePipeline`. No page poll calls Naive                                                                                                                                                                                                             |
| Files                                                                         | R2, under keys the website picks. Each upload streams in with its signed SHA-256, which R2 checks                                                                                                                                                                                              |
| The watchdog                                                                  | A cron every minute on staging (`worker.ts`) calls the signed `/api/runner/v1/watchdog` route. It destroys computers whose runner is silent for 5 minutes, that never start, that pass their phase deadline or the film's cost cap, that wait 72 hours for approval, or that no live film owns |

**Caps.** Every one is checked in the single statement that reserves a film's row, so parallel
requests cannot all pass, and a refused start never reaches Naive.

| Cap                                                                                              | Staging                                   | Var                                        |
| ------------------------------------------------------------------------------------------------ | ----------------------------------------- | ------------------------------------------ |
| One film, crew and compute                                                                       | $2.50, of which $0.50 is kept for compute | `FILM_CAP_USD`, `FILM_COMPUTE_RESERVE_USD` |
| Real films at work per founder (a paused one waiting for approval does not count, and is checked again when it is approved) | 1 | `MAX_REAL_PER_ACCOUNT` |
| Real films holding the crew's one Researcher, across staging                                     | 1                                         | `MAX_REAL_GLOBAL`                          |
| Per founder per rolling 24 hours, films at work at their full cap, a script waiting at what it spent (its approval reserves the rest) | $5.00 | `ACCOUNT_DAILY_CAP_USD` |
| All of staging per rolling 24 hours                                                              | $5.25                                     | `GLOBAL_DAILY_CAP_USD`                     |
| The balance tripwire: the Naive balance down more than the staging cap in a day, from any source | halts every real film                     | `runner_control` row in D1                 |

**Settings.**

| Name                                                        | Kind   | From the env file                    | Notes                                                                                                             |
| ----------------------------------------------------------- | ------ | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `NAIVE_WEB_KEY`                                             | secret | `STAGING_NAIVE_WEB_KEY` only         | A key with exactly `computers:write` and `billing:read`. The sync checks it with Naive, and refuses the admin key |
| `RUNNER_SIGNING_SECRET`                                     | secret | `STAGING_RUNNER_SIGNING_SECRET` only | At least 32 random characters                                                                                     |
| `NAIVE_RUNNER_KEY`                                          | secret | `STAGING_NAIVE_RUNNER_KEY` only      | Optional. The film command's key, sent in each launch's bootstrap; the snapshot holds none. Sessions and `agents:read` only; the sync refuses more, the admin key or the website's key |
| `RUNNER_ALLOW_STANDIN`                                      | var    | `wrangler.jsonc`                     | `true` lets a snapshot built with the stand-in make a film, labelled simulated everywhere. Staging only, until the snapshot runs the real film command |
| `REAL_FILM_USERS`                                           | secret | `STAGING_REAL_FILM_USERS`            | Comma-separated Clerk user ids. A secret, so no id is committed to the public repo                                |
| `RUNNER_SNAPSHOT_ID`, `RUNNER_COMMIT`, `RUNNER_FILM_COMMIT` | vars   | `wrangler.jsonc`                     | The base snapshot and the two commits it holds, committed by pull request after a build                           |
| `RUNNER_PUBLIC_URL`                                         | var    | `wrangler.jsonc`                     | The callback base. The cron has no request to read it from                                                        |

Missing any of the three secrets or the snapshot id, nobody gets a real film. Production has none
of them and keeps answering 503.

**Turning it on.** In order; production is not touched by any step.

1. `pnpm web:runner:keys:staging mint` mints the website's key (exactly `computers:write` and
   `billing:read`) into `STAGING_NAIVE_WEB_KEY` and a signing secret into
   `STAGING_RUNNER_SIGNING_SECRET`, with the admin key, printing only key ids. `--runner-key` also
   mints the film command's key, once it is needed. Then `pnpm web:runner:keys:staging probe` runs
   every Naive call the website makes for a film with the new key, on a throwaway 1 vCPU computer
   it then destroys (about $0.01).
2. Build the base snapshot with `pnpm --filter @boiler-room/film-runner snapshot --adapter standin`
   (or `--adapter film` once the film command has the contract), then commit the snapshot id and
   both commits into `env.staging.vars` by pull request.
3. `pnpm web:db:migrate:staging`, `pnpm web:secrets:sync:staging`, then
   `pnpm web:deploy:staging --any-commit` to test a branch, or plain once it is on `dev`. The deploy
   refuses a `contract.ts` that differs from the one at `RUNNER_COMMIT`: such a runner would be
   refused at its hello.
4. Add your Clerk user id (from `accounts.clerk_user_id` after you sign in to staging once) to
   `STAGING_REAL_FILM_USERS`, and run `pnpm web:secrets:sync:staging` again.

Naive keys have no resource binding: the website's `computers:write` reaches every computer and
snapshot in the organization, the company's agent computers included. Keep no secret on any of
them. Moving film computers to an organization of their own would narrow that.

A real film shows no "Simulated" label, and your screens show no banner. A film whose computer ran
the stand-in (its hello says `adapter: standin`) keeps the label and stays off the showcase. A
runner on another contract version or other commits than `RUNNER_COMMIT` and
`RUNNER_FILM_COMMIT` fails the film at once with `runner_outdated`. A real script can be sent
back only once the film command can rewrite one (`RUNNER_REVISE_SUPPORTED`); until then the script
review answers "approve it, or start a new video". A delivered real film cannot be revised yet.

## Logs and checks

`pnpm web:logs:staging` streams requests, `console` output and exceptions. Every 500 is logged as
`Unhandled API error` with its stack; the caller only sees "Something went wrong on our side".
Workers observability is on, so the Cloudflare dashboard keeps searchable logs.

After every deploy, the smoke check confirms: `/api/health` is 200 with D1 up and the deployed
commit as `version`; the landing page and showcase render; the API refuses a signed-out caller;
app pages send a signed-out visitor to sign in. On staging, also sign in and run a simulated video
from URL to "Delivered".

## Troubleshooting

| You see                                                    | It means                                                                                                                                                    |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| An HTML page from `/api/health` right after a first deploy | workers.dev has not reached every edge yet. The smoke check waits up to 30 seconds for it                                                                   |
| `D1 has migrations to apply`                               | Run `pnpm web:db:migrate:<env>`, then deploy again                                                                                                          |
| `HEAD is not origin/dev`                                   | Check out `origin/dev`. `--any-commit` deploys another commit to staging for a test                                                                         |
| `env.<env> has no D1 database yet`                         | Run `pnpm web:provision:<env>` and commit the id it writes                                                                                                  |
| `The "middleware" file convention is deprecated`           | Expected. See "The stack, and why"                                                                                                                          |
| A build that never ends                                    | `apps/web`'s `build` script must stay `next build`. OpenNext runs it, so pointing it at a deploy script recurses                                            |
| A real film stuck on "Working" after you approved          | Naive refused to resume the computer, often `402` with no credit. `pnpm web:logs:staging` shows `resume_refused`; the cron retries every minute for an hour |
| `watchdog: ` lines in the logs                             | The cron acting on a stuck film or a stray computer. Each line names the film and the computer                                                              |
| Every new film is simulated for you on staging             | Your Clerk user id is not in `STAGING_REAL_FILM_USERS`, or a real-film secret or `RUNNER_SNAPSHOT_ID` is missing                                            |
