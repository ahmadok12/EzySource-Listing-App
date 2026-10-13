-- Lock down database access (specs/08 "PostgreSQL security model", specs/12 "Database exposure").
--
-- * Only the API's runtime role can touch application data. It is a NOLOGIN group role;
--   each environment creates its own login user that is a member of it (see packages/db/README.md).
-- * Supabase's browser-facing roles (anon, authenticated) get nothing, so the auto-generated
--   data API cannot read or write these tables even if the `app` schema were exposed.
-- * Row level security is enabled on every table as defence in depth. The table owner
--   (the migration role) is not subject to it; the runtime role only gets the policies below.
-- * The runtime role can never create, change or revoke an owner, and can never change or
--   delete audit events. Owner setup is a separate command using migration credentials.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ezysource_runtime') THEN
    CREATE ROLE ezysource_runtime NOLOGIN NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END
$$;
--> statement-breakpoint
REVOKE ALL ON SCHEMA app FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON ALL TABLES IN SCHEMA app FROM PUBLIC;
--> statement-breakpoint
DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON SCHEMA app FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA app FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA app FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA app REVOKE ALL ON TABLES FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA app REVOKE ALL ON SEQUENCES FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA app REVOKE ALL ON FUNCTIONS FROM %I', r);
    END IF;
  END LOOP;
END
$$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA app TO ezysource_runtime;
--> statement-breakpoint

-- Table grants: only what the API needs. No TRUNCATE, REFERENCES or TRIGGER.
GRANT SELECT, INSERT, UPDATE ON app.app_users TO ezysource_runtime;
--> statement-breakpoint
GRANT SELECT, INSERT ON app.auth_identities TO ezysource_runtime;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON app.staff_roles TO ezysource_runtime;
--> statement-breakpoint
GRANT SELECT, INSERT ON app.audit_events TO ezysource_runtime;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON app.idempotency_keys TO ezysource_runtime;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON app.media_assets TO ezysource_runtime;
--> statement-breakpoint

ALTER TABLE app.app_users ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.auth_identities ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.staff_roles ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.audit_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.idempotency_keys ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.media_assets ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- The API enforces per-actor access in code (specs/08 request pipeline). These policies
-- scope the runtime role to the operations it is granted and block owner changes.
CREATE POLICY runtime_all ON app.app_users TO ezysource_runtime USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY runtime_all ON app.auth_identities TO ezysource_runtime USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY runtime_all ON app.idempotency_keys TO ezysource_runtime USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY runtime_all ON app.media_assets TO ezysource_runtime USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY runtime_read ON app.audit_events FOR SELECT TO ezysource_runtime USING (true);
--> statement-breakpoint
CREATE POLICY runtime_append ON app.audit_events FOR INSERT TO ezysource_runtime WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY runtime_read ON app.staff_roles FOR SELECT TO ezysource_runtime USING (true);
--> statement-breakpoint
CREATE POLICY runtime_insert_non_owner ON app.staff_roles FOR INSERT TO ezysource_runtime
  WITH CHECK (role <> 'owner');
--> statement-breakpoint
CREATE POLICY runtime_update_non_owner ON app.staff_roles FOR UPDATE TO ezysource_runtime
  USING (role <> 'owner') WITH CHECK (role <> 'owner');
