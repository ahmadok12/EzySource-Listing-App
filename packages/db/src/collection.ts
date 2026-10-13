import { and, asc, desc, eq, inArray, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import {
  DomainError,
  type AddContactInput,
  type ChannelInput,
  type CollectionContext,
  type CollectionReference,
  type CollectionSession,
  type CollectorMode,
  type ContactInput,
  type CreateDraftInput,
  type Draft,
  type DraftListResponse,
  type RevisionState,
  type SessionDefaults,
  type StaffRole,
  type UpdateContactInput,
  type UpdateDraftInput,
} from "@ezysource/domain";
import type { Database } from "./client";
import { accessible, isReviewer, notFound, type CollectionActor, type Queryable, type Tx } from "./access";
import { loadDraftMedia } from "./media";
import {
  auditEvents,
  categories,
  collectionSessions,
  collectorPolicies,
  contactChannels,
  contacts,
  districts,
  floors,
  idempotencyKeys,
  markets,
  recordGrants,
  revisionCategories,
  revisionContacts,
  revisionKeywords,
  shopRevisions,
  shops,
} from "./schema";

/**
 * Shop collection: sessions, drafts and the collector access rules in specs/06.
 *
 * Every read and write re-evaluates access in the same query that loads the record:
 * active grant AND not revoked AND not expired (database time) AND allowed state,
 * plus, for immediate handoff, the draft's session still being open. Owners and
 * admins are not limited by grants. Records the caller can't access are reported as
 * not found, so responses never confirm that someone else's record exists.
 */

const IDEMPOTENCY_TTL = sql`now() + interval '24 hours'`;
const DEFAULT_MODE: CollectorMode = "review_then_submit";

const invalid = (field: string, message: string) =>
  new DomainError("validation_failed", message, { [field]: [message] });

// Reference data -----------------------------------------------------------------

export type { CollectionActor } from "./access";

export async function getCollectionReference(db: Queryable): Promise<CollectionReference> {
  const [marketRows, districtRows, floorRows, categoryRows] = await Promise.all([
    db
      .select({ id: markets.id, nameEn: markets.nameEn, nameZh: markets.nameZh })
      .from(markets)
      .where(eq(markets.active, true))
      .orderBy(asc(markets.orderIndex), asc(markets.nameEn)),
    db
      .select({
        id: districts.id,
        marketId: districts.marketId,
        code: districts.code,
        nameEn: districts.nameEn,
        nameZh: districts.nameZh,
      })
      .from(districts)
      .where(eq(districts.active, true))
      .orderBy(asc(districts.orderIndex), asc(districts.code)),
    db
      .select({ id: floors.id, districtId: floors.districtId, label: floors.label })
      .from(floors)
      .where(eq(floors.active, true))
      .orderBy(asc(floors.orderIndex), asc(floors.label)),
    db
      .select({
        id: categories.id,
        parentId: categories.parentId,
        slug: categories.slug,
        nameEn: categories.nameEn,
        nameZh: categories.nameZh,
      })
      .from(categories)
      .where(eq(categories.active, true))
      .orderBy(asc(categories.orderIndex), asc(categories.nameEn)),
  ]);

  return {
    markets: marketRows.map((m) => ({
      ...m,
      districts: districtRows
        .filter((d) => d.marketId === m.id)
        .map(({ marketId: _, ...d }) => ({
          ...d,
          floors: floorRows
            .filter((f) => f.districtId === d.id)
            .map(({ districtId: __, ...f }) => f),
        })),
    })),
    categories: categoryRows,
  };
}

/** Checks a district/floor pair. A floor alone implies its district. */
async function resolveLocation(
  db: Queryable,
  districtId: string | null,
  floorId: string | null,
): Promise<{ districtId: string | null; floorId: string | null }> {
  if (floorId) {
    const [floor] = await db
      .select({ districtId: floors.districtId })
      .from(floors)
      .innerJoin(districts, eq(districts.id, floors.districtId))
      .where(and(eq(floors.id, floorId), eq(floors.active, true), eq(districts.active, true)));
    if (!floor) throw invalid("floorId", "Choose a floor from the list.");
    if (districtId && districtId !== floor.districtId) {
      throw invalid("floorId", "That floor isn't in the chosen district.");
    }
    return { districtId: floor.districtId, floorId };
  }
  if (districtId) {
    const [district] = await db
      .select({ id: districts.id })
      .from(districts)
      .where(and(eq(districts.id, districtId), eq(districts.active, true)));
    if (!district) throw invalid("districtId", "Choose a district from the list.");
  }
  return { districtId, floorId: null };
}

async function checkCategories(db: Queryable, ids: readonly string[], field: string) {
  const unique = [...new Set(ids)];
  if (unique.length !== ids.length) throw invalid(field, "Each category can be chosen once.");
  if (unique.length === 0) return;
  const found = await db
    .select({ id: categories.id })
    .from(categories)
    .where(and(inArray(categories.id, unique), eq(categories.active, true)));
  if (found.length !== unique.length) throw invalid(field, "Choose categories from the list.");
}

// Policy and sessions ------------------------------------------------------------

type Policy = {
  mode: CollectorMode;
  grantDurationMinutes: number | null;
  grantDeadline: Date | null;
  allowOfflineCapture: boolean;
};

async function getPolicy(db: Queryable, userId: string): Promise<Policy> {
  const [row] = await db
    .select({
      mode: collectorPolicies.mode,
      grantDurationMinutes: collectorPolicies.grantDurationMinutes,
      grantDeadline: collectorPolicies.grantDeadline,
      allowOfflineCapture: collectorPolicies.allowOfflineCapture,
    })
    .from(collectorPolicies)
    .where(eq(collectorPolicies.userId, userId));
  if (!row) {
    return { mode: DEFAULT_MODE, grantDurationMinutes: null, grantDeadline: null, allowOfflineCapture: true };
  }
  return { ...row, mode: row.mode as CollectorMode };
}

/** When a new grant made under `policy` should end. Null means "until revoked or submitted". */
function grantExpiry(policy: Policy): SQL | null {
  const deadline = policy.grantDeadline ? sql`${policy.grantDeadline.toISOString()}::timestamptz` : null;
  if (policy.mode === "temporary" && policy.grantDurationMinutes) {
    const byDuration = sql`now() + make_interval(mins => ${policy.grantDurationMinutes})`;
    return deadline ? sql`least(${byDuration}, ${deadline})` : byDuration;
  }
  return deadline;
}

const sessionColumns = {
  id: collectionSessions.id,
  districtId: collectionSessions.districtId,
  floorId: collectionSessions.floorId,
  defaultCategoryId: collectionSessions.defaultCategoryId,
  startedAt: collectionSessions.startedAt,
  finishedAt: collectionSessions.finishedAt,
};

function toSession(row: {
  id: string;
  districtId: string | null;
  floorId: string | null;
  defaultCategoryId: string | null;
  startedAt: Date;
  finishedAt: Date | null;
}): CollectionSession {
  return {
    ...row,
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
  };
}

async function openSession(db: Queryable, userId: string) {
  const [row] = await db
    .select(sessionColumns)
    .from(collectionSessions)
    .where(and(eq(collectionSessions.collectorId, userId), isNull(collectionSessions.finishedAt)));
  return row ?? null;
}

export async function getCollectionContext(
  db: Database,
  actor: CollectionActor,
): Promise<CollectionContext> {
  const [policy, session] = await Promise.all([
    getPolicy(db, actor.userId),
    openSession(db, actor.userId),
  ]);
  return {
    policy: {
      mode: policy.mode,
      allowOfflineCapture: policy.allowOfflineCapture,
      grantDeadline: policy.grantDeadline?.toISOString() ?? null,
    },
    session: session ? toSession(session) : null,
  };
}

async function checkSessionDefaults(db: Queryable, input: SessionDefaults) {
  const location = await resolveLocation(db, input.districtId ?? null, input.floorId ?? null);
  if (input.defaultCategoryId) await checkCategories(db, [input.defaultCategoryId], "defaultCategoryId");
  return { ...location, defaultCategoryId: input.defaultCategoryId ?? null };
}

/** Starts a session, finishing any session the collector left open. */
export async function startCollectionSession(
  db: Database,
  actor: CollectionActor,
  input: SessionDefaults,
): Promise<CollectionSession> {
  return db.transaction(async (tx) => {
    const defaults = await checkSessionDefaults(tx, input);
    await tx
      .update(collectionSessions)
      .set({ finishedAt: sql`now()` })
      .where(and(eq(collectionSessions.collectorId, actor.userId), isNull(collectionSessions.finishedAt)));
    const [row] = await tx
      .insert(collectionSessions)
      .values({ collectorId: actor.userId, ...defaults })
      .returning(sessionColumns);
    return toSession(row!);
  });
}

/** Changes an open session's defaults. Fields left out keep their value. */
export async function updateCollectionSession(
  db: Database,
  actor: CollectionActor,
  sessionId: string,
  input: SessionDefaults,
): Promise<CollectionSession> {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select(sessionColumns)
      .from(collectionSessions)
      .where(
        and(
          eq(collectionSessions.id, sessionId),
          eq(collectionSessions.collectorId, actor.userId),
          isNull(collectionSessions.finishedAt),
        ),
      )
      .for("update");
    if (!current) throw notFound();

    const floorChanged = input.floorId !== undefined;
    const defaults = await checkSessionDefaults(tx, {
      districtId: input.districtId !== undefined ? input.districtId : current.districtId,
      // Changing district without naming a floor clears the old floor.
      floorId: floorChanged
        ? input.floorId
        : input.districtId !== undefined && input.districtId !== current.districtId
          ? null
          : current.floorId,
      defaultCategoryId:
        input.defaultCategoryId !== undefined ? input.defaultCategoryId : current.defaultCategoryId,
    });
    const [row] = await tx
      .update(collectionSessions)
      .set(defaults)
      .where(eq(collectionSessions.id, sessionId))
      .returning(sessionColumns);
    return toSession(row!);
  });
}

