# packages/db

PostgreSQL schema, migrations and the owner setup command. Schema source is `src/schema.ts` (Drizzle); SQL migrations live in `migrations/`. See specs/03, specs/08 and specs/12.

## What is in place (Milestone 0)

| Table (`app` schema) | Purpose |
| --- | --- |
| `app_users` | Stable app identity, independent of the login provider |
| `auth_identities` | Login provider subject → app user |
| `staff_roles` | Owner, admin, collector, mapper, sourcing; revoked with `revoked_at` |
| `audit_events` | Append-only record of privileged operations |
| `idempotency_keys` | Actor + operation scoped retries |
| `media_assets` | Metadata for private objects; bytes stay in object storage |

Directory, collection, subscription and map tables arrive with the milestones that use them.

## Access model

- Tables live in the `app` schema, not `public`, so Supabase's auto-generated data API does not expose them.
- `anon` and `authenticated` (Supabase's browser roles) have no usage on the schema. This also covers tables added later.
- The API connects as a login user that is a member of the `ezysource_runtime` group role. That role has only the table grants it needs, cannot delete users or roles, cannot change or delete audit events, cannot create or change owner roles, and cannot alter the schema.
- Row level security is enabled on every table as defence in depth. Business authorisation still happens in the API.
- Migrations and owner setup use separate, elevated migration credentials that the API never sees.

Tests in `test/security.test.ts` prove each of these against a real PostgreSQL with the actual roles.

## Commands

```sh
# Apply migrations (elevated credentials only)
MIGRATION_DATABASE_URL=postgres://... pnpm db:migrate

# Make a signed-in person the owner. Sign in once first, then pass your auth user ID.
MIGRATION_DATABASE_URL=postgres://... pnpm db:bootstrap-owner --subject <auth user id> --name "Your name"

# After changing src/schema.ts
pnpm --filter @ezysource/db generate
```

Owner setup refuses to add a second owner unless `--allow-additional` is passed, and records an audit event.

## Creating the runtime login user

Once per environment, as the migration role, after migrations:

```sql
CREATE ROLE ezysource_api LOGIN PASSWORD '<generated secret>';
GRANT ezysource_runtime TO ezysource_api;
```

The API's `DATABASE_URL` uses this user. Never give the API the migration credentials.

## Local database for tests

The security tests need a PostgreSQL superuser URL to create a throwaway database and roles:

```sh
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres pnpm --filter @ezysource/db test
```

Without `TEST_DATABASE_URL` they are skipped locally. CI always runs them.
