import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDb } from "../src/client";

const url = process.env.MIGRATION_DATABASE_URL;
if (!url) {
  console.error("Set MIGRATION_DATABASE_URL (elevated migration credentials, never the runtime user).");
  process.exit(1);
}

const { db, sql } = createDb(url, { max: 1 });
try {
  await migrate(db, {
    migrationsFolder: new URL("../migrations", import.meta.url).pathname,
    migrationsSchema: "app_meta",
    migrationsTable: "migrations",
  });
  console.log("Migrations applied.");
} finally {
  await sql.end();
}
