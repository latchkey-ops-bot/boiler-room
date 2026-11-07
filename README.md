# boiler-room

Boiler Room: autonomous motion design company. Give it a URL, get a launch video.

Agents research the product and write a `campaign.json`. A validator gates that file, Remotion
scenes render it, and the dashboard edits it. `campaign.json` is the contract between all of them.

## Layout

| Path              | Contents                                                                                                                     |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `agents`          | `@boiler-room/agents`: every agent as a definition in code, `agents:sync`, and the Researcher with its capture tool and gate |
| `packages/schema` | `@boiler-room/schema`: the campaign contract, `validateCampaign`, `sceneFrames`, and the JSON Schema agents write against    |
| `apps/*`          | Deployable apps                                                                                                              |
| `packages/*`      | Shared libraries                                                                                                             |
| `services/*`      | Long-running services                                                                                                        |

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
```

See [`agents/README.md`](agents/README.md).
