import { and, asc, count, eq, inArray, lt, ne, notInArray, sql } from "drizzle-orm";
import {
  DomainError,
  MAX_MEDIA_PER_DRAFT,
  mediaKindOf,
  purposeVisibility,
  type DraftMedia,
  type MediaPurpose,
  type UpdateMediaInput,
  type UploadIntentInput,
} from "@ezysource/domain";
import type { Database } from "./client";
import { accessible, notFound, type CollectionActor, type Queryable, type Tx } from "./access";
import { auditEvents, mediaAssets, mediaLinks, revisionContacts, shopRevisions } from "./schema";

/**
 * Shop media (specs/04 "Upload protocol"). The phone proposes a media ID and asks for
 * an upload; the server checks access, fixes the target shop and records a staged asset.
 * The API then stores the bytes and calls `finishUpload`, which re-checks access before
 * the file counts as attached. SQL only ever holds metadata; bytes live in R2.
 */

const LIVE_STATES = ["staged", "uploaded", "validated"];

const mediaColumns = {
  id: mediaAssets.id,
  purpose: mediaLinks.purpose,
  contactId: mediaLinks.contactId,
  caption: mediaLinks.caption,
  visibility: mediaLinks.visibility,
  orderIndex: mediaLinks.orderIndex,
  kind: mediaAssets.kind,
  mimeType: mediaAssets.mimeType,
  sizeBytes: mediaAssets.sizeBytes,
  width: mediaAssets.width,
  height: mediaAssets.height,
  durationMs: mediaAssets.durationMs,
  state: mediaAssets.state,
  createdAt: mediaLinks.createdAt,
};

type MediaRow = Omit<DraftMedia, "purpose" | "visibility" | "kind" | "state" | "createdAt"> & {
  purpose: string;
  visibility: string;
  kind: string;
  state: string;
  createdAt: Date;
};

function toDraftMedia(row: MediaRow): DraftMedia {
  return {
    ...row,
    purpose: row.purpose as MediaPurpose,
    visibility: row.visibility as DraftMedia["visibility"],
    kind: row.kind as DraftMedia["kind"],
    state: row.state as DraftMedia["state"],
    createdAt: row.createdAt.toISOString(),
  };
}

/** Files on a draft, including ones still uploading. Rejected and removed files are left out. */
export async function loadDraftMedia(db: Queryable, revisionId: string): Promise<DraftMedia[]> {
  const rows = await db
    .select(mediaColumns)
    .from(mediaLinks)
    .innerJoin(mediaAssets, eq(mediaAssets.id, mediaLinks.mediaId))
    .where(and(eq(mediaLinks.revisionId, revisionId), inArray(mediaAssets.state, LIVE_STATES)))
    .orderBy(asc(mediaLinks.purpose), asc(mediaLinks.orderIndex), asc(mediaLinks.createdAt));
  return rows.map(toDraftMedia);
}

async function loadMedia(db: Queryable, revisionId: string, mediaId: string) {
  const [row] = await db
    .select(mediaColumns)
    .from(mediaLinks)
    .innerJoin(mediaAssets, eq(mediaAssets.id, mediaLinks.mediaId))
    .where(and(eq(mediaLinks.revisionId, revisionId), eq(mediaLinks.mediaId, mediaId)));
  return row ? toDraftMedia(row) : null;
}

/** Locks a revision the actor can currently work on. Media changes don't bump its version. */
async function lockRevision(tx: Tx, actor: CollectionActor, revisionId: string) {
  const [row] = await tx
    .select({ id: shopRevisions.id })
    .from(shopRevisions)
    .where(and(eq(shopRevisions.id, revisionId), accessible(actor)))
    .for("update");
  if (!row) throw notFound();
}

const invalid = (field: string, message: string) =>
  new DomainError("validation_failed", message, { [field]: [message] });

export type UploadIntentResult = { media: DraftMedia; replayed: boolean };

/**
 * Records a staged file for a draft. Asking again with the same ID and details returns
 * the same file, so a phone can retry after losing its connection.
 */