/** Finishes the collector's own session. Finishing twice is not an error. */
export async function finishCollectionSession(
  db: Database,
  actor: CollectionActor,
  sessionId: string,
): Promise<CollectionSession> {
  const [row] = await db
    .update(collectionSessions)
    .set({ finishedAt: sql`coalesce(${collectionSessions.finishedAt}, now())` })
    .where(and(eq(collectionSessions.id, sessionId), eq(collectionSessions.collectorId, actor.userId)))
    .returning(sessionColumns);
  if (!row) throw notFound();
  return toSession(row);
}

// Access ------------------------------------------------------------------------

/** Locks an accessible revision for a change and checks the caller's expected version. */
async function lockForEdit(tx: Tx, actor: CollectionActor, revisionId: string, expectedVersion: number) {
  const [row] = await tx
    .select({ id: shopRevisions.id, version: shopRevisions.version })
    .from(shopRevisions)
    .where(and(eq(shopRevisions.id, revisionId), accessible(actor)))
    .for("update");
  if (!row) throw notFound();
  if (row.version !== expectedVersion) {
    throw new DomainError(
      "conflict",
      "This shop was changed somewhere else. Reload it to see the latest version before saving.",
    );
  }
  return row;
}

async function bumpVersion(tx: Tx, revisionId: string, values: Partial<typeof shopRevisions.$inferInsert> = {}) {
  await tx
    .update(shopRevisions)
    .set({ ...values, version: sql`${shopRevisions.version} + 1`, updatedAt: sql`now()` })
    .where(eq(shopRevisions.id, revisionId));
}

