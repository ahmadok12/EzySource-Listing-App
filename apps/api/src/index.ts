import { createDb, sweepStaleUploads } from "@ezysource/db";
import { app } from "./app";
import type { Env } from "./env";

/**
 * Daily cleanup (wrangler.jsonc "triggers"): uploads that were requested but never
 * finished are marked rejected and any bytes that arrived are deleted (specs/04 step 7).
 * Attached files are never removed by age.
 */
async function sweepUploads(env: Env) {
  if (!env.DATABASE_URL || !env.MEDIA) return;
  const { db, sql } = createDb(env.DATABASE_URL, { max: 1 });
  try {
    const keys = await sweepStaleUploads(db);
    if (keys.length > 0) await env.MEDIA.delete(keys);
    console.log(JSON.stringify({ job: "sweep-uploads", rejected: keys.length }));
  } finally {
    await sql.end({ timeout: 5 });
  }
}

export default {
  fetch: app.fetch,
  scheduled(_controller, env, ctx) {
    ctx.waitUntil(sweepUploads(env));
  },
} satisfies ExportedHandler<Env>;
