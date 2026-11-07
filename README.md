# boiler-room

Boiler Room: autonomous motion design company. Give it a URL, get a launch video.

Agents research the product and write a `campaign.json`. A validator gates that file, Remotion
scenes render it, and the dashboard edits it. `campaign.json` is the contract between all of them.

## Layout

| Path              | Contents                                                                                                                                   |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/schema` | `@boiler-room/schema`: the campaign contract, `validateCampaign`, `sceneFrames`, and the JSON Schema agents write against                  |
| `packages/motion` | `@boiler-room/motion`: the Remotion templates, `<CampaignFilm>`, and the scene registry that `validateCampaign` checks scene types against |
| `services/render` | `@boiler-room/render`: `pnpm render` and `renderCampaign()`, which render a campaign in chunks on Naive computers and stitch it            |
| `apps/*`          | Deployable apps                                                                                                                            |
| `packages/*`      | Shared libraries                                                                                                                           |
| `services/*`      | Long-running services                                                                                                                      |

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
