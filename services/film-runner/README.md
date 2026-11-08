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

Written by the website with `fs/write` to `<home>/br-run/bootstrap.json` before each launch. The
runner reads it, keeps the key in memory and **deletes the file** before doing anything else, so
no checkpoint holds a key. It names nothing to do: that comes from the signed instructions call.

```json
{
  "v": 1,
  "filmId": "flm_…",
  "runId": "run_…",
  "callbackBase": "https://…/api/runner/v1",
  "key": "<64 hex>",
  "issuedAt": 1794120000
}
```

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
`UPLOAD_KINDS`: `mp4` (95 MiB), `still`, `quality`, `campaign`, `research`, `decisions`,
`manifest`, `qc`. The website picks every R2 key; the runner names only the kind, version, variant
and a file name.

Instructions: `phase` (`script`, `render` or `all`), `mode`, `url`, `scriptVersion`, `approval`
(`{ version, hookId, ctaId, formats, confirmedClaimIds }`, for `render`), `revise`
(`{ version, note }`, for a send-back), `maxCrewUsd`, `spentCrewUsd`, `deadlineAt`, `stop`.

### Events

Every event has `seq` (the runner's, monotonic over the whole run and kept across launches), `at`,
`type` and `phase`. The types are `runner.hello` (with `adapter`: `film` or `standin`, so the
website can label a stand-in film), `runner.heartbeat`, `stage`, `decision`, `session`, `cost`,
`artifact` (with the stored `fileId`), `script_ready` (with `campaignFileId` and
`unconfirmedClaims`), `qc`, `delivered`, `error` and `runner.exit`. The shapes are the
`RunnerEvent` union in `src/contract.ts`. Messages are cut to 500 characters and scrubbed of keys.

## The runner

1. Read and delete `bootstrap.json`. Turn swap on. `hello`, then the instructions.
2. Write `~/br-run/approval.json` or `revise.json`, and start the film command with `detached`, so
   it has its own process group. Its output goes to `~/br-run/film.log`.
3. Follow `~/br-run/film/events-<phase>-<launch>.jsonl` (`fs.watch` and a 1 s poll). Each line is
   checked with `parseFilmEvent`; a line the contract refuses is skipped and logged. An artifact is
   uploaded (3 tries) before its event is queued, with `path` replaced by the stored `fileId`. A
   path outside the run dir is refused.
4. The outbox (`~/br-run/outbox.jsonl`, `seq`, `outbox.acked`) sends in order, 50 at a time, with
   backoff from 1 s to 30 s. A relaunch resends what the last launch could not, under the same
   numbers.
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
- The website's key needs only `computers:write`.

## The film command: what `feat/crew-agents` must add

The runner calls the film command as `pnpm run --silent film <args>` in the crew checkout, with
`filmCommandArgs`:

```sh
pnpm film <url> --phase script|render|all --run-dir <abs dir> --events <file> --max-usd <n> \
  --render local --no-sync [--approval <file>] [--revise <file>]
```

and the environment `BOILER_ROOM_ENV=$HOME/.boiler-room.env`, `CI=1`, `NODE_ENV=production`,
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
   `agents:write`.
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
pnpm runner:snapshot [--film-ref feat/crew-agents | --film-commit <sha>] [--runner-commit <sha>] \
  [--adapter auto|film|standin] [--no-fork-test]
```

On a builder at the film size, with the admin key from `~/.boiler-room.env` (never printed):
Chrome's libraries and fallback fonts as the render service installs them, 4 GiB of swap, pnpm,
the crew checkout at the crew commit with `pnpm install --frozen-lockfile`, the Remotion browser,
this package's checkout at the runner commit (linked at `~/film-runner`), and `~/.film-runner.json`.
The setup runs detached and is polled, so no exec runs longer than 600 s. If the env file has
`NAIVE_RUNNER_KEY`, it is written with `fs/write` to `~/.boiler-room.env` and made private. Then
the ready check (swap on, the renderer's browser launches, the self-test passes), a clean-up, the
snapshot, and the builder destroyed. A fork runs the ready check again before the id is printed.
Both commits must be on origin, since the computer clones the public repo.

### The current snapshot

|                      |                                                                                                        |
| -------------------- | ------------------------------------------------------------------------------------------------------ |
| `RUNNER_SNAPSHOT_ID` | `snp_f623af1411dc4d0181fb8e17c39ab04e`                                                                 |
| `RUNNER_COMMIT`      | `cdb27eb44c5fa74f9b4c20fd3ee2ce191631344a` (this package)                                              |
| `RUNNER_FILM_COMMIT` | `a54662f2793c5dff813fdb2a83b252d5025dca9c` (`feat/crew-agents`, which has no `film` script yet)        |
| Adapter              | `standin`                                                                                              |
| Runner key           | None. The env file had no `NAIVE_RUNNER_KEY`, so this snapshot can run only the stand-in               |
| Built                | 2026-11-08: setup 49 s, snapshot 8.7 s, a fork ready in 5.3 s, $0.11 for the builder and the fork test |

Rebuild it once the film command has the contract and a runner key is minted: `--adapter film`
and `NAIVE_RUNNER_KEY` in the env file.

## Tests

`pnpm --filter @boiler-room/film-runner test` runs the runner and the stand-in end to end against
`test/receiver.ts` (two launches with the approval between them, a sample film, server errors, a
stop from the website, a bad approval, a wrong key, a relaunch that resends), the launch command in
a real shell (it returns at once, and a second launch is refused by the lock), the signature
vectors against `node:crypto`, the contract's lists against `apps/web`, the stand-in's campaign
against the schema's `validateCampaign`, and the recipe.
