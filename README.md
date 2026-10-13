# EzySource

Subscription supplier directory for Yiwu's Futian wholesale market. The build specification pack is kept in the EzySource project files rather than this public repository. Code comments cite it as `specs/NN` (for example `specs/08` for technical architecture). Work follows the milestones in `specs/09`.

## Layout

```text
apps/web/          React + Vite responsive app (public, member and admin shells)
apps/api/          Cloudflare Worker (Hono) serving /api and the built web app
packages/domain/   Shared DTOs, error shape and roles (Zod)
packages/db/       PostgreSQL schema, migrations and owner setup (see packages/db/README.md)
packages/providers/ Login token verification and private storage adapters (AI and mail later)
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

Real values are never committed. Staging deployment and the one-time Supabase/Cloudflare setup are in [`docs/deploy.md`](docs/deploy.md).

## Sign-in and access

- Login is email OTP through Supabase Auth. The browser SDK is used only in `apps/web/src/auth/adapter.ts`; everything else calls the app API.
- The API verifies the Supabase access token (signature, issuer, audience, expiry) on every request, then reads the caller's suspension state and staff roles from the database. Roles are never trusted from the token, so revoking a role takes effect on the next request.
- Owner and admin actions require two-step verification (an authenticator app). Staff who haven't set it up are taken through enrolment after their first code.
- The first sign-in creates an app user with no roles. Make yourself owner with `pnpm db:bootstrap-owner --subject <your Supabase user id>` (see `packages/db/README.md`).
- Private files are served only through `GET /api/media/:id/content`, which re-checks access on every request and range request. Missing and forbidden files both return 404.
- The API uses bearer tokens only, never cookies, so cross-site requests carry no credentials.

## Collection API

For collectors, and for admins and owners who have completed two-step verification.

| Call | Purpose |
| --- | --- |
| `GET /api/collection/reference` | Districts, floors and categories |
| `GET /api/collection/context` | The caller's access mode and open session |
| `POST /api/collection/sessions`, `PATCH .../:id`, `POST .../:id/finish` | Start, change and finish a session |
| `POST /api/drafts` | Save a new shop with its contacts in one step. Needs an `Idempotency-Key` header; a retry with the same key returns the same draft |
| `GET /api/drafts`, `GET /api/drafts/:id` | The caller's open drafts |
| `PATCH /api/drafts/:id` | Save changes. Send `expectedVersion`; a stale version returns 409 instead of overwriting |
| `POST /api/drafts/:id/contacts`, `PATCH .../contacts/:contactId` | Add or change a contact |

A collector only ever sees drafts they hold a current grant for; anything else returns 404. Database tests run with `TEST_DATABASE_URL` set (see CI).
