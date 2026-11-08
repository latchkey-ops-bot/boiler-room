# @boiler-room/film-runner

The computer side of a real film from the website. Each film runs on its own Naive computer, forked
from a base snapshot. On it, the **runner** starts the film command, follows what the crew does,
and reports to the website through HMAC-signed callbacks: stages, crew decisions, costs, errors,
and the finished MP4s and stills, which the website stores in R2. The website never has to reach
into the computer except through the Naive API, which this package also wraps for it
(**launcher**).

| Path                           | What                                                                                                                                                 |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/contract.ts`              | The contract with the website and with the film command. No imports, no Node built-ins: the Worker imports it as `@boiler-room/film-runner/contract` |
| `src/launcher.ts`              | The Naive calls the website makes for a film's computer. Plain `fetch`: `@boiler-room/film-runner/launcher`                                          |
| `src/main.ts`, `src/runner.ts` | The runner, and its parts: `client.ts` (signed calls, retries), `outbox.ts`, `tail.ts`, `scrub.ts`, `film-command.ts`, `self-test.ts`                |
| `bin/stop.sh`                  | Stops the runner and the film command; run by the website's exec                                                                                     |
| `standin/`                     | **The stand-in film command.** It makes no film. See [The stand-in](#the-stand-in)                                                                   |
| `scripts/build-snapshot.ts`    | `pnpm runner:snapshot`: builds the base snapshot and prints its id                                                                                   |
| `scripts/e2e-computer.ts`      | `pnpm runner:e2e --snapshot snp_…`: one stand-in film on a real computer, pause included                                                             |
| `test/receiver.ts`             | A stand-in for the website's runner routes that checks what the website will check                                                                   |

The runner has no runtime dependencies. Node 24 runs its TypeScript directly, so a bare checkout is
enough on the computer.

## How a film runs

```text
website                                     film computer (fork of the base snapshot)
-------                                     -----------------------------------------
createFilmComputer(snapshot)  ──────────▶   creating → running
writeBootstrap()  (fs/write)  ──────────▶   ~/br-run/bootstrap.json
launchRunner()  (exec, ~1 s)  ──────────▶   setsid flock node src/main.ts
                              ◀──────────   POST hello, GET instructions        phase script
                              ◀──────────   POST events, PUT research, PUT campaign
                              ◀──────────   script_ready, runner.exit 0
checkpointComputer(), pauseComputer()        paused: bills nothing
   … the customer approves on the script review page …
resumeComputer(), writeBootstrap(), launchRunner()
                              ◀──────────   hello, instructions                 phase render
                              ◀──────────   events, PUT mp4 per format, stills, quality, decisions, manifest
                              ◀──────────   delivered, runner.exit 0
