# boiler-room

Boiler Room: autonomous motion design company. Give it a URL, get a launch video.

Agents research the product and write a `campaign.json`. A validator gates that file, Remotion
scenes render it, and the dashboard edits it. `campaign.json` is the contract between all of them.

## Layout

| Path              | Contents                                                                                                                  |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `packages/schema` | `@boiler-room/schema`: the campaign contract, `validateCampaign`, `sceneFrames`, and the JSON Schema agents write against |
| `apps/web`        | `@boiler-room/web`: the website and the app, Next.js on Cloudflare Workers with D1, R2 and Clerk. See `docs/deploy.md`    |
| `apps/*`          | Deployable apps                                                                                                           |
| `packages/*`      | Shared libraries                                                                                                          |
| `services/*`      | Long-running services                                                                                                     |

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

The web app has its own `pnpm web:*` commands for local development, migrations, deploys,
rollbacks, secrets and logs. [`docs/deploy.md`](docs/deploy.md) lists them and explains how a
change reaches staging and production.