// Reading drafts ----------------------------------------------------------------

const revisionColumns = {
  id: shopRevisions.id,
  shopId: shopRevisions.shopId,
  version: shopRevisions.version,
  state: shopRevisions.state,
  nameZh: shopRevisions.nameZh,
  nameEn: shopRevisions.nameEn,
  companyName: shopRevisions.companyName,
  description: shopRevisions.description,
  districtId: shopRevisions.districtId,
  floorId: shopRevisions.floorId,
  boothNumber: shopRevisions.boothNumber,
  sessionId: shopRevisions.sessionId,
  collectorId: shopRevisions.collectorId,
  createdAt: shopRevisions.createdAt,
  updatedAt: shopRevisions.updatedAt,
};

async function loadDraft(db: Queryable, actor: CollectionActor, revisionId: string): Promise<Draft | null> {
  const [revision] = await db
    .select(revisionColumns)
    .from(shopRevisions)
    .where(and(eq(shopRevisions.id, revisionId), accessible(actor)));
  if (!revision) return null;

  const [categoryRows, keywordRows, contactRows, channelRows, media] = await Promise.all([
    db
      .select({ id: revisionCategories.categoryId, isPrimary: revisionCategories.isPrimary })
      .from(revisionCategories)
      .where(eq(revisionCategories.revisionId, revisionId))
      .orderBy(desc(revisionCategories.isPrimary), asc(revisionCategories.categoryId)),
    db
      .select({ keyword: revisionKeywords.keyword, language: revisionKeywords.language })
      .from(revisionKeywords)
      .where(eq(revisionKeywords.revisionId, revisionId))
      .orderBy(asc(revisionKeywords.keyword)),
    db
      .select({
        id: revisionContacts.contactId,
        displayName: revisionContacts.displayName,
        title: revisionContacts.title,
        isPrimary: revisionContacts.isPrimary,
      })
      .from(revisionContacts)
      .where(eq(revisionContacts.revisionId, revisionId))
      .orderBy(asc(revisionContacts.orderIndex)),
    db
      .select({
        id: contactChannels.id,
        contactId: contactChannels.contactId,
        type: contactChannels.type,
        value: contactChannels.value,
        label: contactChannels.label,
      })
      .from(contactChannels)
      .where(eq(contactChannels.revisionId, revisionId))
      .orderBy(asc(contactChannels.orderIndex), asc(contactChannels.createdAt)),
    loadDraftMedia(db, revisionId),
  ]);

  const channelsFor = (contactId: string | null) =>
    channelRows
      .filter((c) => c.contactId === contactId)
      .map(({ contactId: _, ...c }) => ({ ...c, type: c.type as Draft["sharedChannels"][number]["type"] }));

  return {
    ...revision,
    state: revision.state as RevisionState,
    categories: categoryRows,
    keywords: keywordRows,
    contacts: contactRows.map((c) => ({ ...c, channels: channelsFor(c.id) })),
    sharedChannels: channelsFor(null),
    media,
    createdAt: revision.createdAt.toISOString(),
    updatedAt: revision.updatedAt.toISOString(),
  };
}

