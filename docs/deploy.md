# Deploying EzySource (staging)

Staging runs as one Cloudflare Worker, `ezysource-staging`, that serves the web app and `/api`, backed by the Supabase project `gmgyqrvwknmcditcaekl` (Singapore) and a private R2 bucket. Pushing to `main` deploys it through `.github/workflows/deploy.yml`.

Secrets are entered by the owner directly in Supabase, Cloudflare and GitHub. They are never committed or pasted into chat.

## Already done

- Database migrations applied to the Supabase project, with the `app` schema locked down (no access for `anon`/`authenticated`, RLS on every table, `ezysource_runtime` group role).
- Supabase security advisor clean.

## One-time setup

### Supabase dashboard

1. **Signing keys.** Project Settings → JWT Keys. The current key must be an asymmetric key (ECC P-256 or RSA). If it says "Legacy HS256 (shared secret)", choose to migrate/rotate to the new signing keys. The API verifies logins against the project's public keys only.
2. **Sign-in code in the email.** Authentication → Emails → Templates → *Magic Link*: make sure the body includes `{{ .Token }}` so people receive a code (for example `Your EzySource code is {{ .Token }}`).
3. **API database login.** SQL Editor → run, with a long random password of your own:

   ```sql
   CREATE ROLE ezysource_api LOGIN PASSWORD '<your long random password>';
   GRANT ezysource_runtime TO ezysource_api;
   ```

4. **Connection string.** Click **Connect** → *Transaction pooler*. Copy the URI and replace the user with `ezysource_api.gmgyqrvwknmcditcaekl` and the password with the one above. Keep it for the Cloudflare step below. It ends in `:6543/postgres`.

Before public launch (not needed for staging): set up custom SMTP under Authentication → SMTP Settings. Supabase's built-in email only sends to project team members.

### Cloudflare dashboard

1. **R2 (can wait).** Enable R2 (it may ask for a payment method even on the free allowance), then create a bucket named `ezysource-media` with public access off. Staging deploys without it; private file requests return 503 until the bucket exists and the `r2_buckets` line in `apps/api/wrangler.jsonc` (staging) is restored.
2. **workers.dev subdomain.** Open Workers & Pages once and accept the subdomain it offers.
3. **API token.** My Profile → API Tokens → Create Token → template *Edit Cloudflare Workers*. Limit it to this account. Once R2 is in use, also add *Account → Workers R2 Storage → Edit*.

### GitHub

Repository → Settings → Environments → New environment `staging` → add two secrets:

- `CLOUDFLARE_API_TOKEN`: the token above
- `CLOUDFLARE_ACCOUNT_ID`: `7f045f5303394e247a4e8130703bc669`

Then Actions → *Deploy staging* → Run workflow.

### After the first deploy

Cloudflare → Workers & Pages → `ezysource-staging` → Settings → Variables and Secrets → add a **Secret** named `DATABASE_URL` with the connection string from Supabase step 4.

### Make yourself owner

1. Open the staging site and sign in with your email and the code you receive. This creates your app user, with no roles.
2. Grant the owner role with migration credentials, never through the API. Either run `pnpm db:bootstrap-owner --subject <your Supabase user UID> --name "Your name"` from a machine that can reach the database, or run this in the Supabase SQL Editor:

   ```sql
   WITH target AS (
     SELECT user_id FROM app.auth_identities
     WHERE provider = 'supabase' AND provider_subject = '<your Supabase user UID>'
   ), granted AS (
     INSERT INTO app.staff_roles (user_id, role) SELECT user_id, 'owner' FROM target RETURNING user_id
   ), bumped AS (
     UPDATE app.app_users SET authz_version = authz_version + 1, updated_at = now()
     WHERE id IN (SELECT user_id FROM granted)
   )
   INSERT INTO app.audit_events (actor_label, action, target_type, target_id, outcome, summary)
   SELECT 'sql:bootstrap-owner', 'staff_role.owner_bootstrap', 'app_user', user_id, 'success', '{"provider":"supabase"}'
   FROM granted;
   ```

   Your UID is under Authentication → Users.
3. Reload the site. You'll be asked to set up an authenticator app, then the Staff page appears.
