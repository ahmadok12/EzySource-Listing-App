import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  smallint,
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
      sql`${t.state} in ('staged', 'uploaded', 'validated', 'rejected', 'removed')`,
    ),
    check("media_assets_size_check", sql`${t.sizeBytes} > 0`),
  ],
);

// ---------------------------------------------------------------------------
// Market locations and categories (specs/03 "Maps", "Directory and collection").
// Reference data: the runtime role may read but not change these yet.

export const markets = app.table("markets", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: varchar("slug", { length: 60 }).notNull().unique(),
  nameEn: varchar("name_en", { length: 120 }).notNull(),
  nameZh: varchar("name_zh", { length: 120 }),
  orderIndex: smallint("order_index").notNull().default(0),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
});

export const districts = app.table(
  "districts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    marketId: uuid("market_id")
      .notNull()
      .references(() => markets.id, { onDelete: "restrict" }),
    code: varchar("code", { length: 20 }).notNull(),
    nameEn: varchar("name_en", { length: 120 }).notNull(),
    nameZh: varchar("name_zh", { length: 120 }),
    orderIndex: smallint("order_index").notNull().default(0),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("districts_market_code_key").on(t.marketId, t.code)],
);

export const floors = app.table(
  "floors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    districtId: uuid("district_id")
      .notNull()
      .references(() => districts.id, { onDelete: "restrict" }),
    /** Display label such as "F1". */
    label: varchar("label", { length: 20 }).notNull(),
    orderIndex: smallint("order_index").notNull().default(0),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("floors_district_label_key").on(t.districtId, t.label)],
);

export const categories = app.table(
  "categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    parentId: uuid("parent_id").references((): AnyPgColumn => categories.id, { onDelete: "restrict" }),
    slug: varchar("slug", { length: 80 }).notNull().unique(),
    nameEn: varchar("name_en", { length: 120 }).notNull(),
    nameZh: varchar("name_zh", { length: 120 }),
    orderIndex: smallint("order_index").notNull().default(0),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [index("categories_parent_idx").on(t.parentId)],
);

// ---------------------------------------------------------------------------
// Collection (specs/03, specs/04, specs/06).

/** A collector's working period and location/category defaults. */
export const collectionSessions = app.table(
  "collection_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    collectorId: uuid("collector_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "restrict" }),
    districtId: uuid("district_id").references(() => districts.id, { onDelete: "restrict" }),
    floorId: uuid("floor_id").references(() => floors.id, { onDelete: "restrict" }),
    defaultCategoryId: uuid("default_category_id").references(() => categories.id, {
      onDelete: "restrict",
    }),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    // At most one open session per collector.
    uniqueIndex("collection_sessions_open_key").on(t.collectorId).where(sql`${t.finishedAt} is null`),
    index("collection_sessions_collector_idx").on(t.collectorId, t.startedAt),
  ],
);

