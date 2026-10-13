import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

/**
 * Application tables live in the `app` schema, not `public`, so Supabase's
 * auto-generated data API never exposes them. Only the API's runtime role is
 * granted access (see the security migration). specs/03, specs/08, specs/12.
 */
export const app = pgSchema("app");

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

/** Stable application identity, independent of the login provider. */
export const appUsers = app.table(
  "app_users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    displayName: varchar("display_name", { length: 120 }).notNull(),
    state: varchar("state", { length: 16 }).notNull().default("active"),
    /** Bumped on any role, grant or suspension change so stale sessions can be detected. */
    authzVersion: integer("authz_version").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [check("app_users_state_check", sql`${t.state} in ('active', 'suspended')`)],
);

/** Maps a login provider's subject to an app user. Replaceable provider (specs/11). */
export const authIdentities = app.table(
  "auth_identities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "restrict" }),
    provider: varchar("provider", { length: 40 }).notNull(),
    providerSubject: varchar("provider_subject", { length: 255 }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("auth_identities_provider_subject_key").on(t.provider, t.providerSubject),
    index("auth_identities_user_id_idx").on(t.userId),
  ],
);

/**
 * Staff roles. Revocation sets revoked_at rather than deleting the row.
 * The runtime role can never create, change or revoke an owner role.
 */
export const staffRoles = app.table(
  "staff_roles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "restrict" }),
    role: varchar("role", { length: 16 }).notNull(),
    scope: jsonb("scope").notNull().default({}),
    grantedBy: uuid("granted_by").references(() => appUsers.id, { onDelete: "restrict" }),
    createdAt: createdAt(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    check(
      "staff_roles_role_check",
      sql`${t.role} in ('owner', 'admin', 'collector', 'mapper', 'sourcing')`,
    ),
    uniqueIndex("staff_roles_active_user_role_key")
      .on(t.userId, t.role)
      .where(sql`${t.revokedAt} is null`),
  ],
);

/** Append-only audit trail for privileged operations (specs/12). */
export const auditEvents = app.table(
  "audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorId: uuid("actor_id").references(() => appUsers.id, { onDelete: "restrict" }),
    /** Who acted when there is no app user, e.g. "cli:bootstrap-owner". */
    actorLabel: varchar("actor_label", { length: 80 }),
    action: varchar("action", { length: 80 }).notNull(),
    targetType: varchar("target_type", { length: 40 }).notNull(),
    targetId: uuid("target_id"),
    outcome: varchar("outcome", { length: 16 }).notNull(),
    policyVersion: integer("policy_version"),
    requestId: varchar("request_id", { length: 64 }),
    /** Safe change summary only. Never contact content, tokens or note text. */
    summary: jsonb("summary").notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [
    check("audit_events_outcome_check", sql`${t.outcome} in ('success', 'denied', 'failed')`),
    check("audit_events_actor_check", sql`${t.actorId} is not null or ${t.actorLabel} is not null`),
    index("audit_events_target_idx").on(t.targetType, t.targetId, t.createdAt),
    index("audit_events_actor_idx").on(t.actorId, t.createdAt),
  ],
);

/** Idempotency keys scoped to actor + operation (specs/12). */
export const idempotencyKeys = app.table(
  "idempotency_keys",
  {
    actorId: uuid("actor_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "restrict" }),
    operation: varchar("operation", { length: 80 }).notNull(),
    key: varchar("key", { length: 128 }).notNull(),
    payloadHash: varchar("payload_hash", { length: 128 }).notNull(),
    state: varchar("state", { length: 16 }).notNull().default("pending"),
    resultReference: varchar("result_reference", { length: 255 }),
    createdAt: createdAt(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.actorId, t.operation, t.key] }),
    check("idempotency_keys_state_check", sql`${t.state} in ('pending', 'completed', 'failed')`),
    index("idempotency_keys_expires_at_idx").on(t.expiresAt),
  ],
);

/** Metadata for private objects. Bytes live in object storage under object_key. */
export const mediaAssets = app.table(
  "media_assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    objectKey: varchar("object_key", { length: 512 }).notNull(),
    kind: varchar("kind", { length: 16 }).notNull(),
    mimeType: varchar("mime_type", { length: 100 }).notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    checksum: varchar("checksum", { length: 128 }),
    state: varchar("state", { length: 16 }).notNull().default("staged"),
    width: integer("width"),
    height: integer("height"),
    durationMs: integer("duration_ms"),
    uploaderId: uuid("uploader_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "restrict" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("media_assets_object_key_key").on(t.objectKey),
    index("media_assets_uploader_idx").on(t.uploaderId, t.createdAt),
    check("media_assets_kind_check", sql`${t.kind} in ('image', 'audio', 'pdf')`),
    check(
      "media_assets_state_check",
      sql`${t.state} in ('staged', 'uploaded', 'validated', 'rejected')`,
    ),
    check("media_assets_size_check", sql`${t.sizeBytes} > 0`),
  ],
);