export async function getDraft(db: Database, actor: CollectionActor, revisionId: string): Promise<Draft> {
  const draft = await loadDraft(db, actor, revisionId);
  if (!draft) throw notFound();
  return draft;
}

function parseCursor(cursor: string | undefined) {
  if (!cursor) return null;
  const [at, id] = cursor.split("~");
  const date = at ? new Date(at) : null;
  if (!date || Number.isNaN(date.getTime()) || !id || !/^[0-9a-f-]{36}$/i.test(id)) {
    throw invalid("cursor", "This list link has expired. Reload the list.");
  }
  return { date, id };
}

/** The caller's own drafts that they can still open, newest first. */
export async function listDrafts(
  db: Database,
  actor: CollectionActor,
  { limit, cursor }: { limit: number; cursor?: string | undefined },
): Promise<DraftListResponse> {
  const after = parseCursor(cursor);
  const rows = await db
    .select({
      id: shopRevisions.id,
      shopId: shopRevisions.shopId,
      version: shopRevisions.version,
      state: shopRevisions.state,
      nameZh: shopRevisions.nameZh,
      nameEn: shopRevisions.nameEn,
      districtId: shopRevisions.districtId,
      floorId: shopRevisions.floorId,
      boothNumber: shopRevisions.boothNumber,
      updatedAt: shopRevisions.updatedAt,
    })
    .from(shopRevisions)
    .where(
      and(
        eq(shopRevisions.collectorId, actor.userId),
        accessible(actor),
        after
          ? or(
              lt(shopRevisions.updatedAt, after.date),
              and(eq(shopRevisions.updatedAt, after.date), lt(shopRevisions.id, after.id)),
            )
          : undefined,
      ),
    )
    .orderBy(desc(shopRevisions.updatedAt), desc(shopRevisions.id))
    .limit(limit + 1);

  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    drafts: page.map((r) => ({
      ...r,
      state: r.state as RevisionState,
      updatedAt: r.updatedAt.toISOString(),
    })),
    nextCursor: rows.length > limit && last ? `${last.updatedAt.toISOString()}~${last.id}` : null,
  };
}

