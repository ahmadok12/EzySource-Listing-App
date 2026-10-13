-- Access for the collection tables (same model as 0001_lock_down_access.sql), plus
-- starter reference data.
--
-- * Browser-facing roles get nothing. The app schema already has no USAGE for them;
--   table privileges are revoked too in case a platform default granted them.
-- * The runtime role gets only what the API needs. Reference data is read-only.
--   Nothing here can be deleted by the API except a draft's own child rows, which
--   a save replaces as a set.
-- * Per-collector access (record grants, policy modes) is enforced by the API in one
--   query per request (packages/db/src/collection.ts); RLS scopes the runtime role.

DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA app FROM %I', r);
    END IF;
  END LOOP;
END
$$;
--> statement-breakpoint
REVOKE ALL ON ALL TABLES IN SCHEMA app FROM PUBLIC;
--> statement-breakpoint

GRANT SELECT ON app.markets, app.districts, app.floors, app.categories TO ezysource_runtime;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON app.collection_sessions, app.shops, app.shop_revisions,
  app.record_grants, app.collector_policies TO ezysource_runtime;
--> statement-breakpoint
GRANT SELECT, INSERT ON app.contacts TO ezysource_runtime;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON app.revision_categories, app.revision_keywords,
  app.revision_contacts, app.contact_channels TO ezysource_runtime;
--> statement-breakpoint

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'markets', 'districts', 'floors', 'categories', 'collection_sessions', 'shops',
    'shop_revisions', 'revision_categories', 'revision_keywords', 'contacts',
    'revision_contacts', 'contact_channels', 'record_grants', 'collector_policies'
  ] LOOP
    EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;

  FOREACH t IN ARRAY ARRAY['markets', 'districts', 'floors', 'categories'] LOOP
    EXECUTE format(
      'CREATE POLICY runtime_read ON app.%I FOR SELECT TO ezysource_runtime USING (true)', t);
  END LOOP;

  FOREACH t IN ARRAY ARRAY[
    'collection_sessions', 'shops', 'shop_revisions', 'revision_categories', 'revision_keywords',
    'contacts', 'revision_contacts', 'contact_channels', 'record_grants', 'collector_policies'
  ] LOOP
    EXECUTE format(
      'CREATE POLICY runtime_all ON app.%I TO ezysource_runtime USING (true) WITH CHECK (true)', t);
  END LOOP;
END
$$;
--> statement-breakpoint

-- Starter locations: Futian market districts 1-5, floors F1-F4. The owner should confirm
-- these; an admin screen for locations comes later.
INSERT INTO app.markets (slug, name_en, name_zh)
VALUES ('futian', 'Yiwu International Trade City (Futian)', '义乌国际商贸城（福田市场）')
ON CONFLICT (slug) DO NOTHING;
--> statement-breakpoint
INSERT INTO app.districts (market_id, code, name_en, name_zh, order_index)
SELECT m.id, 'D' || n, 'District ' || n, n || '区', n
FROM app.markets m, generate_series(1, 5) AS n
WHERE m.slug = 'futian'
ON CONFLICT (market_id, code) DO NOTHING;
--> statement-breakpoint
INSERT INTO app.floors (district_id, label, order_index)
SELECT d.id, 'F' || f, f
FROM app.districts d
JOIN app.markets m ON m.id = d.market_id AND m.slug = 'futian'
CROSS JOIN generate_series(1, 4) AS f
ON CONFLICT (district_id, label) DO NOTHING;
--> statement-breakpoint

-- Starter top-level categories, to be refined by the owner.
INSERT INTO app.categories (slug, name_en, name_zh, order_index) VALUES
  ('toys', 'Toys', '玩具', 1),
  ('artificial-flowers', 'Artificial flowers', '仿真花', 2),
  ('jewellery', 'Jewellery', '饰品', 3),
  ('hair-accessories', 'Hair accessories', '发饰', 4),
  ('crafts', 'Crafts and gifts', '工艺品', 5),
  ('festive', 'Festive and party', '节庆用品', 6),
  ('household', 'Household goods', '日用百货', 7),
  ('kitchenware', 'Kitchenware', '厨具', 8),
  ('stationery', 'Stationery and office', '文具办公', 9),
  ('bags-luggage', 'Bags and luggage', '箱包', 10),
  ('hardware-tools', 'Hardware and tools', '五金工具', 11),
  ('electronics', 'Electronics and accessories', '电子电器', 12),
  ('sports-outdoor', 'Sports and outdoor', '体育户外', 13),
  ('cosmetics', 'Cosmetics and personal care', '化妆品', 14),
  ('clothing-accessories', 'Clothing accessories', '服饰配件', 15),
  ('packaging', 'Packaging', '包装', 16)
ON CONFLICT (slug) DO NOTHING;
