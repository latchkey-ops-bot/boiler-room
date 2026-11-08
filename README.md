# boiler-room

Boiler Room: autonomous motion design company. Give it a URL, get a launch video.

Agents research the product and write a `campaign.json`. A validator gates that file, Remotion
scenes render it, and the dashboard edits it. `campaign.json` is the contract between all of them.

## Layout

| Path              | Contents                                                                                                                                                                                                                                |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agents`          | `@boiler-room/agents`: every agent as a definition in code, `agents:sync`, the company and `company:sync`, the Researcher with its capture tool and gate, the Director, the Art Director and Quality Check, `pnpm film` and `FilmOrder` |
| `packages/schema` | `@boiler-room/schema`: the campaign contract, `validateCampaign`, `sceneFrames`, the scene registry of all 15 scene types, and the JSON Schema agents write against                                                                     |
| `packages/motion` | `@boiler-room/motion`: the Remotion templates for the scene types built so far, `<CampaignFilm>`, and the render gate                                                                                                                   |
| `services/render` | `@boiler-room/render`: `pnpm render` and `renderCampaign()`, which render a campaign in chunks on Naive computers and stitch it                                                                                                         |
| `apps/web`        | `@boiler-room/web`: the website and the app, Next.js on Cloudflare Workers with D1, R2 and Clerk. See `docs/deploy.md`                                                                                                                  |
| `apps/*`          | Deployable apps                                                                                                                                                                                                                         |
| `skills`          | Company skills shared by people and agents: `director` and its companions, `art-director`, `quality-check`                                                                                                                              |
| `docs/motion`     | The motion reference spec, one page per scene type, and the transitions                                                                                                                                                                 |
| `packages/*`      | Shared libraries                                                                                                                                                                                                                        |
| `services/*`      | Long-running services                                                                                                                                                                                                                   |

Workspace packages export TypeScript source directly. Nothing is built ahead of time, because
Remotion and Next both transpile it.

## Commands

Requires Node 24 and pnpm 10.

```sh
pnpm install
pnpm test
pnpm typecheck
pnpm lint
pnpm render packages/schema/examples/nova.campaign.json --format 9:16
```

Agents run on Naive. The API key is read from `~/.boiler-room.env` (`NAIVE_API_KEY=...`) at run time.

```sh
pnpm film https://example.com --sample                  # the whole film, URL to checked MP4, in out/films/<host>/<run-id>/
pnpm agents:sync                      # create or version the agents on Naive from agents/
pnpm research https://example.com     # research a site; the result lands in out/research/<host>/
pnpm direct out/research/<host>/research.json --order   # write campaign.json beside the research
pnpm art out/research/<host>/campaign.json              # art-direct it into campaign.art.json
pnpm qc <render-dir> --research out/research/<host>/research.json   # review a rendered film
pnpm company:sync                     # provision the company: agents, roster, board, paused sweep, tokens
pnpm company:status                   # the company's agents, roster, board, sweep, spend and GitHub gaps
pnpm company:verify                   # prove each token works on its own repo and is refused by the other
```

See [`agents/README.md`](agents/README.md).

The web app has its own `pnpm web:*` commands for local development, migrations, deploys,
rollbacks, secrets and logs. [`docs/deploy.md`](docs/deploy.md) lists them and explains how a
change reaches staging and production.