destroyComputer(), deleteSnapshot(checkpoint)
```

A sample film for GTM runs one launch with phase `all`: no pause.

## The contract

### bootstrap.json

Written by the website with `fs/mkdir` and `fs/write` to `<home>/br-run/bootstrap.json`
(`BOOTSTRAP_PATH`) before each launch: a fresh fork has no run dir, so the website makes it first.
The runner reads it, keeps the key in memory and **deletes the file** before doing anything else.
It names nothing to do: that comes from the signed instructions call. Before it takes a checkpoint,
the website also runs `SCRUB_COMMAND`, which deletes the bootstrap and the key file, so no
checkpoint holds a key even if a runner never started.

```json
{
  "v": 1,
  "filmId": "flm_…",
  "runId": "run_…",
  "callbackBase": "https://…/api/runner/v1",
  "key": "<64 hex>",
  "issuedAt": 1794120000,
  "naiveKey": "sk_live_…"
}
```

`naiveKey` is the Naive key the film command runs its agents with, for this launch only, and is
absent for the stand-in. The base snapshot holds no key. The runner writes it to
`<home>/br-run/naive.env` (mode 600) just before it starts the film command, points
`BOILER_ROOM_ENV` there, and deletes the file when the command exits. A `film` runner given no key
stops with `no_naive_key` before the crew starts.

`callbackBase` must be https; plain http is accepted only for `127.0.0.1` and `localhost`.

### Signatures

- Per-run key: `K = HMAC-SHA256(RUNNER_SIGNING_SECRET, "br-runner/v1/" + filmId + "/" + runId)`,
  hex. The secret is used as the UTF-8 bytes of the string as stored. The website derives `K` per
  request and stores nothing secret. A leaked computer can sign only for its own film and run.
- Every runner request carries `x-br-film`, `x-br-run`, `x-br-ts` (unix seconds, corrected by the
  server clock the runner learns), `x-br-nonce` (32 hex, new for every request, retries included),
  `x-br-body-sha256` and `x-br-signature: v1=<hex HMAC-SHA256(K, canonical)>`.
- The canonical string, one field per line: `BR1`, the method, `pathname + search` exactly as sent,
  the film id, the run id, the timestamp, the nonce, the body hash, the content length. The query
  is built with `URLSearchParams` on both ends, so `16:9` travels as `16%3A9`.
- `verifyRequest` checks in the order the website must: header shapes and the film id in the path
  (400), the clock within 300 s (401 `stale`, with `serverTime`), a known run, then the signature in
  constant time (401). The body hash, the nonce table (409 `replay`) and the run's state are the
  route's next steps. `signWatchdog` signs the cron's call to its own route with
  `HMAC-SHA256(secret, "br-watchdog/v1")`.

### Routes the website serves

| Call                                                     | Body                          | Answer                                                    |
| -------------------------------------------------------- | ----------------------------- | --------------------------------------------------------- |
| `POST films/{filmId}/hello`                              | the `runner.hello` event      | `{ serverTime, phase }`                                   |
| `GET films/{filmId}/instructions`                        | none                          | `Instructions` (below)                                    |
| `POST films/{filmId}/events`                             | `{ runId, events }`, 1 to 100 | `{ ok, lastSeq, control: { stop, reason? }, serverTime }` |
| `PUT films/{filmId}/files?kind=&version=&variant=&name=` | the raw file                  | `{ ok, fileId, bytes }`                                   |

Errors use the API's shape, `{ error: { code, message } }`. Upload kinds and their limits are
`UPLOAD_KINDS`: `mp4` (60 MiB, well under what one Worker request holds), `still`, `quality`, `campaign`, `research`, `decisions`,
`manifest`, `qc`. The website picks every R2 key; the runner names only the kind, version, variant
and a file name.

Instructions: `phase` (`script`, `render` or `all`), `mode`, `url`, `scriptVersion`, `approval`
(`{ version, hookId, ctaId, formats, confirmedClaimIds }`, for `render`), `revise`
(`{ version, note }`, for a send-back), `maxCrewUsd`, `spentCrewUsd`, `deadlineAt`, `stop`.

### Events

Every event has `seq` (the runner's, monotonic over the whole run and kept across launches), `at`,
`type` and `phase`. The types are `runner.hello` (with `phase: null`, since the runner has no
instructions yet; `contract`, the `CONTRACT_VERSION`, which the website must match; `adapter`,
`film` or `standin`, so the website can label a stand-in film; and `launch`), `runner.heartbeat`, `stage`, `decision`, `session`, `cost`,
`artifact` (with the stored `fileId`), `script_ready` (with `campaignFileId` and
`unconfirmedClaims`), `qc`, `delivered`, `error` and `runner.exit`. The shapes are the
`RunnerEvent` union in `src/contract.ts`. Messages are cut to 500 characters and scrubbed of keys.

## The runner

1. Read and delete `bootstrap.json`. Turn swap on. `hello`, then the instructions. Events a past
   launch left unconfirmed are resent only when they belong to this launch's phase, and a past
   launch's `runner.exit` never is: the website would read it as this launch's and fail the film.
   They go to `~/br-run/outbox.dropped.jsonl` instead.
2. Write `~/br-run/approval.json` or `revise.json`, and start the film command with `detached`, so
   it has its own process group. Its output goes to `~/br-run/film.log`.
3. Follow `~/br-run/film/events-<phase>-<launch>.jsonl` (`fs.watch` and a 1 s poll). Each line is
   checked with `parseFilmEvent`; a line the contract refuses is skipped and logged. An artifact is
   uploaded (3 tries) before its event is queued, with `path` replaced by the stored `fileId`. A
   path outside the run dir is refused.
4. The outbox (`~/br-run/outbox.jsonl`, `seq`, `outbox.acked`) sends in order, 50 at a time, with
   backoff from 1 s to 30 s. A relaunch resends what the last launch could not, under the same
   numbers. A batch the website answers `409 wrong_state` (the run has moved on) is set aside the
   same way, never resent.
5. A heartbeat every 30 s. The film is stopped (SIGTERM to its group, SIGKILL after 60 s) when the
   website answers `control.stop`, at `deadlineAt`, on SIGTERM to the runner (`bin/stop.sh`), after
   three 401s that are not `stale`, or after 15 minutes with no successful call.
6. When the film command exits: send what is left (up to 2 minutes), post `runner.exit`, exit.

| Exit    | Meaning                                                                             |
| ------- | ----------------------------------------------------------------------------------- |
| 0       | The phase finished: `script_ready` for `script`, `delivered` for `render` and `all` |
| 1, 2, 4 | The film command's: the crew failed, bad input, the cost cap                        |
| 20      | No valid `bootstrap.json`, config or instructions                                   |
| 21      | The website rejected the signature three times                                      |
| 22      | The website could not be reached for 15 minutes                                     |
| 23      | The website refused the run (`409 wrong_state`, or a request it will never accept)  |
| 24      | An artifact could not be uploaded                                                   |
| 143     | Stopped                                                                             |

`node src/main.ts --self-test` checks a computer: Node 24, `flock`, `setsid`, the config, the film
command, the key file's mode, swap, no run dir, and signing.

## The launcher (for the website)

`naiveApi({ key })`, then `createFilmComputer` (name `br-film-<env>-<filmId>`, 4 vCPU, 8 GiB,
20 GB, idempotency key `<runId>:<attempt>`), `getComputer`, `listFilmComputers`, `computerHome`,
`writeBootstrap`, `launchRunner`, `stopRunner`, `pauseComputer`, `resumeComputer`,
`checkpointComputer`, `destroyComputer` and `deleteSnapshot` (both treat 404 as done), plus `exec`,
`execDetached` and `waitDetached` for scripts.

- **No exec asks for more than 600 s**, Naive's ceiling: `exec` clamps every timeout. The launch is
  `setsid -f bash -c 'exec flock -n "$HOME/br-run/lock" node src/main.ts' </dev/null >>runner.log
  2>&1`, which answers in about a second and outlives the exec. Stopping is the same: `stop.sh`
  sends SIGTERM and leaves a detached killer behind.
- **No secret goes in a command.** Command history keeps every command and its output for 30 days.
  The run key reaches the computer only through `fs/write`.
- The website's key holds exactly `computers:write` and `billing:read` (the balance tripwire), which
  `secrets:sync` checks with Naive. Naive keys have no resource binding, so `computers:write` reaches
  every computer and snapshot in the organization: keep no secret on any other computer there.
- The runner's key (`naiveKey` in the bootstrap) holds exactly `agents:read`, `sessions:read`,
  `sessions:write`, `files:read`, `files:write`, `computers:write` and `billing:read`: the calls the
  film command makes, each listed with its reason in `apps/web/scripts/lib/runner-secrets.mjs` and
  in `docs/deploy.md`. Its `computers:write` is for br-researcher's computer, which the Researcher
  resumes and pauses, and it reaches every other computer too. It has no `agents:write`, which
  Naive also requires for image generation, so the Art Director goes on with captured pictures.
  `pnpm web:runner:keys:staging probe --runner-key` makes every one of those calls with it.

## The film command

The film command (`agents/src/film/command.ts`, documented in `agents/README.md`) does 1 to 9 below
and refuses `--revise` as bad input; 10 and 11 are still to do. Its test runs it with a fake crew
and parses every event it writes with `parseFilmEvent`.

The runner calls the film command as `pnpm run --silent film <args>` in the crew checkout, with
`filmCommandArgs`:

```sh
pnpm film <url> --phase script|render|all --run-dir <abs dir> --events <file> --max-usd <n> \
  --render local --no-sync [--approval <file>] [--revise <file>]