/** Stable supplier identity. Content lives in revisions. */
export const shops = app.table(
  "shops",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    lifecycle: varchar("lifecycle", { length: 16 }).notNull().default("active"),
    /** Set only by publishing. Members read this pointer and nothing else. */
    publishedRevisionId: uuid("published_revision_id"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => appUsers.id, { onDelete: "restrict" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("shops_lifecycle_check", sql`${t.lifecycle} in ('active', 'moved', 'closed', 'archived')`),
    index("shops_published_idx").on(t.publishedRevisionId, t.lifecycle),
  ],
);

/** A consistent snapshot of a shop's member-visible fields. Drafts are revisions. */
export const shopRevisions = app.table(
  "shop_revisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "restrict" }),
    /** Optimistic concurrency: every change must name the version it was based on. */
    version: integer("version").notNull().default(1),
    state: varchar("state", { length: 16 }).notNull().default("draft"),
    nameZh: varchar("name_zh", { length: 200 }),
    nameEn: varchar("name_en", { length: 200 }),
    companyName: varchar("company_name", { length: 200 }),
    description: varchar("description", { length: 4000 }),
    districtId: uuid("district_id").references(() => districts.id, { onDelete: "restrict" }),
    floorId: uuid("floor_id").references(() => floors.id, { onDelete: "restrict" }),
    /** Booth numbers are strings: they can carry letters and leading zeros. */
    boothNumber: varchar("booth_number", { length: 40 }),
    collectorId: uuid("collector_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "restrict" }),
    sessionId: uuid("session_id").references(() => collectionSessions.id, { onDelete: "restrict" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    reviewedBy: uuid("reviewed_by").references(() => appUsers.id, { onDelete: "restrict" }),
  },
  (t) => [
    check(
      "shop_revisions_state_check",
      sql`${t.state} in ('draft', 'submitted', 'returned', 'approved', 'archived')`,
    ),
    check("shop_revisions_version_check", sql`${t.version} > 0`),
    index("shop_revisions_shop_idx").on(t.shopId),
    index("shop_revisions_collector_idx").on(t.collectorId, t.state, t.createdAt),
    index("shop_revisions_session_idx").on(t.sessionId),
  ],
);

export const revisionCategories = app.table(
  "revision_categories",
  {
    revisionId: uuid("revision_id")
      .notNull()
      .references(() => shopRevisions.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "restrict" }),
    isPrimary: boolean("is_primary").notNull().default(false),
  },
  (t) => [
    primaryKey({ columns: [t.revisionId, t.categoryId] }),
    uniqueIndex("revision_categories_primary_key").on(t.revisionId).where(sql`${t.isPrimary}`),
    index("revision_categories_category_idx").on(t.categoryId),
  ],
);

export const revisionKeywords = app.table(
  "revision_keywords",
  {
    revisionId: uuid("revision_id")
      .notNull()
      .references(() => shopRevisions.id, { onDelete: "cascade" }),
    keyword: varchar("keyword", { length: 80 }).notNull(),
    /** BCP 47 tag such as "zh" or "en", or "und" when unknown. */
    language: varchar("language", { length: 16 }).notNull().default("und"),
  },
  (t) => [primaryKey({ columns: [t.revisionId, t.keyword] })],
);

/** Stable identity for a person, so revisions can refer to the same contact over time. */
export const contacts = app.table("contacts", {
  id: uuid("id").primaryKey().defaultRandom(),
  createdBy: uuid("created_by")
    .notNull()
    .references(() => appUsers.id, { onDelete: "restrict" }),
  createdAt: createdAt(),
});

/**
 * A contact as it appears in one revision, including its link to the shop
 * (specs/03 revision_contacts + shop_contact_links, kept in one table for now).
 */
export const revisionContacts = app.table(
  "revision_contacts",
  {
    revisionId: uuid("revision_id")
      .notNull()
      .references(() => shopRevisions.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "restrict" }),
    displayName: varchar("display_name", { length: 120 }),
    title: varchar("title", { length: 120 }),
    isPrimary: boolean("is_primary").notNull().default(false),
    orderIndex: smallint("order_index").notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.revisionId, t.contactId] }),
    // One primary contact per revision.
    uniqueIndex("revision_contacts_primary_key").on(t.revisionId).where(sql`${t.isPrimary}`),
    index("revision_contacts_contact_idx").on(t.contactId),
  ],
);

/** Phone, WeChat, etc. A null contact means a shared shop channel. */
export const contactChannels = app.table(
  "contact_channels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    revisionId: uuid("revision_id")
      .notNull()
      .references(() => shopRevisions.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "restrict" }),
    type: varchar("type", { length: 16 }).notNull(),
    value: varchar("value", { length: 300 }).notNull(),
    label: varchar("label", { length: 60 }),
    orderIndex: smallint("order_index").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    check(
      "contact_channels_type_check",
      sql`${t.type} in ('phone', 'email', 'wechat', 'whatsapp', 'website', 'social')`,
    ),
    // A person's channel must belong to a contact that is on the same revision.
    foreignKey({
      name: "contact_channels_revision_contact_fk",
      columns: [t.revisionId, t.contactId],
      foreignColumns: [revisionContacts.revisionId, revisionContacts.contactId],
    }).onDelete("cascade"),
    index("contact_channels_revision_idx").on(t.revisionId),
  ],
);

