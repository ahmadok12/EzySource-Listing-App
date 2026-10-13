import { parseArgs } from "node:util";
import { bootstrapOwner } from "../src/bootstrap-owner";
import { createDb } from "../src/client";

const { values } = parseArgs({
  options: {
    provider: { type: "string", default: "supabase" },
    subject: { type: "string" },
    name: { type: "string" },
    "allow-additional": { type: "boolean", default: false },
  },
});

const url = process.env.MIGRATION_DATABASE_URL;
if (!url || !values.subject || !values.name) {
  console.error(
    'Usage: MIGRATION_DATABASE_URL=... pnpm --filter @ezysource/db bootstrap-owner --subject <auth user id> --name "Display name" [--provider supabase] [--allow-additional]',
  );
  process.exit(1);
}

const { db, sql } = createDb(url, { max: 1 });
try {
  const result = await bootstrapOwner(db, {
    provider: values.provider!,
    providerSubject: values.subject,
    displayName: values.name,
    allowAdditional: values["allow-additional"]!,
  });
  switch (result.status) {
    case "created":
      console.log(`Owner role granted to app user ${result.userId}.`);
      break;
    case "already_owner":
      console.log(`That identity is already an owner (app user ${result.userId}). Nothing changed.`);
      break;
    case "owner_exists":
      console.error("An owner already exists. Re-run with --allow-additional to add another owner.");
      process.exitCode = 2;
      break;
  }
} finally {
  await sql.end();
}