```

and the environment `BOILER_ROOM_ENV=$HOME/br-run/naive.env` (the launch's key file), `CI=1`, `NODE_ENV=production`,
`INIT_CWD=<crew checkout>`. What it must do, of which the first seven unblock a real film:

1. `--phase script` runs the Researcher and the Director with its checks, writes the campaign to the
   run dir, emits `script_ready`, and exits 0. `--phase render` runs the Art Director, the render,
   Quality Check and delivery from that run dir. `--phase all` is today's whole film.
2. `--run-dir`: one stable directory across both phases, in place of `out/films/<host>/<run-id>/`.
   The render phase reads the script phase's files from it.
3. `--approval <file>`: `{ version, hookId, ctaId, formats, confirmedClaimIds }`. Render exactly
   that cut in exactly those formats, treat the confirmed claims as approved, and exit 2 if
   `version` is not the run dir's script version.
4. `--events <file>`: one JSON object per line, flushed per line, with `v: 1`, `seq` from 1, `at`
   and `type`, in the shapes `parseFilmEvent` accepts (`FilmEvent` in `src/contract.ts`): `stage`,
   `decision`, `session`, `cost`, `artifact` (with `path` relative to the run dir, `kind`,
   `contentType`, `version`, and `variantKey` for an MP4), `script_ready` (with `campaignPath` and
   `unconfirmedClaims`), `qc`, `delivered` and `error`. Agents, stages and formats use the website's
   words, which `src/contract.ts` lists. Messages are plain sentences with no keys, links or paths.
   Never a `stage` of `approval`: only the website moves a film into or out of it.
5. `--render local`: render on the film computer (`renderCampaign({ runner: 'local' })`).
6. SIGTERM and SIGINT: interrupt live sessions, emit `error` with code `stopped`, exit within 60 s.
7. Exit codes: 0 only after `script_ready` (script) or `delivered` (render, all); 1 the crew
   failed; 2 bad input; 4 the cost cap; 143 stopped.
8. `--no-sync`: never create or change an agent or push a skill, so the runner's key needs no
   `agents:write`. Image generation needs it too, and is refused with a 403: the Art Director
   records "image generation unavailable" in `decisions.json` and goes on with captured pictures.
9. `--max-usd <n>`: lower the film's ledger limit to this.
10. `--revise <file>` with `--phase script`: rewrite from the note as version N+1, without the
    Researcher. Until then the website answers a send-back with "approve it or start a new video".
11. Wait for the Researcher's computer instead of refusing when another session holds it.

`standin/film.ts` is a working example of 1 to 7 and 10: the runner treats both the same.

## The stand-in

`standin/film.ts` takes the real film command's arguments, writes the same kinds of events and
files and exits with the same codes. It calls no agent and spends nothing. The script is the
schema's sample campaign for Nova, unchanged, whatever the URL; the videos are 4-second clips that
say "STAND-IN FILM"; every message starts with "Stand-in:". The runner picks it only when the base
snapshot was built with `adapter: "standin"` (in `~/.film-runner.json`; `--adapter auto` picks it
when the crew checkout has no `film` script), and says so in `runner.hello`. Delete the folder
once the real command has the items above.

## The base snapshot

```sh
pnpm runner:snapshot [--film-ref dev | --film-commit <sha>] [--runner-commit <sha>] \
  [--adapter auto|film|standin] [--no-fork-test]