// Writing drafts ----------------------------------------------------------------

async function insertChannels(
  tx: Tx,
  revisionId: string,
  contactId: string | null,
  channels: readonly ChannelInput[],
) {
  if (channels.length === 0) return;
  await tx.insert(contactChannels).values(
    channels.map((c, i) => ({
      revisionId,
      contactId,
      type: c.type,
      value: c.value,
      label: c.label ?? null,
      orderIndex: i,
    })),
  );
}

async function insertContact(
  tx: Tx,
  actor: CollectionActor,
  revisionId: string,
  contact: ContactInput,
  orderIndex: number,
  isPrimary: boolean,
) {
  const [row] = await tx.insert(contacts).values({ createdBy: actor.userId }).returning({ id: contacts.id });
  await tx.insert(revisionContacts).values({
    revisionId,
    contactId: row!.id,
    displayName: contact.displayName ?? null,
    title: contact.title ?? null,
    isPrimary,
    orderIndex,
  });
  await insertChannels(tx, revisionId, row!.id, contact.channels);
  return row!.id;
}

async function replaceCategories(tx: Tx, revisionId: string, ids: readonly string[]) {
  await tx.delete(revisionCategories).where(eq(revisionCategories.revisionId, revisionId));
  if (ids.length === 0) return;
  await tx
    .insert(revisionCategories)
    .values(ids.map((categoryId, i) => ({ revisionId, categoryId, isPrimary: i === 0 })));
}

async function replaceKeywords(
  tx: Tx,
  revisionId: string,
  keywords: ReadonlyArray<{ keyword: string; language: string }>,
) {
  await tx.delete(revisionKeywords).where(eq(revisionKeywords.revisionId, revisionId));
  const unique = new Map(keywords.map((k) => [k.keyword.toLowerCase(), k]));
  if (unique.size === 0) return;
  await tx.insert(revisionKeywords).values([...unique.values()].map((k) => ({ revisionId, ...k })));
}

async function replaceSharedChannels(tx: Tx, revisionId: string, channels: readonly ChannelInput[]) {
  await tx
    .delete(contactChannels)
    .where(and(eq(contactChannels.revisionId, revisionId), isNull(contactChannels.contactId)));
  await insertChannels(tx, revisionId, null, channels);
}

/** JSON with sorted keys, so equal payloads always hash the same. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

async function payloadHash(value: unknown) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalJson(value)));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export type CreateDraftResult = { draft: Draft; replayed: boolean };

/**
 * Creates a shop, its first revision, contacts and the collector's grant in one
 * transaction (specs/04 "Save and conflict handling"). Retrying with the same
 * idempotency key and payload returns the original draft; the same key with a
 * different payload is a conflict.
 */
