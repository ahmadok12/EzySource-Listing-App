import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  addContactSchema,
  createDraftSchema,
  updateContactSchema,
  updateDraftSchema,
  type CollectionReference,
  type DomainError,
  type StaffRole,
} from "@ezysource/domain";
import {
  addDraftContact,
  createDraft,
  finishCollectionSession,
  getCollectionContext,
  getCollectionReference,
  getDraft,
  listDrafts,
  startCollectionSession,
  updateCollectionSession,
  updateDraft,
  updateDraftContact,
  type CollectionActor,
} from "../src/collection";
import { resolveUserForIdentity } from "../src/repositories";
import { auditEvents, collectorPolicies, recordGrants, shops } from "../src/schema";
import { adminUrl, createTestDatabase, type TestDatabase } from "./harness";

/** Collection rules run with the API's runtime credentials, as in production. */
describe.skipIf(!adminUrl)("collection (runtime role)", () => {
  let t: TestDatabase;
  let ref: CollectionReference;
  let n = 0;

  beforeAll(async () => {
    t = await createTestDatabase(adminUrl!);
    ref = await getCollectionReference(t.runtime.db);
  }, 60_000);

  afterAll(async () => {
    await t?.drop();
  });

  async function actor(roles: StaffRole[] = ["collector"]): Promise<CollectionActor> {
    const user = await resolveUserForIdentity(t.runtime.db, { provider: "test", subject: `user-${n++}` });
    return { userId: user.id, roles };
  }

  const key = () => `key-${n++}`;
  const district = (i: number) => ref.markets[0]!.districts[i]!;
  const save = (who: CollectionActor, body: unknown, idempotencyKey = key()) =>
    createDraft(t.runtime.db, who, idempotencyKey, createDraftSchema.parse(body));
  const code = (promise: Promise<unknown>) =>
    promise.then(
      () => "ok",
      (e: DomainError) => e.code,
    );

  async function setPolicy(who: CollectionActor, values: Partial<typeof collectorPolicies.$inferInsert>) {
    await t.runtime.db
      .insert(collectorPolicies)
      .values({ userId: who.userId, ...values })
      .onConflictDoUpdate({ target: collectorPolicies.userId, set: values });
  }

  it("serves the starter districts, floors and categories", () => {
    expect(ref.markets).toHaveLength(1);
    expect(ref.markets[0]!.districts.map((d) => d.code)).toEqual(["D1", "D2", "D3", "D4", "D5", "D6"]);
    expect(district(0).floors.map((f) => f.label)).toEqual(["F1", "F2", "F3", "F4"]);
    expect(ref.categories.length).toBeGreaterThan(10);
  });

  describe("sessions", () => {
    it("starts, updates and finishes a session; starting again finishes the old one", async () => {
      const me = await actor();
      expect((await getCollectionContext(t.runtime.db, me)).session).toBeNull();

      const first = await startCollectionSession(t.runtime.db, me, { floorId: district(1).floors[2]!.id });
      expect(first.districtId).toBe(district(1).id);

      const moved = await updateCollectionSession(t.runtime.db, me, first.id, { districtId: district(2).id });
      expect(moved).toMatchObject({ districtId: district(2).id, floorId: null });

      const second = await startCollectionSession(t.runtime.db, me, {});
      const context = await getCollectionContext(t.runtime.db, me);
      expect(context.session?.id).toBe(second.id);
      expect(context.policy.mode).toBe("review_then_submit");
      expect(await code(updateCollectionSession(t.runtime.db, me, first.id, {}))).toBe("not_found");

      const finished = await finishCollectionSession(t.runtime.db, me, second.id);
      expect(finished.finishedAt).not.toBeNull();
      expect((await finishCollectionSession(t.runtime.db, me, second.id)).finishedAt).toBe(finished.finishedAt);
    });

    it("rejects a floor from another district and other people's sessions", async () => {
      const me = await actor();
      expect(
        await code(
          startCollectionSession(t.runtime.db, me, {
            districtId: district(0).id,
            floorId: district(1).floors[0]!.id,
          }),
        ),
      ).toBe("validation_failed");

      const session = await startCollectionSession(t.runtime.db, me, {});
      const other = await actor();
      expect(await code(finishCollectionSession(t.runtime.db, other, session.id))).toBe("not_found");
    });
  });

  describe("saving drafts", () => {
    it("creates shop, revision, contacts, grant and audit event together", async () => {
      const me = await actor();
      const session = await startCollectionSession(t.runtime.db, me, {});
      const { draft, replayed } = await save(me, {
        nameZh: "义乌玩具",
        nameEn: "  Yiwu Toys ",
        floorId: district(0).floors[1]!.id,
        boothNumber: "0123",
        categoryIds: [ref.categories[1]!.id, ref.categories[0]!.id],
        keywords: [{ keyword: "plush" }, { keyword: "毛绒", language: "zh" }, { keyword: "Plush" }],
        contacts: [
          { displayName: "Ms Li", channels: [{ type: "phone", value: "+86 138 0000 0000" }] },
          { displayName: "Mr Wang", isPrimary: true, channels: [{ type: "wechat", value: "wang123" }] },
        ],
        sharedChannels: [{ type: "email", value: "shop@example.com", label: "Office" }],
      });

      expect(replayed).toBe(false);
      expect(draft).toMatchObject({
        version: 1,
        state: "draft",
        nameEn: "Yiwu Toys",
        districtId: district(0).id,
        boothNumber: "0123",
        sessionId: session.id,
        collectorId: me.userId,
      });
      expect(draft.categories).toEqual([
        { id: ref.categories[1]!.id, isPrimary: true },
        { id: ref.categories[0]!.id, isPrimary: false },
      ]);
      expect(draft.keywords.map((k) => k.keyword).sort()).toEqual(["Plush", "毛绒"]);
      expect(draft.contacts.map((c) => [c.displayName, c.isPrimary])).toEqual([
        ["Ms Li", false],
        ["Mr Wang", true],
      ]);
      expect(draft.contacts[0]!.channels[0]).toMatchObject({ type: "phone", value: "+86 138 0000 0000" });
      expect(draft.sharedChannels).toMatchObject([{ type: "email", label: "Office" }]);

      const [grant] = await t.runtime.db.select().from(recordGrants).where(eq(recordGrants.revisionId, draft.id));
      expect(grant).toMatchObject({ userId: me.userId, source: "collection", expiresAt: null });
      const events = await t.runtime.db.select().from(auditEvents).where(eq(auditEvents.targetId, draft.id));
      expect(events.map((e) => e.action)).toEqual(["shop_revision.draft_created"]);
      expect(JSON.stringify(events[0]!.summary)).not.toMatch(/Wang|138|wang123/);
    });

    it("returns the same draft when a save is retried, and refuses a reused key", async () => {
      const me = await actor();
      const k = key();
      const first = await save(me, { nameEn: "Retry shop" }, k);
      const retry = await save(me, { nameEn: "Retry shop" }, k);
      expect(retry).toMatchObject({ replayed: true, draft: { id: first.draft.id } });
      expect(await code(save(me, { nameEn: "Different" }, k))).toBe("conflict");

      // The same key from another person is unrelated.
      const other = await actor();
      expect((await save(other, { nameEn: "Retry shop" }, k)).replayed).toBe(false);
    });

    it("creates one shop when the same save arrives twice at once", async () => {
      const me = await actor();
      const k = key();
      const dbs = [t.newRuntimeDb(), t.newRuntimeDb()];
      const before = await t.runtime.db.select({ count: sql<number>`count(*)::int` }).from(shops);
      const results = await Promise.all(
        dbs.map((db) => createDraft(db, me, k, createDraftSchema.parse({ nameEn: "Raced" }))),
      );
      const after = await t.runtime.db.select({ count: sql<number>`count(*)::int` }).from(shops);
      expect(new Set(results.map((r) => r.draft.id)).size).toBe(1);
      expect(after[0]!.count - before[0]!.count).toBe(1);
      await Promise.all(dbs.map((db) => db.$client.end()));
    });

    it("needs something meaningful and valid references", async () => {
      expect(createDraftSchema.safeParse({ nameEn: "   " }).success).toBe(false);
      expect(createDraftSchema.safeParse({ contacts: [{ channels: [] }] }).success).toBe(false);
      expect(createDraftSchema.safeParse({ boothNumber: "12" }).success).toBe(true);
      expect(
        createDraftSchema.safeParse({ sharedChannels: [{ type: "email", value: "not-an-email" }] }).success,
      ).toBe(false);

      const me = await actor();
      const unknown = "00000000-0000-4000-8000-000000000000";
      expect(await code(save(me, { nameEn: "x", categoryIds: [unknown] }))).toBe("validation_failed");
      expect(await code(save(me, { nameEn: "x", districtId: unknown }))).toBe("validation_failed");
      expect(await code(save(me, { nameEn: "x", sessionId: unknown }))).toBe("validation_failed");
    });
  });

  describe("editing drafts", () => {
    it("saves against the expected version and refuses stale saves", async () => {
      const me = await actor();
      const { draft } = await save(me, {
        nameEn: "Before",
        floorId: district(0).floors[0]!.id,
        sharedChannels: [{ type: "website", value: "https://example.com" }],
      });

      const edited = await updateDraft(
        t.runtime.db,
        me,
        draft.id,
        updateDraftSchema.parse({ expectedVersion: 1, nameEn: "After", districtId: district(3).id, sharedChannels: [] }),
      );
      expect(edited).toMatchObject({ version: 2, nameEn: "After", districtId: district(3).id, floorId: null });
      expect(edited.sharedChannels).toEqual([]);

      const stale = updateDraft(t.runtime.db, me, draft.id, updateDraftSchema.parse({ expectedVersion: 1, nameEn: "Lost" }));
      expect(await code(stale)).toBe("conflict");
      expect((await getDraft(t.runtime.db, me, draft.id)).nameEn).toBe("After");

      const cleared = await updateDraft(t.runtime.db, me, draft.id, updateDraftSchema.parse({ expectedVersion: 2, nameEn: "" }));
      expect(cleared.nameEn).toBeNull();
    });

    it("adds contacts and changes the main contact", async () => {
      const me = await actor();
      const { draft } = await save(me, { boothNumber: "A1" });
      const one = await addDraftContact(
        t.runtime.db,
        me,
        draft.id,
        addContactSchema.parse({ expectedVersion: 1, displayName: "First" }),
      );
      expect(one.contacts).toMatchObject([{ displayName: "First", isPrimary: true }]);

      const two = await addDraftContact(
        t.runtime.db,
        me,
        draft.id,
        addContactSchema.parse({ expectedVersion: 2, displayName: "Second", channels: [{ type: "whatsapp", value: "+8613800000000" }] }),
      );
      expect(two.contacts.map((c) => c.isPrimary)).toEqual([true, false]);

      const second = two.contacts[1]!;
      const three = await updateDraftContact(
        t.runtime.db,
        me,
        draft.id,
        second.id,
        updateContactSchema.parse({ expectedVersion: 3, isPrimary: true, title: "Manager", channels: [] }),
      );
      expect(three.contacts.map((c) => [c.displayName, c.isPrimary, c.title, c.channels.length])).toEqual([
        ["First", false, null, 0],
        ["Second", true, "Manager", 0],
      ]);

      const unknown = "00000000-0000-4000-8000-000000000000";
      expect(
        await code(updateDraftContact(t.runtime.db, me, draft.id, unknown, updateContactSchema.parse({ expectedVersion: 4 }))),
      ).toBe("not_found");
    });
  });

  describe("collector access", () => {
    it("hides other collectors' drafts but lets admins in", async () => {
      const me = await actor();
      const { draft } = await save(me, { nameEn: "Mine" });
      const other = await actor();
      expect(await code(getDraft(t.runtime.db, other, draft.id))).toBe("not_found");
      expect(
        await code(updateDraft(t.runtime.db, other, draft.id, updateDraftSchema.parse({ expectedVersion: 1, nameEn: "x" }))),
      ).toBe("not_found");
      expect((await listDrafts(t.runtime.db, other, { limit: 50 })).drafts).toEqual([]);

      const admin = await actor(["admin"]);
      expect((await getDraft(t.runtime.db, admin, draft.id)).nameEn).toBe("Mine");
    });

    it("stops access as soon as a grant is revoked", async () => {
      const me = await actor();
      const { draft } = await save(me, { nameEn: "Revoked" });
      await t.runtime.db.update(recordGrants).set({ revokedAt: new Date() }).where(eq(recordGrants.revisionId, draft.id));
      expect(await code(getDraft(t.runtime.db, me, draft.id))).toBe("not_found");
      expect((await listDrafts(t.runtime.db, me, { limit: 50 })).drafts).toEqual([]);
    });

    it("temporary mode: the grant expires on the server's clock", async () => {
      const me = await actor();
      await setPolicy(me, { mode: "temporary", grantDurationMinutes: 60 });
      const { draft } = await save(me, { nameEn: "Temporary" });
      const [grant] = await t.runtime.db.select().from(recordGrants).where(eq(recordGrants.revisionId, draft.id));
      expect(grant!.expiresAt!.getTime()).toBeGreaterThan(Date.now() + 55 * 60_000);
      expect(grant!.policyMode).toBe("temporary");

      await t.runtime.db
        .update(recordGrants)
        .set({ expiresAt: sql`now() - interval '1 second'` })
        .where(eq(recordGrants.revisionId, draft.id));
      expect(await code(getDraft(t.runtime.db, me, draft.id))).toBe("not_found");
    });

    it("a deadline caps every grant", async () => {
      const me = await actor();
      const deadline = new Date(Date.now() + 10 * 60_000);
      await setPolicy(me, { mode: "temporary", grantDurationMinutes: 600, grantDeadline: deadline });
      const { draft } = await save(me, { nameEn: "Deadline" });
      const [grant] = await t.runtime.db.select().from(recordGrants).where(eq(recordGrants.revisionId, draft.id));
      expect(Math.abs(grant!.expiresAt!.getTime() - deadline.getTime())).toBeLessThan(1000);
    });

    it("immediate handoff: needs a session and ends access when it finishes", async () => {
      const me = await actor();
      await setPolicy(me, { mode: "immediate_handoff" });
      expect(await code(save(me, { nameEn: "No session" }))).toBe("validation_failed");

      const session = await startCollectionSession(t.runtime.db, me, {});
      const { draft } = await save(me, { nameEn: "Handoff" });
      expect((await getDraft(t.runtime.db, me, draft.id)).nameEn).toBe("Handoff");

      await finishCollectionSession(t.runtime.db, me, session.id);
      expect(await code(getDraft(t.runtime.db, me, draft.id))).toBe("not_found");
      expect((await listDrafts(t.runtime.db, me, { limit: 50 })).drafts).toEqual([]);
    });

    it("pages through the collector's own drafts, newest first", async () => {
      const me = await actor();
      for (const name of ["One", "Two", "Three"]) await save(me, { nameEn: name });
      const first = await listDrafts(t.runtime.db, me, { limit: 2 });
      expect(first.drafts.map((d) => d.nameEn)).toEqual(["Three", "Two"]);
      const second = await listDrafts(t.runtime.db, me, { limit: 2, cursor: first.nextCursor! });
      expect(second.drafts.map((d) => d.nameEn)).toEqual(["One"]);
      expect(second.nextCursor).toBeNull();
      expect(await code(listDrafts(t.runtime.db, me, { limit: 2, cursor: "nonsense" }))).toBe("validation_failed");
    });
  });

  describe("database access", () => {
    it("keeps reference data read-only and business records undeletable for the API", async () => {
      await expect(t.runtime.sql`insert into app.categories (slug, name_en) values ('x', 'X')`).rejects.toThrow(
        /permission denied/,
      );
      await expect(t.runtime.sql`update app.districts set name_en = 'x'`).rejects.toThrow(/permission denied/);
      for (const table of ["shops", "shop_revisions", "contacts", "record_grants", "collection_sessions"]) {
        await expect(t.runtime.sql.unsafe(`delete from app.${table}`)).rejects.toThrow(/permission denied/);
      }
    });

    it.each(["anon", "authenticated"])("gives %s nothing on the new tables", async (role) => {
      const [row] = await t.superSql<{ count: number }[]>`
        select count(*)::int as count from information_schema.role_table_grants
        where table_schema = 'app' and grantee = ${role}`;
      expect(row!.count).toBe(0);
    });
  });
});