```

On a builder at the film size, with the admin key from `~/.boiler-room.env` (never printed):
Chrome's libraries and fallback fonts as the render service installs them, 4 GiB of swap, pnpm,
the crew checkout at the crew commit with `pnpm install --frozen-lockfile`, the Remotion browser,
this package's checkout at the runner commit (linked at `~/film-runner`), and `~/.film-runner.json`.
The setup runs detached and is polled, so no exec runs longer than 600 s. Then the ready check
(swap on, the renderer's browser launches, the self-test passes, which includes **no Naive key on
disk**, and with the `film` adapter the film command answers `--help` with `--phase`), a clean-up, and `LOCK_SUDO_SCRIPT`: the film user keeps one sudo rule, `swapon /swapfile`,
and loses every other grant, since the film command drives agents on content from a customer's
URL. Then the snapshot, and the builder destroyed. A fork runs the ready check again, which also
checks that `sudo -n true` is refused, before the id is printed. Both commits must be on origin,
since the computer clones the public repo.

The snapshot holds no Naive key: every fork and checkpoint of it would hold the same long-lived
key. The website sends the runner's key with each launch instead (`naiveKey` above).

The film command now has the contract. Rebuild with `--adapter film` at a crew commit whose agents
are synced (`pnpm agents:sync` from that commit): the command runs `--no-sync`, so a deployed agent
that is not that commit's stops every film with `agent_drift` before anything is spent.

### The current snapshot

|                      |                                                                                                                                                             |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RUNNER_SNAPSHOT_ID` | `snp_d9352fbbd60a4fb8806963b63c2ae11f`                                                                                                                      |
| `RUNNER_COMMIT`      | `10bc917d1a2e3832aaac8aa98c8569a170e82422` (`feat/staging-real-films`)                                                                                      |
| `RUNNER_FILM_COMMIT` | The same commit: the film command with the runner's contract, and the crew `pnpm agents:sync` left on Naive (all four agents unchanged, `site-research@10`) |
| Adapter              | `film`, chosen with `--adapter film`                                                                                                                        |
| Naive key            | None, by design: the website sends one with each launch                                                                                                     |
| sudo                 | `swapon /swapfile` only; a fork's ready check proved `sudo -n true` is refused                                                                              |
| Ready check          | On the builder and on one fork: swap on, the renderer's browser launches, the self-test passes, and `pnpm run --silent film --help` answers with `--phase`  |
| Built                | 2026-11-08: setup 48 s, snapshot 8.5 s, a fork ready in 6.7 s, $0.09 for the builder and the fork                                                           |

