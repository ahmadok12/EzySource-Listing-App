# EzySource

Subscription supplier directory for Yiwu's Futian wholesale market. The build specification pack is kept in the EzySource project files rather than this public repository. Code comments cite it as `specs/NN` (for example `specs/08` for technical architecture). Work follows the milestones in `specs/09`.

## Layout

```text
apps/web/          React + Vite responsive app (public, member and admin shells)
apps/api/          Cloudflare Worker (Hono) serving /api and the built web app
packages/domain/   Shared DTOs, error shape and roles (Zod)
packages/db/       PostgreSQL schema, migrations and owner setup (see packages/db/README.md)
packages/providers/ Auth, storage, AI and mail adapters (added per integration)
```

## Local development

Requires Node 22 (see `.nvmrc`) and pnpm 10 (`corepack enable`).

```sh
pnpm install
pnpm dev          # web on http://localhost:5173, API on http://localhost:8787
```

The web dev server proxies `/api` to the Worker so the app always calls the same origin, as it will in production.

In `pnpm dev`, the member (`/directory`) and admin (`/admin/collection`) shells are visible as previews of unfinished areas. Production builds hide them unless `VITE_PREVIEW_SHELLS=true`.

## Checks

```sh
pnpm typecheck
pnpm test
pnpm build        # builds the web app, then dry-runs the Worker bundle with it
```

CI runs the same three commands on every pull request, with a PostgreSQL service so the database security tests always run. Locally they need `TEST_DATABASE_URL`; see `packages/db/README.md`.

## Configuration and secrets

- `apps/web/.env.example`: public build-time flags only. Anything prefixed `VITE_` ships to the browser, so it must never hold a secret.
- `apps/api/.dev.vars.example`: names of Worker secrets. Copy to `.dev.vars` locally; use `wrangler secret put` for deployed environments.

Real values are never committed. Supabase and Cloudflare are connected in Milestone 0, step 4.
