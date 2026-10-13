import { randomBytes } from "node:crypto";
import postgres from "postgres";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDb } from "../src/client";

/**
 * Builds a throwaway database that mimics production roles:
 * a non-superuser migration owner, a runtime login user in `ezysource_runtime`,
 * and Supabase's `anon` / `authenticated` roles.
 */
export const adminUrl = process.env.TEST_DATABASE_URL;

if (!adminUrl && process.env.CI) {
  throw new Error("TEST_DATABASE_URL must be set in CI so database security tests run.");
}

export type TestDatabase = Awaited<ReturnType<typeof createTestDatabase>>;

function withCredentials(base: string, user: string, password: string, database: string) {
  const url = new URL(base);
  url.username = user;
  url.password = password;
  url.pathname = `/${database}`;
  return url.toString();
}

export async function createTestDatabase(base: string) {
  const suffix = randomBytes(4).toString("hex");
  const database = `ezysource_test_${suffix}`;
  const migrator = `ez_migrator_${suffix}`;
  const runtime = `ez_api_${suffix}`;
  const password = randomBytes(12).toString("hex");

  const admin = postgres(base, { max: 1, onnotice: () => {} });
  for (const role of ["anon", "authenticated"]) {
    await admin.unsafe(
      `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${role}') THEN CREATE ROLE ${role} NOLOGIN; END IF; END $$`,
    );
  }
  await admin.unsafe(`CREATE ROLE ${migrator} LOGIN CREATEROLE PASSWORD '${password}'`);
  await admin.unsafe(`CREATE ROLE ${runtime} LOGIN PASSWORD '${password}'`);
  await admin.unsafe(`CREATE DATABASE ${database} OWNER ${migrator}`);

  const migratorUrl = withCredentials(base, migrator, password, database);
  const runtimeUrl = withCredentials(base, runtime, password, database);
  const superUrl = withCredentials(base, new URL(base).username, decodeURIComponent(new URL(base).password), database);

  const migration = createDb(migratorUrl, { max: 1 });
  const runtimeDb = createDb(runtimeUrl, { max: 1 });
  const superSql = postgres(superUrl, { max: 1, onnotice: () => {} });

  async function drop() {
    await Promise.all([migration.sql.end(), runtimeDb.sql.end(), superSql.end()]);
    await admin.unsafe(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
    await admin.unsafe(`DROP ROLE IF EXISTS ${runtime}`);
    await admin.unsafe(`DROP ROLE IF EXISTS ${migrator}`);
    await admin.end();
  }

  try {
    // Mimic Supabase, where tables the migration role creates are granted to the
    // browser-facing roles by default. Schema-level revokes must still keep them out.
    await migration.sql.unsafe("ALTER DEFAULT PRIVILEGES GRANT ALL ON TABLES TO anon, authenticated");
    await migrate(migration.db, {
      migrationsFolder: new URL("../migrations", import.meta.url).pathname,
      migrationsSchema: "app_meta",
      migrationsTable: "migrations",
    });
    // Each environment's API login user joins the runtime group role (packages/db/README.md).
    // The cluster-wide group role may predate this test's migrator, so grant as the admin.
    await admin.unsafe(`GRANT ezysource_runtime TO ${runtime}`);
  } catch (error) {
    await drop();
    throw error;
  }

  return {
    migration,
    runtime: runtimeDb,
    superSql,
    drop,
    /** An extra runtime connection, for concurrency tests. Caller closes it. */
    newRuntimeDb: () => createDb(runtimeUrl, { max: 1 }).db,
  };
}
