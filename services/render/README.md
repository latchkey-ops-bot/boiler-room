# @boiler-room/render

The render service. It takes a `campaign.json`, splits the film's frames across Naive computers,
stitches the chunks into one MP4, and writes a manifest and the Quality Check agent's artifacts
beside it. Agents call it as `renderCampaign()`; people call it as `pnpm render`.

```sh
pnpm render <campaign.json> [--format 16:9] [--hook id] [--cta id] [--workers N]
```

```ts
import { renderCampaign } from '@boiler-room/render';

const { output, manifestFile, manifest } = await renderCampaign({
  campaignFile: 'campaigns/acme.campaign.json',
  format: '9:16',
  workers: 4,
  maxCostUsd: 1,
  signal, // aborting it destroys every computer before the promise settles
});
```

The package exports TypeScript, including `@boiler-room/motion`'s `.tsx`, so a caller runs it
through a transpiler: the CLI uses `tsx`. The Naive key is read at run time from
`~/.boiler-room.env` (`NAIVE_API_KEY=...`, or another file named by `BOILER_ROOM_ENV`). It is never
printed, logged, put in a command or sent to a computer.

## What a render does

1. **Gate.** `validateCampaign` with `sceneRegistry`, then `validateFilm`, then `validateCampaign`
   again on the cut with its hook and CTA resolved, the same checks `<CampaignFilm>` makes in
   `calculateMetadata`. A rejected campaign exits 1 with every issue and its fix, before anything is
   bundled or a computer exists. Remotion's `schema` prop is not relied on.