Staging runs it with `RUNNER_ALLOW_STANDIN` set to `false`. Rebuild it, and run `pnpm agents:sync`
at the same commit first, whenever the crew's definitions, skills or the film command change.

## Measured on Naive

`pnpm runner:e2e --snapshot snp_f623af1411dc4d0181fb8e17c39ab04e`, 2026-11-08: one stand-in film on
a fork of the snapshot, through every launcher call, with the receiver on the computer at
127.0.0.1 (a computer takes no inbound connections). Every request passed the receiver's checks,
both MP4s arrived with the hashes they had on the computer, `bootstrap.json` was gone after each
launch, the key was not in the runner's log, and nothing was left on Naive.

| Step                                                                       | Time           |
| -------------------------------------------------------------------------- | -------------- |
| Create from the snapshot to running                                        | 2.9 s          |
| Launch exec (setsid, returns at once)                                      | 0.3 to 0.4 s   |
| Script phase (stand-in, 2 s between steps)                                 | 13.7 s         |
| Checkpoint (snapshot of the 20 GB disk)                                    | 8.4 to 10.5 s  |
| Pause                                                                      | 8.9 to 9.2 s   |
| Resume                                                                     | 5.5 to 5.6 s   |
| Render phase (stand-in)                                                    | 13.8 to 13.9 s |
| A fork of the checkpoint (a late approval's path) to running, run dir kept | 3.1 s          |

Two things the design assumed otherwise: the checkpoint of a forked computer forks again, and a
process running before the pause was still running after the resume. The runner still exits at
the approval gate, so nothing depends on the second.

## Tests

`pnpm --filter @boiler-room/film-runner test` runs the runner and the stand-in end to end against
`test/receiver.ts` (two launches with the approval between them, a sample film, server errors, a
stop from the website, a bad approval, a wrong key, a relaunch that resends), the launch command in
a real shell (it returns at once, and a second launch is refused by the lock), the signature
vectors against `node:crypto`, the contract's lists against `apps/web`, the stand-in's campaign
against the schema's `validateCampaign`, and the recipe.