/**
 * Server-evaluated access for a collector to one revision (specs/06).
 * Effective access also needs an active staff role and an editable state.
 */
export const recordGrants = app.table(
  "record_grants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "restrict" }),
    revisionId: uuid("revision_id")
      .notNull()
      .references(() => shopRevisions.id, { onDelete: "restrict" }),
    source: varchar("source", { length: 16 }).notNull(),
    /** The collector policy mode in force when the grant was made. */
    policyMode: varchar("policy_mode", { length: 24 }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => appUsers.id, { onDelete: "restrict" }),
    createdAt: createdAt(),
  },
  (t) => [
    check("record_grants_source_check", sql`${t.source} in ('collection', 'return', 'admin')`),
    index("record_grants_user_idx").on(t.userId, t.revisionId),
    index("record_grants_revision_idx").on(t.revisionId),
  ],
);

/** Per-collector access policy. No row means the default, review then submit. */
export const collectorPolicies = app.table(
  "collector_policies",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => appUsers.id, { onDelete: "restrict" }),
    mode: varchar("mode", { length: 24 }).notNull().default("review_then_submit"),
    /** Temporary mode: grant lasts this long after saving... */
    grantDurationMinutes: integer("grant_duration_minutes"),
    /** ...or until this absolute deadline. Also optional in review mode. */
    grantDeadline: timestamp("grant_deadline", { withTimezone: true }),
    allowOfflineCapture: boolean("allow_offline_capture").notNull().default(true),
    changedBy: uuid("changed_by").references(() => appUsers.id, { onDelete: "restrict" }),
    version: integer("version").notNull().default(1),
    updatedAt: updatedAt(),
  },
  (t) => [
    check(
      "collector_policies_mode_check",
      sql`${t.mode} in ('own_until_revoked', 'temporary', 'review_then_submit', 'immediate_handoff')`,
    ),
    check(
      "collector_policies_temporary_check",
      sql`${t.mode} <> 'temporary' or ${t.grantDurationMinutes} is not null or ${t.grantDeadline} is not null`,
    ),
    check(
      "collector_policies_duration_check",
      sql`${t.grantDurationMinutes} is null or ${t.grantDurationMinutes} > 0`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Shop media (specs/03 media_links, specs/04 "Media collection" and "Upload protocol").

/**
 * Where an uploaded file belongs on a revision. Created when the upload is requested,
 * so the target is fixed by the server before any bytes arrive (specs/09 COLL-08);
 * the file only shows on the shop once its asset is validated.
 */
export const mediaLinks = app.table(
  "media_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    revisionId: uuid("revision_id")
      .notNull()
      .references(() => shopRevisions.id, { onDelete: "cascade" }),
    mediaId: uuid("media_id")
      .notNull()
      .references(() => mediaAssets.id, { onDelete: "restrict" }),
    purpose: varchar("purpose", { length: 20 }).notNull(),
    /** Set for business cards and chat QR codes that belong to one person. */
    contactId: uuid("contact_id"),
    /** Caption for a sign photo, or the title of a voice note. */
    caption: varchar("caption", { length: 200 }),
    visibility: varchar("visibility", { length: 16 }).notNull(),
    orderIndex: integer("order_index").notNull().default(0),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => appUsers.id, { onDelete: "restrict" }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("media_links_revision_media_key").on(t.revisionId, t.mediaId),
    index("media_links_revision_idx").on(t.revisionId, t.purpose, t.orderIndex),
    index("media_links_media_idx").on(t.mediaId),
    check(
      "media_links_purpose_check",
      sql`${t.purpose} in ('sign', 'overview', 'section', 'voice', 'card_front', 'card_back', 'wechat_qr', 'whatsapp_qr')`,
    ),
    check("media_links_visibility_check", sql`${t.visibility} in ('subscriber', 'staff', 'internal')`),
    // A person's card or QR must belong to a contact on the same revision.
    foreignKey({
      name: "media_links_revision_contact_fk",
      columns: [t.revisionId, t.contactId],
      foreignColumns: [revisionContacts.revisionId, revisionContacts.contactId],
    }).onDelete("cascade"),
  ],
);
