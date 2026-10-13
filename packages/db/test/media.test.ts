import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  createDraftSchema,
  updateMediaSchema,
  uploadIntentSchema,
  type DomainError,
  type StaffRole,
} from "@ezysource/domain";
import { createDraft, getDraft, type CollectionActor } from "../src/collection";
import {
  createUploadIntent,
  finishUpload,
  getMediaForCollector,
  getUploadTarget,
  removeDraftMedia,
  sweepStaleUploads,
  updateDraftMedia,
} from "../src/media";
import { resolveUserForIdentity } from "../src/repositories";
import { mediaAssets, recordGrants } from "../src/schema";
import { adminUrl, createTestDatabase, type TestDatabase } from "./harness";

const SHA = "a".repeat(64);

describe.skipIf(!adminUrl)("shop media (runtime role)", () => {
  let t: TestDatabase;
  let n = 0;

  beforeAll(async () => {
    t = await createTestDatabase(adminUrl!);
  }, 60_000);

  afterAll(async () => {
    await t?.drop();
  });

  async function actor(roles: StaffRole[] = ["collector"]): Promise<CollectionActor> {
    const user = await resolveUserForIdentity(t.runtime.db, { provider: "test", subject: `media-${n++}` });
    return { userId: user.id, roles };
  }

  const code = (promise: Promise<unknown>) =>
    promise.then(
      () => "ok",
      (e: DomainError) => e.code,
    );

  async function draftFor(who: CollectionActor, body: unknown = { nameEn: "Shop" }) {
    return (await createDraft(t.runtime.db, who, `k-${n++}`, createDraftSchema.parse(body))).draft;
  }

  const intent = (revisionId: string, extra: Record<string, unknown> = {}) =>
    uploadIntentSchema.parse({
      id: randomUUID(),
      revisionId,
      purpose: "overview",
      mimeType: "image/jpeg",
      sizeBytes: 1000,
      sha256: SHA,
      ...extra,
    });

  it("stages a file on the draft, then shows it once validated", async () => {
    const me = await actor();
    const draft = await draftFor(me);
    const input = intent(draft.id, { width: 1600, height: 1200 });

    const { media, replayed } = await createUploadIntent(t.runtime.db, me, input);
    expect(replayed).toBe(false);
    expect(media).toMatchObject({ id: input.id, state: "staged", purpose: "overview", visibility: "subscriber" });

    const target = await getUploadTarget(t.runtime.db, me, input.id);
    expect(target).toMatchObject({ objectKey: `media/${input.id}`, sizeBytes: 1000, checksum: SHA });

    const done = await finishUpload(t.runtime.db, me, input.id, "validated");
    expect(done.state).toBe("validated");
    expect((await getDraft(t.runtime.db, me, draft.id)).media.map((m) => m.id)).toEqual([input.id]);
    expect(await getMediaForCollector(t.runtime.db, me, input.id)).toMatchObject({ mimeType: "image/jpeg" });
  });

  it("returns the same file when the phone asks again, and refuses a reused ID", async () => {
    const me = await actor();
    const draft = await draftFor(me);
    const input = intent(draft.id);
    await createUploadIntent(t.runtime.db, me, input);
    const again = await createUploadIntent(t.runtime.db, me, input);
    expect(again.replayed).toBe(true);
    expect(await code(createUploadIntent(t.runtime.db, me, { ...input, sizeBytes: 2000 }))).toBe("conflict");

    const other = await actor();
    const theirs = await draftFor(other);
    expect(await code(createUploadIntent(t.runtime.db, other, { ...input, revisionId: theirs.id }))).toBe(
      "conflict",
    );
  });

  it("keeps each file on the shop it was taken for", async () => {
    const me = await actor();
    const first = await draftFor(me, { nameEn: "First" });
    const second = await draftFor(me, { nameEn: "Second" });
    const photo = intent(first.id);
    await createUploadIntent(t.runtime.db, me, photo);
    await finishUpload(t.runtime.db, me, photo.id, "validated");
    expect((await getDraft(t.runtime.db, me, first.id)).media).toHaveLength(1);
    expect((await getDraft(t.runtime.db, me, second.id)).media).toHaveLength(0);
  });

  it("ties cards and QR codes to a contact on the same shop", async () => {
    const me = await actor();
    const draft = await draftFor(me, {
      nameEn: "Shop",
      contacts: [{ displayName: "Li", channels: [{ type: "wechat", value: "li88" }] }],
    });
    const contactId = draft.contacts[0]!.id;
    const card = intent(draft.id, { purpose: "card_front", contactId });
    expect((await createUploadIntent(t.runtime.db, me, card)).media).toMatchObject({
      contactId,
      visibility: "staff",
    });
    expect(
      await code(createUploadIntent(t.runtime.db, me, intent(draft.id, { purpose: "wechat_qr", contactId: randomUUID() }))),
    ).toBe("validation_failed");
  });

  it("checks the file type, size and section", () => {
    const base = { id: randomUUID(), revisionId: randomUUID(), sha256: SHA, sizeBytes: 10 };
    const bad = (extra: Record<string, unknown>) =>
      uploadIntentSchema.safeParse({ ...base, purpose: "overview", mimeType: "image/jpeg", ...extra }).success;
    expect(bad({ mimeType: "image/svg+xml" })).toBe(false);
    expect(bad({ mimeType: "text/html" })).toBe(false);
    expect(bad({ sizeBytes: 16 * 1024 * 1024 })).toBe(false);
    expect(bad({ mimeType: "application/pdf" })).toBe(false);
    expect(bad({ purpose: "section", mimeType: "application/pdf" })).toBe(true);
    expect(bad({ purpose: "voice", mimeType: "audio/webm;codecs=opus", durationMs: 60_000 })).toBe(true);
    expect(bad({ purpose: "voice", mimeType: "audio/webm", durationMs: 6 * 60_000 })).toBe(false);
    expect(bad({ purpose: "card_front" })).toBe(false);
  });

  it("moves a photo to the front to make it the cover, and edits captions", async () => {
    const me = await actor();
    const draft = await draftFor(me);
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const input = intent(draft.id);
      await createUploadIntent(t.runtime.db, me, input);
      await finishUpload(t.runtime.db, me, input.id, "validated");
      ids.push(input.id);
    }
    await updateDraftMedia(t.runtime.db, me, draft.id, ids[2]!, updateMediaSchema.parse({ orderIndex: 0 }));
    const order = (await getDraft(t.runtime.db, me, draft.id)).media.map((m) => m.id);
    expect(order).toEqual([ids[2], ids[0], ids[1]]);

    const captioned = await updateDraftMedia(
      t.runtime.db,
      me,
      draft.id,
      ids[0]!,
      updateMediaSchema.parse({ caption: "Front window" }),
    );
    expect(captioned.caption).toBe("Front window");
  });

  it("removes a file and frees its storage", async () => {
    const me = await actor();
    const draft = await draftFor(me);
    const input = intent(draft.id);
    await createUploadIntent(t.runtime.db, me, input);
    await finishUpload(t.runtime.db, me, input.id, "validated");

    expect(await removeDraftMedia(t.runtime.db, me, draft.id, input.id)).toEqual({ objectKey: `media/${input.id}` });
    expect((await getDraft(t.runtime.db, me, draft.id)).media).toHaveLength(0);
    expect(await getMediaForCollector(t.runtime.db, me, input.id)).toBeNull();
    expect(await code(removeDraftMedia(t.runtime.db, me, draft.id, input.id))).toBe("not_found");
  });

  it("stops uploads, attaching and viewing once access ends", async () => {
    const me = await actor();
    const draft = await draftFor(me);
    const pending = intent(draft.id);
    const shown = intent(draft.id);
    await createUploadIntent(t.runtime.db, me, pending);
    await createUploadIntent(t.runtime.db, me, shown);
    await finishUpload(t.runtime.db, me, shown.id, "validated");

    await t.runtime.db.update(recordGrants).set({ revokedAt: new Date() }).where(eq(recordGrants.revisionId, draft.id));

    expect(await getUploadTarget(t.runtime.db, me, pending.id)).toBeNull();
    expect(await code(finishUpload(t.runtime.db, me, pending.id, "validated"))).toBe("not_found");
    expect(await getMediaForCollector(t.runtime.db, me, shown.id)).toBeNull();
    expect(await code(createUploadIntent(t.runtime.db, me, intent(draft.id)))).toBe("not_found");
    expect(await code(removeDraftMedia(t.runtime.db, me, draft.id, shown.id))).toBe("not_found");
  });

  it("doesn't let another collector upload to or open someone else's files", async () => {
    const me = await actor();
    const other = await actor();
    const draft = await draftFor(me);
    const input = intent(draft.id);
    await createUploadIntent(t.runtime.db, me, input);
    await finishUpload(t.runtime.db, me, input.id, "validated");

    expect(await code(createUploadIntent(t.runtime.db, other, intent(draft.id)))).toBe("not_found");
    expect(await getUploadTarget(t.runtime.db, other, input.id)).toBeNull();
    expect(await getMediaForCollector(t.runtime.db, other, input.id)).toBeNull();

    const admin = await actor(["admin"]);
    expect(await getMediaForCollector(t.runtime.db, admin, input.id)).not.toBeNull();
  });

  it("sweeps uploads that never finished, never validated ones", async () => {
    const me = await actor();
    const draft = await draftFor(me);
    const stale = intent(draft.id);
    const kept = intent(draft.id);
    await createUploadIntent(t.runtime.db, me, stale);
    await createUploadIntent(t.runtime.db, me, kept);
    await finishUpload(t.runtime.db, me, kept.id, "validated");
    await t.superSql`update app.media_assets set created_at = now() - interval '2 days' where id in (${stale.id}, ${kept.id})`;

    const keys = await sweepStaleUploads(t.runtime.db);
    expect(keys).toContain(`media/${stale.id}`);
    expect(keys).not.toContain(`media/${kept.id}`);
    const [row] = await t.runtime.db
      .select({ state: mediaAssets.state })
      .from(mediaAssets)
      .where(eq(mediaAssets.id, stale.id));
    expect(row!.state).toBe("rejected");
    expect((await getDraft(t.runtime.db, me, draft.id)).media.map((m) => m.id)).toEqual([kept.id]);
  });
});