export async function createDraft(
  db: Database,
  actor: CollectionActor,
  idempotencyKey: string,
  input: CreateDraftInput,
): Promise<CreateDraftResult> {
  const operation = "drafts.create";
  const hash = await payloadHash(input);

  return db.transaction(async (tx) => {
    // A concurrent request with the same key waits here until this one commits.
    await tx
      .delete(idempotencyKeys)
      .where(
        and(
          eq(idempotencyKeys.actorId, actor.userId),
          eq(idempotencyKeys.operation, operation),
          eq(idempotencyKeys.key, idempotencyKey),
          lt(idempotencyKeys.expiresAt, sql`now()`),
        ),
      );
    const claimed = await tx
      .insert(idempotencyKeys)
      .values({
        actorId: actor.userId,
        operation,
        key: idempotencyKey,
        payloadHash: hash,
        state: "pending",
        expiresAt: IDEMPOTENCY_TTL,
      })
      .onConflictDoNothing()
      .returning({ key: idempotencyKeys.key });

    if (claimed.length === 0) {
      const [existing] = await tx
        .select({ payloadHash: idempotencyKeys.payloadHash, resultReference: idempotencyKeys.resultReference })
        .from(idempotencyKeys)
        .where(
          and(
            eq(idempotencyKeys.actorId, actor.userId),
            eq(idempotencyKeys.operation, operation),
            eq(idempotencyKeys.key, idempotencyKey),
          ),
        );
      if (!existing || existing.payloadHash !== hash || !existing.resultReference) {
        throw new DomainError(
          "conflict",
          "This save was already used for different details. Reload and try again.",
        );
      }
      const draft = await loadDraft(tx, actor, existing.resultReference);
      if (!draft) throw notFound();
      return { draft, replayed: true };
    }

    const policy = await getPolicy(tx, actor.userId);
    const session = await openSession(tx, actor.userId);
    if (input.sessionId && input.sessionId !== session?.id) {
      throw invalid("sessionId", "That collection session has finished. Start a new session.");
    }
    if (policy.mode === "immediate_handoff" && !session) {
      throw invalid("sessionId", "Start a collection session before saving shops.");
    }

    const location = await resolveLocation(tx, input.districtId ?? null, input.floorId ?? null);
    await checkCategories(tx, input.categoryIds ?? [], "categoryIds");

    const [shop] = await tx.insert(shops).values({ createdBy: actor.userId }).returning({ id: shops.id });
    const [revision] = await tx
      .insert(shopRevisions)
      .values({
        shopId: shop!.id,
        nameZh: input.nameZh ?? null,
        nameEn: input.nameEn ?? null,
        companyName: input.companyName ?? null,
        description: input.description ?? null,
        ...location,
        boothNumber: input.boothNumber ?? null,
        collectorId: actor.userId,
        sessionId: session?.id ?? null,
      })
      .returning({ id: shopRevisions.id });
    const revisionId = revision!.id;

    await replaceCategories(tx, revisionId, input.categoryIds ?? []);
    await replaceKeywords(tx, revisionId, input.keywords ?? []);
    await replaceSharedChannels(tx, revisionId, input.sharedChannels ?? []);
    const people = input.contacts ?? [];
    const primaryIndex = Math.max(0, people.findIndex((c) => c.isPrimary));
    for (const [i, contact] of people.entries()) {
      await insertContact(tx, actor, revisionId, contact, i, i === primaryIndex);
    }

    await tx.insert(recordGrants).values({
      userId: actor.userId,
      revisionId,
      source: "collection",
      policyMode: policy.mode,
      expiresAt: grantExpiry(policy),
      createdBy: actor.userId,
    });
    await tx.insert(auditEvents).values({
      actorId: actor.userId,
      action: "shop_revision.draft_created",
      targetType: "shop_revision",
      targetId: revisionId,
      outcome: "success",
      requestId: actor.requestId ?? null,
      summary: { shopId: shop!.id, contacts: people.length, policyMode: policy.mode },
    });
    await tx
      .update(idempotencyKeys)
      .set({ state: "completed", resultReference: revisionId })
      .where(
        and(
          eq(idempotencyKeys.actorId, actor.userId),
          eq(idempotencyKeys.operation, operation),
          eq(idempotencyKeys.key, idempotencyKey),
        ),
      );

    const draft = await loadDraft(tx, actor, revisionId);
    if (!draft) throw notFound();
    return { draft, replayed: false };
  });
}