export async function createUploadIntent(
  db: Database,
  actor: CollectionActor,
  input: UploadIntentInput,
): Promise<UploadIntentResult> {
  const kind = mediaKindOf(input.mimeType);
  if (!kind) throw invalid("mimeType", "That type of file isn't supported.");

  return db.transaction(async (tx) => {
    await lockRevision(tx, actor, input.revisionId);

    const replay = async () => {
      const [existing] = await tx
        .select({
          uploaderId: mediaAssets.uploaderId,
          mimeType: mediaAssets.mimeType,
          sizeBytes: mediaAssets.sizeBytes,
          checksum: mediaAssets.checksum,
          revisionId: mediaLinks.revisionId,
          purpose: mediaLinks.purpose,
          contactId: mediaLinks.contactId,
        })
        .from(mediaAssets)
        .leftJoin(mediaLinks, eq(mediaLinks.mediaId, mediaAssets.id))
        .where(eq(mediaAssets.id, input.id));
      if (!existing) return null;
      const same =
        existing.uploaderId === actor.userId &&
        existing.revisionId === input.revisionId &&
        existing.purpose === input.purpose &&
        existing.contactId === (input.contactId ?? null) &&
        existing.mimeType === input.mimeType &&
        existing.sizeBytes === input.sizeBytes &&
        existing.checksum === input.sha256;
      if (!same) {
        throw new DomainError("conflict", "This upload was already used for a different file. Add the file again.");
      }
      const media = await loadMedia(tx, input.revisionId, input.id);
      if (!media) throw notFound();
      return { media, replayed: true };
    };

    const earlier = await replay();
    if (earlier) return earlier;

    if (input.contactId) {
      const [contact] = await tx
        .select({ id: revisionContacts.contactId })
        .from(revisionContacts)
        .where(and(eq(revisionContacts.revisionId, input.revisionId), eq(revisionContacts.contactId, input.contactId)));
      if (!contact) throw invalid("contactId", "That contact isn't on this shop.");
    }

    const [{ total }] = (await tx
      .select({ total: count() })
      .from(mediaLinks)
      .innerJoin(mediaAssets, eq(mediaAssets.id, mediaLinks.mediaId))
      .where(and(eq(mediaLinks.revisionId, input.revisionId), inArray(mediaAssets.state, LIVE_STATES)))) as [
      { total: number },
    ];
    if (total >= MAX_MEDIA_PER_DRAFT) {
      throw new DomainError(
        "validation_failed",
        `A shop can hold up to ${MAX_MEDIA_PER_DRAFT} files. Remove some before adding more.`,
      );
    }

    const inserted = await tx
      .insert(mediaAssets)
      .values({
        id: input.id,
        // Stable and independent of any URL (specs/11). Never served directly.
        objectKey: `media/${input.id}`,
        kind,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        checksum: input.sha256,
        state: "staged",
        width: input.width ?? null,
        height: input.height ?? null,
        durationMs: input.durationMs ?? null,
        uploaderId: actor.userId,
      })
      .onConflictDoNothing()
      .returning({ id: mediaAssets.id });
    if (inserted.length === 0) {
      // Another request with the same ID won the race.
      const raced = await replay();
      if (raced) return raced;
      throw notFound();
    }

    const [{ next }] = (await tx
      .select({ next: sql<number>`coalesce(max(${mediaLinks.orderIndex}) + 1, 0)::int` })
      .from(mediaLinks)
      .where(and(eq(mediaLinks.revisionId, input.revisionId), eq(mediaLinks.purpose, input.purpose)))) as [
      { next: number },
    ];
    await tx.insert(mediaLinks).values({
      revisionId: input.revisionId,
      mediaId: input.id,
      purpose: input.purpose,
      contactId: input.contactId ?? null,
      caption: input.caption ?? null,
      visibility: purposeVisibility[input.purpose],
      orderIndex: next,
      createdBy: actor.userId,
    });

    const media = await loadMedia(tx, input.revisionId, input.id);
    if (!media) throw notFound();
    return { media, replayed: false };
  });
}

