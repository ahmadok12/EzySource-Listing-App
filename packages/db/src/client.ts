import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

export type Database = ReturnType<typeof createDb>["db"];

/**
 * Creates a parameterised Drizzle client. The API uses the runtime login user;
 * migrations and owner setup use the separate migration credentials (specs/08).
 */
export function createDb(url: string, options: { max?: number } = {}) {
  const sql = postgres(url, {
    max: options.max ?? 5,
    // Transaction-mode poolers (Supabase pooler, Hyperdrive) do not support prepared statements.
    prepare: false,
    onnotice: () => {},
  });
  return { db: drizzle(sql, { schema }), sql };
}