2. **Estimate.** Frames come from `sceneFrames`. The run is priced (see [Cost](#cost)) and refuses
   to start when the most it could cost is over `maxCostUsd` (exit 3).
3. **Bundle.** `@remotion/bundler` bundles `@boiler-room/motion` here. The public folder holds only
   the files the campaign's assets name, copied from beside the campaign file, so nothing else in
   that folder is uploaded. A missing font stops the render; a missing file a silent film does not
   draw, such as audio, is a warning. The bundle and the chunk worker are packed into one `.tgz`.
4. **Select.** `selectComposition` runs here against the bundle, which runs `calculateMetadata` in a
   browser, including its checks that both brand fonts load (`FONT_UNAVAILABLE` names the font, its
   file and why) and that every scene image loads and is still. `--dry-run` stops after this step,
   so a corrupt or blocked font is caught before any computer exists. Its `composition` is what
   every chunk renders, as Remotion's distributed rendering asks.
5. **Render.** The frames are split with `splitFrames`: every chunk has `ceil(frames / workers)`
   frames except the last, because `combineChunks` takes one `framesPerChunk`. Each chunk renders
   on its own computer with `renderMedia({ codec: 'h264-ts', frameRange, compositionStart: 0,
   muted: true, enforceAudioTrack: true })`, with the same options for every chunk. Each computer
   is destroyed as soon as its chunk is back.
6. **Stitch.** `combineChunks({ codec: 'h264', audioFiles: [], framesPerChunk, ... })`. Routine
   renders are silent: `muted` wins over `enforceAudioTrack`, there are no audio chunks, and the
   film has no audio stream. A film with audio would add `separateAudioTo` per chunk.
7. **Check.** Always: the frame count is `durationInFrames`, the duration, size and frame rate
   match, every frame follows the last by exactly one frame's time, and there is no audio stream.
   With `--verify-seams`: the whole film is rendered here once more, and the frames at every seam
   are compared with it (see [Seams](#seams)).
8. **Quality artifacts** from the stitched film, and the **manifest**.

Every computer is destroyed when the run ends, by success, failure, a cost stop or a stop. The
pool then lists the org's computers and destroys any still named for the run (`br-render-<run>-`),
which also catches a computer whose create answered after an abort. The manifest records what was
left, which is always nothing on success.

The CLI turns every way it can be stopped into that cleanup (`src/guard.ts`): Ctrl-C, SIGTERM,
Ctrl-\\, SIGHUP from a closed terminal or dropped SSH session, a closed stdout or stderr (output
piped to `head`, or a reader that goes away), its parent process exiting, and an uncaught error.
Node's default for a hangup or a broken pipe is to exit at once, which left computers billing. A
second press says it is still cleaning up; only a third leaves without waiting, and a hangup,
closed pipe or lost parent never does. One press reaches the process several times under `pnpm`
and `tsx`, and those copies count once.

pnpm does not pass a signal on to a script's process: it ends its own child. So `pnpm render`
runs `tsx` in place of the script's shell (`exec`), with no second `pnpm` in between, and that
child is the CLI's `tsx`, which passes the signal to the CLI. A supervisor that stops the run by
the pid it spawned therefore stops the render, and `pnpm` exits when the cleanup has finished. To
stop a run you did not spawn, signal its process group: `kill -TERM -- -<pgid>`.

## Naive

| Step       | How                                                                                                                                                                                                                   |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Computers  | 8 vCPU, 16 GiB, 10 GB disk each. Created with a run-scoped name, polled until `running`.                                                                                                                              |
| Commands   | `execStream`, never plain `exec`: a plain fetch is cut at 300 s. Setup prints every 20 s and the worker every 2 to 5 s, so a stream is never quiet. One command may run 600 s, Naive's ceiling.                       |
| Payload in | Uploaded here with a one-shot link (`files.createUpload`, up to 60 MiB). The computer downloads it from a keyless `files.url` link with `curl`.                                                                       |
| Chunk out  | The computer measures the file, a one-shot upload link is made here for that size, and the computer `curl -T`s the chunk to it. It is downloaded here and checked against the size and SHA-256 the computer measured. |
| Links      | Written to a file with `fs write`, read by the command with `$(cat)`, and deleted by the same command. Command history keeps every command and its output for 30 days, so no link is ever in one.                     |
| Files      | Every Naive file a run makes is deleted when the run ends.                                                                                                                                                            |
| Homes      | `fs` calls name the home Naive reports (`/home/naive`); the shell's `$HOME` is another directory that `fs` maps to. Commands use `$HOME`, and paths a program opens use the shell's home.                             |

`fs read` and `fs write` take at most 4 MiB a call, so neither the payload (about 7 MiB) nor a
chunk goes through them.

### The base snapshot

A worker needs Chrome's shared libraries (Remotion's list for Ubuntu 24.04), fallback fonts for
copy the brand font does not cover (`fonts-liberation` for Latin, Greek, Cyrillic and Hebrew,
`fonts-noto-core` for Arabic, Thai, Devanagari and most other scripts, and `fonts-noto-cjk` for
Chinese, Japanese and Korean), `@remotion/renderer` at the version this package resolves, and its
headless browser. Without the Noto fonts, Arabic or Chinese copy in a Latin brand font rendered as
boxes here while a dev machine with Noto showed it, and the render still succeeded. Installing all
of it took 41 s on a clean computer before the Noto fonts were added. A `--local` render uses this
machine's fonts instead.

The first run that finds no base sets every worker up from clean, and snapshots the first one the
moment its setup passes, before any campaign file reaches it. Later runs fork that snapshot, check
that the renderer loads, and start. A retry in the same run forks it too.

The snapshot is recorded as a Naive file tagged `boiler-room-render-base` and titled with the hash
of the setup script, so any process in the org with the key finds it, and a changed recipe builds a
new one. `findBase()` returns the newest record whose snapshot still exists. A fork must be at least
as large as the computer the snapshot came from, so a smaller worker size sets up from clean. When
a fork is refused or its renderer does not load, that worker sets itself up instead.

`--snapshot off` sets every worker up from clean, and `--snapshot rebuild` ignores the record and
makes a new one.

## Measured

On Naive, 8 vCPU workers, 4 chunks unless noted, November 2026:

| Film                                                                   | Base     | Ready (create to renderer loaded)      | Render per chunk | Render phase | Cost, computed / ledger |
| ---------------------------------------------------------------------- | -------- | -------------------------------------- | ---------------- | ------------ | ----------------------- |
| Nova 16:9, 600 frames                                                  | snapshot | 3.2, 21.7, 21.7, 21.8 s                | 4.2 to 4.6 s     | 36.5 s       | $0.2124 / $0.2124       |
| Nova 16:9, hook and CTA                                                | clean    | 43.0 to 43.6 s                         | 4.8 to 5.5 s     | 58.2 s       | $0.2402 / $0.2402       |
| Quillhaven 9:16, 432 frames, one chunk's computer destroyed mid-render | snapshot | 2.5 to 3.4 s, and 21.8 s for the retry | 3.6 to 4.2 s     | 41.2 s       | $0.0927 / $0.0927       |
| Quillhaven 1:1, 3 chunks                                               | snapshot | 2.6, 2.7, 22.7 s                       | 3.9 s            | 34.0 s       | $0.2835 / $0.2835       |
| Nova 1:1, 3 chunks                                                     | snapshot | 2.5 to 2.6 s                           | 4.7 to 4.9 s     | 17.3 s       | $0.2503 / $0.2503       |
| Quillhaven 16:9, 432 frames                                            | snapshot | 2.8 to 4.6 s                           | 3.7 to 4.1 s     | 17.6 s       | $0.0420 / $0.0420       |

- **The snapshot saves about 40 s a worker.** 14 of 19 forks were ready in 2.5 to 4.6 s and 5 took
  21 to 23 s, all of it after Naive reported the computer running (provisioning itself took 1.3 to
  1.6 s). Setting up from clean took 43 s every time, 41 s of it the setup. The render phase was 17
  to 41 s with the snapshot and 58 s without.
- **Rendering is not the cost.** A 150-frame 1080p chunk rendered in 4 to 6 s; fetching the payload
  took 2 to 4 s and sending the chunk back 2 to 4 s.
- **The billing block is the cost.** A computer is charged from its create to the end of the
  current 10-minute block of the clock, so a worker that lives 15 s costs between $0.003 and $0.11
  depending on when in the block it started. That is why the 3-chunk runs, started 8 minutes
  before a block ended, cost three times the 4-chunk Quillhaven run, started 2 minutes before one.
- **The pool's arithmetic is exact.** The cost worked out from the published rates matched the
  ledger's `computer` debits for the run's computers to the micro-dollar every time.

## Seams

Two encodes of the same frames are never byte equal: a chunk opens on a key frame where the whole
film had a predicted one. So a seam is held to what an ordinary frame looks like. `--verify-seams`
decodes, from both the stitched film and a full render, the two frames at every seam and two
neighbouring frames in the middle of each chunk. A seam passes when:

- each of its frames is within 3 dB PSNR of the worst interior frame, against the same frame of the
  full render; and
- where the picture moves across the seam, each of its frames is closer to its own frame of the full
  render than to its neighbour's, which a dropped or repeated frame would break.

On Naive chunks against a full render made here, in four runs, seam frames were 43.2 to 48.2 dB
from the full render and interior frames 42.7 to 51.5 dB. Against the frame on the other side of
the seam they were 23.4 to 35.3 dB, and up to 46.1 dB where the picture barely moved. Every seam
was aligned. The frame count matched `durationInFrames` exactly in every run.

## Quality artifacts

Beside `film.mp4`, in `film.quality/`, all taken from the stitched film so the agent judges the
file that ships:

| File                                            | Shows                                                                                                          |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `contact-sheet.png`                             | One frame a second, each labelled with its time and frame number                                               |
| `transitions-sheet.png` and `transitions/*.png` | For each transition, the frame before its window, its boundary and the frame after, full size and on one sheet |
| `phone-sheet.png`                               | Each scene two thirds through, 390 px wide, the width of a phone held upright                                  |
| `index.json`                                    | Every file, the frames it shows, and the scene and transition each belongs to                                  |

Remotion's FFmpeg has `trim`, `split` and `scale` but no `select`, `tile` or `drawtext`, so frames
are picked by index with `trim` and the sheets and their labels are drawn here.

## Manifest

`film.manifest.json`:

| Field          | Holds                                                                                                                                                 |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `campaign`     | Id, file, SHA-256 of the file, and of the validated campaign and of the cut as canonical JSON                                                         |
| `template`     | `@boiler-room/motion`'s version, its last commit and whether it has changes, the bundle's hash without the campaign's files, and the Remotion version |
| `settings`     | Format, hook, CTA, size, fps, frames, codecs, JPEG quality, concurrency, workers, chunks, frames per chunk, computer size                             |
| `base`         | Snapshot or clean, the snapshot id, the recipe hash, and the setup time a fork skipped                                                                |
| `chunks`       | Each chunk's frames, bytes and hash, and every try: computer, provision, ready, fetch, render and return times, and its error                         |
| `computers`    | Every computer: role, size, snapshot, created and destroyed, ready time, charge                                                                       |
| `timings`      | Validate, bundle, compress, select, upload, render, stitch, verify, quality, total                                                                    |
| `cost`         | The limit, the estimate, the cost worked out block by block, and the ledger's                                                                         |
| `verification` | The film check and, with `--verify-seams`, every seam                                                                                                 |
| `quality`      | The artifacts' index                                                                                                                                  |
| `cleanup`      | Computers left after the run, and Naive files deleted                                                                                                 |

## Cost

Rates are the published ones: $0.000014 a vCPU-second and $0.0000045 a GiB-second, so a worker is
$0.000184 a second. A computer is charged from its create to the end of the current 10-minute
block, and each later block in full; disk is not metered.

The estimate takes each worker's time as its setup (a fork or a clean setup), its transfers, and its
frames at a frame time scaled by pixels, slower below 8 vCPU and no faster above. The defaults in
`DEFAULT_TIME_MODEL` are rounded up from the measurements above. The expected cost puts each
computer halfway through a block. The maximum adds 50 % to every time, a whole block to every
computer, and one spare computer for a retry; that maximum is what `maxCostUsd` is checked against.

While a run goes, the limit holds: a computer is created only when its first block fits under the
limit with what has been charged and the first blocks of the creates still in flight, so retries
that start together cannot pass it, and the run stops 30 s before a new block would take it past.
The estimate budgets one spare computer, so when several chunks fail at once, a retry past that
spare is refused at the limit and the run stops.

## Limits

- One chunk may take 600 s on its computer, Naive's ceiling for a command. At the measured speed
  that is over 10,000 frames of 1080p, but heavier scenes render slower; use more workers.
- The payload and each chunk go through a 60 MiB upload link. A larger campaign is refused with a
  message; a larger chunk asks for more workers.
- A failed chunk is rendered once more on a new computer. A second failure stops the run.
- Selecting the film and `--verify-seams` need a browser here; `ensureBrowser()` fetches one.

## Commands

```sh
pnpm render <campaign.json> --dry-run   # gate, bundle, select and estimate; no computer
pnpm render <campaign.json> --verify-seams
pnpm render <campaign.json> --local     # render the chunks on this machine
pnpm --filter @boiler-room/render test
pnpm --filter @boiler-room/render typecheck
```

`--simulate-chunk-failure <n>` destroys chunk n's first computer once it starts rendering, which
is how the retry above was shown.

## Layout

| Path                                              | Contents                                                                                              |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `src/render-campaign.ts`                          | `renderCampaign()`: the whole run                                                                     |
| `src/cli.ts`                                      | `pnpm render`, and Ctrl-C                                                                             |
| `src/gate.ts`                                     | The campaign gate                                                                                     |
| `src/chunks.ts`                                   | Chunk splitting and seam frames                                                                       |
| `src/cost.ts`                                     | Rates, billing blocks, the estimate and the limit                                                     |
| `src/bundle.ts`                                   | The public folder, the bundle and the payload                                                         |
| `src/jobs.ts`                                     | The one worker job builder, and running the worker here                                               |
| `worker/render-chunk.ts`                          | The worker each computer runs with plain `node`                                                       |
| `src/naive/`                                      | The client, streamed commands, the computer pool, transfers, the base snapshot, and the chunk workers |
| `src/verify.ts`, `src/compare.ts`                 | The film check and the seam check                                                                     |
| `src/quality.ts`, `src/sheets.ts`, `src/media.ts` | Quality artifacts, sheets, and FFmpeg                                                                 |
| `src/manifest.ts`                                 | The manifest                                                                                          |
