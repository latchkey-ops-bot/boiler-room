# boiler-room

Boiler Room: autonomous motion design company. Give it a URL, get a launch video.

Agents research the product and write a `campaign.json`. A validator gates that file, Remotion
scenes render it, and the dashboard edits it. `campaign.json` is the contract between all of them.

## Layout

| Path              | Contents                                                                                                                                                                   |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agents`          | `@boiler-room/agents`: every agent as a definition in code, `agents:sync`, the Researcher with its capture tool and gate, the Director, the Art Director and Quality Check |
| `packages/schema` | `@boiler-room/schema`: the campaign contract, `validateCampaign`, `sceneFrames`, `sceneRegistry`, and the JSON Schema agents write against                                 |
| `apps/*`          | Deployable apps                                                                                                                                                            |
| `skills`          | Company skills shared by people and agents: `director` and its companions, `art-director`, `quality-check`                                                                 |
| `docs/motion`     | The motion reference spec, one page per scene type, and the transitions                                                                                                    |
| `packages/*`      | Shared libraries                                                                                                                                                           |
| `services/*`      | Long-running services                                                                                                                                                      |

Workspace packages export TypeScript source directly. Nothing is built ahead of time, because
Remotion and Next both transpile it.

## Commands

Requires Node 24 and pnpm 10.

```sh
pnpm install
pnpm test
pnpm typecheck
pnpm lint
```

Agents run on Naive. The API key is read from `~/.boiler-room.env` (`NAIVE_API_KEY=...`) at run time.

```sh
pnpm agents:sync                      # create or version the agents on Naive from agents/
pnpm research https://example.com     # research a site; the result lands in out/research/<host>/
pnpm direct out/research/<host>/research.json --order   # write campaign.json beside the research
pnpm art out/research/<host>/campaign.json              # art-direct it into campaign.art.json
pnpm qc <render-dir> --research out/research/<host>/research.json   # review a rendered film
```

See [`agents/README.md`](agents/README.md).