export type UploadTarget = {
  revisionId: string;
  objectKey: string;
  mimeType: string;
  sizeBytes: number;
  checksum: string;
  state: string;
};

/**
 * The staged file the actor may send bytes for: theirs, on a draft they can still
 * work on. Anything else is not found.
 */
export async function getUploadTarget(
  db: Queryable,
  actor: CollectionActor,
  mediaId: string,
): Promise<UploadTarget | null> {
  const [row] = await db
    .select({
      revisionId: mediaLinks.revisionId,
      objectKey: mediaAssets.objectKey,
      mimeType: mediaAssets.mimeType,
      sizeBytes: mediaAssets.sizeBytes,
      checksum: mediaAssets.checksum,
      state: mediaAssets.state,
    })
    .from(mediaAssets)
    .innerJoin(mediaLinks, eq(mediaLinks.mediaId, mediaAssets.id))
    .innerJoin(shopRevisions, eq(shopRevisions.id, mediaLinks.revisionId))
    .where(and(eq(mediaAssets.id, mediaId), eq(mediaAssets.uploaderId, actor.userId), accessible(actor)))
    .limit(1);
  return row && row.checksum ? { ...row, checksum: row.checksum } : null;
}

/**
 * Records the result of checking stored bytes. Access is checked again here, so a
 * collector whose access ended mid-upload can't attach the file (specs/12).
 */
export async function finishUpload(
  db: Database,
  actor: CollectionActor,
  mediaId: string,
  outcome: "validated" | "rejected",
): Promise<DraftMedia> {
  return db.transaction(async (tx) => {
    const target = await getUploadTarget(tx, actor, mediaId);
    if (!target) throw notFound();
    await tx
      .update(mediaAssets)
      .set({ state: outcome, updatedAt: sql`now()` })
      .where(and(eq(mediaAssets.id, mediaId), inArray(mediaAssets.state, ["staged", "uploaded"])));
    if (outcome === "validated") {
      await tx.insert(auditEvents).values({
        actorId: actor.userId,
        action: "shop_media.uploaded",
        targetType: "media_asset",
        targetId: mediaId,
        outcome: "success",
        requestId: actor.requestId ?? null,
        summary: { revisionId: target.revisionId, mimeType: target.mimeType, sizeBytes: target.sizeBytes },
      });
    }
    const media = await loadMedia(tx, target.revisionId, mediaId);
    if (!media) throw notFound();
    return media;
  });
}

/** Changes a caption or moves a file within its section. Position 0 of shop photos is the cover. */
export async function updateDraftMedia(
  db: Database,
  actor: CollectionActor,
  revisionId: string,
  mediaId: string,
  input: UpdateMediaInput,
): Promise<DraftMedia> {
  return db.transaction(async (tx) => {
    await lockRevision(tx, actor, revisionId);
    const current = await loadMedia(tx, revisionId, mediaId);
    if (!current || !LIVE_STATES.includes(current.state)) throw notFound();

    if (input.caption !== undefined) {
      await tx
        .update(mediaLinks)
        .set({ caption: input.caption })
        .where(and(eq(mediaLinks.revisionId, revisionId), eq(mediaLinks.mediaId, mediaId)));
    }
    if (input.orderIndex !== undefined) {
      const group = await tx
        .select({ mediaId: mediaLinks.mediaId })
        .from(mediaLinks)
        .innerJoin(mediaAssets, eq(mediaAssets.id, mediaLinks.mediaId))
        .where(
          and(
            eq(mediaLinks.revisionId, revisionId),
            eq(mediaLinks.purpose, current.purpose),
            inArray(mediaAssets.state, LIVE_STATES),
            ne(mediaLinks.mediaId, mediaId),
          ),
        )
        .orderBy(asc(mediaLinks.orderIndex), asc(mediaLinks.createdAt));
      const ids = group.map((g) => g.mediaId);
      ids.splice(Math.min(input.orderIndex, ids.length), 0, mediaId);
      for (const [i, id] of ids.entries()) {
        await tx
          .update(mediaLinks)
          .set({ orderIndex: i })
          .where(and(eq(mediaLinks.revisionId, revisionId), eq(mediaLinks.mediaId, id)));
      }
    }

    const media = await loadMedia(tx, revisionId, mediaId);
    if (!media) throw notFound();
    return media;
  });
}

