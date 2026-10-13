-- Access for shop media links (same model as 0003_collection_access.sql).
--
-- * Browser-facing roles get nothing.
-- * The runtime role may remove a link (a collector deleting a photo from a draft).
--   It still cannot delete media_assets rows: removed and abandoned files are marked
--   'removed' or 'rejected' and their bytes are cleaned up from storage.

DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON app.media_links FROM %I', r);
    END IF;
  END LOOP;
END
$$;
--> statement-breakpoint
REVOKE ALL ON app.media_links FROM PUBLIC;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON app.media_links TO ezysource_runtime;
--> statement-breakpoint
ALTER TABLE app.media_links ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY runtime_all ON app.media_links TO ezysource_runtime USING (true) WITH CHECK (true);