/** Saves allowlisted fields. Lists given replace the whole list. */
export async function updateDraft(
  db: Database,
  actor: CollectionActor,
  revisionId: string,
  input: UpdateDraftInput,
): Promise<Draft> {
  return db.transaction(async (tx) => {
    await lockForEdit(tx, actor, revisionId, input.expectedVersion);
    const [current] = await tx
      .select({ districtId: shopRevisions.districtId, floorId: shopRevisions.floorId })
      .from(shopRevisions)
      .where(eq(shopRevisions.id, revisionId));

    const values: Partial<typeof shopRevisions.$inferInsert> = {};
    for (const field of ["nameZh", "nameEn", "companyName", "description", "boothNumber"] as const) {
      if (input[field] !== undefined) values[field] = input[field];
    }
    if (input.districtId !== undefined || input.floorId !== undefined) {
      const districtChanged = input.districtId !== undefined && input.districtId !== current!.districtId;
      Object.assign(
        values,
        await resolveLocation(
          tx,
          input.districtId !== undefined ? input.districtId : current!.districtId,
          // Moving to another district without naming a floor clears the old floor.
          input.floorId !== undefined ? input.floorId : districtChanged ? null : current!.floorId,
        ),
      );
    }
    if (input.categoryIds) {
      await checkCategories(tx, input.categoryIds, "categoryIds");
      await replaceCategories(tx, revisionId, input.categoryIds);
    }
    if (input.keywords) await replaceKeywords(tx, revisionId, input.keywords);
    if (input.sharedChannels) await replaceSharedChannels(tx, revisionId, input.sharedChannels);

    await bumpVersion(tx, revisionId, values);
    return (await loadDraft(tx, actor, revisionId))!;
  });
}

export async function addDraftContact(
  db: Database,
  actor: CollectionActor,
  revisionId: string,
  input: AddContactInput,
): Promise<Draft> {
  return db.transaction(async (tx) => {
    await lockForEdit(tx, actor, revisionId, input.expectedVersion);
    const existing = await tx
      .select({ isPrimary: revisionContacts.isPrimary, orderIndex: revisionContacts.orderIndex })
      .from(revisionContacts)
      .where(eq(revisionContacts.revisionId, revisionId));
    if (existing.length >= 20) throw invalid("contacts", "A shop can have at most 20 contacts.");

    const makePrimary = Boolean(input.isPrimary) || !existing.some((c) => c.isPrimary);
    if (makePrimary) {
      await tx
        .update(revisionContacts)
        .set({ isPrimary: false })
        .where(eq(revisionContacts.revisionId, revisionId));
    }
    const nextIndex = Math.max(-1, ...existing.map((c) => c.orderIndex)) + 1;
    await insertContact(tx, actor, revisionId, input, nextIndex, makePrimary);
    await bumpVersion(tx, revisionId);
    return (await loadDraft(tx, actor, revisionId))!;
  });
}

export async function updateDraftContact(
  db: Database,
  actor: CollectionActor,
  revisionId: string,
  contactId: string,
  input: UpdateContactInput,
): Promise<Draft> {
  return db.transaction(async (tx) => {
    await lockForEdit(tx, actor, revisionId, input.expectedVersion);
    const onRevision = and(
      eq(revisionContacts.revisionId, revisionId),
      eq(revisionContacts.contactId, contactId),
    );
    const [contact] = await tx.select({ id: revisionContacts.contactId }).from(revisionContacts).where(onRevision);
    if (!contact) throw notFound();

    if (input.isPrimary) {
      await tx
        .update(revisionContacts)
        .set({ isPrimary: false })
        .where(eq(revisionContacts.revisionId, revisionId));
    }
    const values: Partial<typeof revisionContacts.$inferInsert> = {};
    if (input.displayName !== undefined) values.displayName = input.displayName;
    if (input.title !== undefined) values.title = input.title;
    if (input.isPrimary) values.isPrimary = true;
    if (Object.keys(values).length > 0) {
      await tx.update(revisionContacts).set(values).where(onRevision);
    }
    if (input.channels) {
      await tx
        .delete(contactChannels)
        .where(and(eq(contactChannels.revisionId, revisionId), eq(contactChannels.contactId, contactId)));
      await insertChannels(tx, revisionId, contactId, input.channels);
    }
    await bumpVersion(tx, revisionId);
    return (await loadDraft(tx, actor, revisionId))!;
  });
}