/**
 * Takes a file off a draft. Returns the storage key to delete when no other revision
 * uses the file. The metadata row stays, marked removed, for the audit trail.
 */
export async function removeDraftMedia(
  db: Database,
  actor: CollectionActor,
  revisionId: string,
  mediaId: string,
): Promise<{ objectKey: string | null }> {
  return db.transaction(async (tx) => {
    await lockRevision(tx, actor, revisionId);
    const removed = await tx
      .delete(mediaLinks)
      .where(and(eq(mediaLinks.revisionId, revisionId), eq(mediaLinks.mediaId, mediaId)))
      .returning({ id: mediaLinks.id });
    if (removed.length === 0) throw notFound();

    const [orphan] = await tx
      .update(mediaAssets)
      .set({ state: "removed", updatedAt: sql`now()` })
      .where(
        and(
          eq(mediaAssets.id, mediaId),
          sql`not exists (select 1 from ${mediaLinks} l where l.media_id = ${mediaAssets.id})`,
        ),
      )
      .returning({ objectKey: mediaAssets.objectKey });
    await tx.insert(auditEvents).values({
      actorId: actor.userId,
      action: "shop_media.removed",
      targetType: "media_asset",
      targetId: mediaId,
      outcome: "success",
      requestId: actor.requestId ?? null,
      summary: { revisionId },
    });
    return { objectKey: orphan?.objectKey ?? null };
  });
}

export type ReadableMedia = {
  id: string;
  objectKey: string;
  mimeType: string;
  sizeBytes: number;
  state: string;
};

/**
 * A file a collector may open: attached to a draft they can still work on. Checked on
 * every request, including each range request, so ending access stops playback and
 * downloads that haven't happened yet (specs/12 "Collector revocation and media").
 */
export async function getMediaForCollector(
  db: Database,
  actor: CollectionActor,
  mediaId: string,
): Promise<ReadableMedia | null> {
  const [row] = await db
    .select({
      id: mediaAssets.id,
      objectKey: mediaAssets.objectKey,
      mimeType: mediaAssets.mimeType,
      sizeBytes: mediaAssets.sizeBytes,
      state: mediaAssets.state,
    })
    .from(mediaAssets)
    .innerJoin(mediaLinks, eq(mediaLinks.mediaId, mediaAssets.id))
    .innerJoin(shopRevisions, eq(shopRevisions.id, mediaLinks.revisionId))
    .where(and(eq(mediaAssets.id, mediaId), accessible(actor)))
    .limit(1);
  return row ?? null;
}

/**
 * Marks uploads that never finished as rejected and returns their storage keys, so
 * the caller can delete any bytes that did arrive. Validated files are never touched
 * here, however old (specs/04 step 7).
 */
export async function sweepStaleUploads(
  db: Database,
  { olderThanHours = 24, limit = 200 }: { olderThanHours?: number; limit?: number } = {},
): Promise<string[]> {
  const stale = db
    .select({ id: mediaAssets.id })
    .from(mediaAssets)
    .where(
      and(
        notInArray(mediaAssets.state, ["validated", "rejected", "removed"]),
        lt(mediaAssets.createdAt, sql`now() - make_interval(hours => ${olderThanHours})`),
      ),
    )
    .limit(limit);
  const rows = await db
    .update(mediaAssets)
    .set({ state: "rejected", updatedAt: sql`now()` })
    .where(inArray(mediaAssets.id, stale))
    .returning({ objectKey: mediaAssets.objectKey });
  return rows.map((r) => r.objectKey);
}
