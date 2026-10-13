import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  apiErrorSchema,
  collectionContextSchema,
  collectionReferenceSchema,
  draftListResponseSchema,
  draftResponseSchema,
  sessionResponseSchema,
  type StaffRole,
} from "@ezysource/domain";
import { eq } from "drizzle-orm";
import { getActiveStaffRoles, resolveUserForIdentity, schema } from "@ezysource/db";
import { adminUrl, createTestDatabase, type TestDatabase } from "@ezysource/db/testing";
import { createApp } from "../src/app";
import type { Env } from "../src/env";
import { createCollectionService } from "../src/services";
import { createTokenIssuer } from "./fakes";

/**
 * The collection API end to end: real tokens, real routes, and a real PostgreSQL
 * database connected with the runtime role.
 */
describe.skipIf(!adminUrl)("collection API", () => {
  const env: Env = { APP_ENV: "local", APP_VERSION: "test" };
  let t: TestDatabase;
  let issuer: Awaited<ReturnType<typeof createTokenIssuer>>;
  let app: ReturnType<typeof createApp>;
  let n = 0;

  beforeAll(async () => {
    t = await createTestDatabase(adminUrl!);
    issuer = await createTokenIssuer();
    const db = t.runtime.db;
    app = createApp({
      services: () => ({
        verifier: issuer.verifier,
        users: {
          resolve: (identity) => resolveUserForIdentity(db, identity),
          staffRoles: (userId) => getActiveStaffRoles(db, userId),
          listStaff: async () => [],
        },
        media: null,
        store: null,
        collection: createCollectionService(db),
        close: async () => {},
      }),
    });
  }, 60_000);

  afterAll(async () => {
    await t?.drop();
  });

  /** A signed-in person holding `roles`, with a request helper. */
  async function person(roles: StaffRole[], aal: "aal1" | "aal2" = "aal1") {
    const subject = `person-${n++}`;
    const user = await resolveUserForIdentity(t.runtime.db, { provider: "supabase", subject });
    if (roles.length > 0) {
      await t.migration.db.insert(schema.staffRoles).values(roles.map((role) => ({ userId: user.id, role })));
    }
    const token = await issuer.sign(subject, aal);
    const request = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
      app.request(
        `/api${path}`,
        {
          method,
          headers: {
            authorization: `Bearer ${token}`,
            ...(body === undefined ? {} : { "content-type": "application/json" }),
            ...headers,
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        },
        env,
      );
    return Object.assign(request, { userId: user.id });
  }

  const errorOf = async (res: Response) => apiErrorSchema.parse(await res.json()).error;
  const create = (as: Awaited<ReturnType<typeof person>>, body: unknown, key = `key-${n++}-abcdefgh`) =>
    as("POST", "/drafts", body, { "idempotency-key": key });

  it("is for collectors and MFA-verified admins only", async () => {
    expect((await app.request("/api/collection/reference", {}, env)).status).toBe(401);

    const member = await person([]);
    expect((await member("GET", "/collection/reference")).status).toBe(403);
    expect((await member("GET", "/drafts")).status).toBe(403);
    expect((await member("POST", "/drafts", { nameEn: "x" })).status).toBe(403);

    const mapper = await person(["mapper"]);
    expect((await mapper("GET", "/drafts")).status).toBe(403);

    const adminNoMfa = await person(["admin"]);
    expect((await errorOf(await adminNoMfa("GET", "/drafts"))).code).toBe("mfa_required");

    const collector = await person(["collector"]);
    const ref = collectionReferenceSchema.parse(await (await collector("GET", "/collection/reference")).json());
    expect(ref.markets[0]!.districts).toHaveLength(6);
  });

  it("runs a session and saves, edits and lists drafts", async () => {
    const collector = await person(["collector"]);
    const ref = collectionReferenceSchema.parse(await (await collector("GET", "/collection/reference")).json());
    const floor = ref.markets[0]!.districts[0]!.floors[0]!;

    const started = await collector("POST", "/collection/sessions", { floorId: floor.id });
    expect(started.status).toBe(201);
    const { session } = sessionResponseSchema.parse(await started.json());
    const context = collectionContextSchema.parse(await (await collector("GET", "/collection/context")).json());
    expect(context).toMatchObject({ policy: { mode: "review_then_submit" }, session: { id: session.id } });

    const key = "save-1-abcdefgh";
    const body = {
      nameEn: "Lucky Toys",
      districtId: session.districtId,
      floorId: session.floorId,
      boothNumber: "10234",
      contacts: [{ displayName: "Ms Chen", channels: [{ type: "wechat", value: "chen88" }] }],
    };
    const createdRes = await create(collector, body, key);
    expect(createdRes.status).toBe(201);
    expect(createdRes.headers.get("cache-control")).toContain("no-store");
    const { draft } = draftResponseSchema.parse(await createdRes.json());
    expect(draft).toMatchObject({ version: 1, sessionId: session.id, contacts: [{ isPrimary: true }] });

    const retried = await create(collector, body, key);
    expect(retried.status).toBe(200);
    expect(draftResponseSchema.parse(await retried.json()).draft.id).toBe(draft.id);
    expect((await create(collector, { ...body, nameEn: "Other" }, key)).status).toBe(409);

    const edited = await collector("PATCH", `/drafts/${draft.id}`, { expectedVersion: 1, nameZh: "幸运玩具" });
    expect(edited.status).toBe(200);
    expect(draftResponseSchema.parse(await edited.json()).draft).toMatchObject({ version: 2, nameZh: "幸运玩具" });

    const stale = await collector("PATCH", `/drafts/${draft.id}`, { expectedVersion: 1, nameZh: "旧" });
    expect(stale.status).toBe(409);

    const added = await collector("POST", `/drafts/${draft.id}/contacts`, {
      expectedVersion: 2,
      displayName: "Mr Zhou",
      channels: [{ type: "phone", value: "13900000000" }],
    });
    expect(added.status).toBe(201);
    const withTwo = draftResponseSchema.parse(await added.json()).draft;
    expect(withTwo.contacts).toHaveLength(2);

    const promoted = await collector("PATCH", `/drafts/${draft.id}/contacts/${withTwo.contacts[1]!.id}`, {
      expectedVersion: 3,
      isPrimary: true,
    });
    expect(draftResponseSchema.parse(await promoted.json()).draft.contacts.map((c) => c.isPrimary)).toEqual([
      false,
      true,
    ]);

    const list = draftListResponseSchema.parse(await (await collector("GET", "/drafts?limit=10")).json());
    expect(list.drafts.map((d) => d.id)).toEqual([draft.id]);

    const finished = await collector("POST", `/collection/sessions/${session.id}/finish`);
    expect(sessionResponseSchema.parse(await finished.json()).session.finishedAt).not.toBeNull();
    // Review-then-submit drafts stay open after the session ends.
    expect((await collector("GET", `/drafts/${draft.id}`)).status).toBe(200);
  });

  it("validates input with field errors", async () => {
    const collector = await person(["collector"]);
    expect((await errorOf(await collector("POST", "/drafts", { nameEn: "x" }))).code).toBe("validation_failed");

    const empty = await errorOf(await create(collector, { nameEn: "  " }));
    expect(empty.code).toBe("validation_failed");
    expect(empty.message).toMatch(/name, booth number or contact/);

    const badEmail = await errorOf(
      await create(collector, { nameEn: "x", sharedChannels: [{ type: "email", value: "nope" }] }),
    );
    expect(badEmail.fieldErrors?.["sharedChannels.0.value"]).toEqual(["Enter a valid email address."]);

    const badJson = await collector("POST", "/collection/sessions", undefined, { "content-type": "application/json" });
    expect(badJson.status).toBe(422);
    expect((await collector("GET", "/drafts?limit=500")).status).toBe(422);
  });

  it("never shows one collector's drafts to another", async () => {
    const owner = await person(["collector"]);
    const { draft } = draftResponseSchema.parse(await (await create(owner, { nameEn: "Private" })).json());

    const other = await person(["collector"]);
    expect((await other("GET", `/drafts/${draft.id}`)).status).toBe(404);
    expect((await other("PATCH", `/drafts/${draft.id}`, { expectedVersion: 1, nameEn: "x" })).status).toBe(404);
    expect((await other("POST", `/drafts/${draft.id}/contacts`, { expectedVersion: 1 })).status).toBe(404);
    expect((await other("GET", "/drafts/not-a-uuid")).status).toBe(404);

    const admin = await person(["admin"], "aal2");
    expect((await admin("GET", `/drafts/${draft.id}`)).status).toBe(200);
  });

  it("cuts off a collector immediately when their role is revoked", async () => {
    const collector = await person(["collector"]);
    const { draft } = draftResponseSchema.parse(await (await create(collector, { nameEn: "Mine" })).json());
    await t.migration.db
      .update(schema.staffRoles)
      .set({ revokedAt: new Date() })
      .where(eq(schema.staffRoles.userId, collector.userId));
    expect((await collector("GET", `/drafts/${draft.id}`)).status).toBe(403);
  });
});
