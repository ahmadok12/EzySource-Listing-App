import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./migrations",
  schemaFilter: ["app"],
  migrations: { schema: "app_meta", table: "migrations" },
});
