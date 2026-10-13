import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { apiErrorSchema, draftResponseSchema, uploadResponseSchema, type StaffRole } from "@ezysource/domain";
import { getActiveStaffRoles, getMediaAsset, resolveUserForIdentity, schema } from "@ezysource/db";
import { adminUrl, createTestDatabase, type TestDatabase } from "@ezysource/db/testing";
import { MemoryObjectStore } from "@ezysource/providers";
import { createApp } from "../src/app";
import type { Env } from "../src/env";
import { createCollectionService } from "../src/services";
import { createTokenIssuer } from "./fakes";

/** Photos, PDFs and voice notes end to end: real routes, real PostgreSQL, in-memory storage. */
describe.skipIf(!adminUrl)("upload API", () => {
  const env: Env = { APP_ENV: "local", APP_VERSION: "test" };
  let t: TestDatabase;
  let issuer: Awaited<ReturnType<typeof createTokenIssuer>>;
  let app: ReturnType<typeof createApp>;
  const store = new MemoryObjectStore();
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
        media: { get: (id) => getMediaAsset(db, id) },
        store,
        collection: createCollectionService(db),
        close: async () => {},
      }),
    });
  }, 60_000);

  afterAll(async () => {
    await t?.drop();
  });

  async function person(roles: StaffRole[], aal: "aal1" | "aal2" = "aal1") {
    const subject = `uploader-${n++}`;
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
            ...(body === undefined || body instanceof Uint8Array ? {} : { "content-type": "application/json" }),
            ...headers,
          },
          ...(body === undefined ? {} : { body: body instanceof Uint8Array ? body : JSON.stringify(body) }),
        },
        env,
      );
    return Object.assign(request, { userId: user.id });
  }
  type Person = Awaited<ReturnType<typeof person>>;

  const errorOf = async (res: Response) => apiErrorSchema.parse(await res.json()).error;
  const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
  const jpeg = (size = 64) => {
    const bytes = new Uint8Array(size).fill(7);
    bytes.set([0xff, 0xd8, 0xff, 0xe0]);
    return bytes;
  };

  async function draft(as: Person) {
    const res = await as("POST", "/drafts", { nameEn: "Shop" }, { "idempotency-key": `key-${n++}-abcdefgh` });
    return draftResponseSchema.parse(await res.json()).draft;
  }

  async function intent(as: Person, revisionId: string, bytes: Uint8Array, extra: Record<string, unknown> = {}) {
    const id = randomUUID();
    const res = await as("POST", "/uploads/intents", {
      id,
      revisionId,
      purpose: "overview",
      mimeType: "image/jpeg",
      sizeBytes: bytes.length,
      sha256: sha(bytes),
      ...extra,
    });
    return { id, res };
  }

  const send = (as: Person, id: string, bytes: Uint8Array, type = "image/jpeg") =>
    as("PUT", `/uploads/${id}/content`, bytes, { "content-type": type, "content-length": String(bytes.length) });

  it("uploads a photo, attaches it to the draft and serves it back", async () => {
    const me = await person(["collector"]);
    const d = await draft(me);
    const bytes = jpeg();
    const { id, res } = await intent(me, d.id, bytes);
    expect(res.status).toBe(201);

    const sent = await send(me, id, bytes);
    expect(sent.status).toBe(200);
    expect(uploadResponseSchema.parse(await sent.json()).media).toMatchObject({ id, state: "validated" });

    const reloaded = draftResponseSchema.parse(await (await me("GET", `/drafts/${d.id}`)).json()).draft;
    expect(reloaded.media.map((m) => m.id)).toEqual([id]);

    const content = await me("GET", `/media/${id}/content`);
    expect(content.status).toBe(200);
    expect(new Uint8Array(await content.arrayBuffer())).toEqual(bytes);
  });

  it("is safe to retry: the same intent and a repeated send give the same file", async () => {
    const me = await person(["collector"]);
    const d = await draft(me);
    const bytes = jpeg();
    const { id } = await intent(me, d.id, bytes);
    const again = await me("POST", "/uploads/intents", {
      id,
      revisionId: d.id,
      purpose: "overview",
      mimeType: "image/jpeg",
      sizeBytes: bytes.length,
      sha256: sha(bytes),
    });
    expect(again.status).toBe(200);
    expect((await send(me, id, bytes)).status).toBe(200);
    expect((await send(me, id, bytes)).status).toBe(200);
  });

  it("rejects bytes that don't match the checksum, size or type", async () => {
    const me = await person(["collector"]);
    const d = await draft(me);
    const bytes = jpeg();
    const { id } = await intent(me, d.id, bytes);

    const damaged = jpeg();
    damaged[10] = 1;
    expect((await errorOf(await send(me, id, damaged))).code).toBe("validation_failed");
    expect((await errorOf(await send(me, id, jpeg(65)))).code).toBe("validation_failed");
    expect((await errorOf(await send(me, id, bytes, "image/png"))).code).toBe("validation_failed");
    // Still staged, so the right bytes can follow.
    expect((await send(me, id, bytes)).status).toBe(200);
  });

  it("refuses a page renamed as a photo and deletes it", async () => {
    const me = await person(["collector"]);
    const d = await draft(me);
    const html = new TextEncoder().encode("<html><script>alert(1)</script></html>");
    const { id } = await intent(me, d.id, html);
    const res = await send(me, id, html);
    expect(res.status).toBe(422);
    expect(store.has(`media/${id}`)).toBe(false);
    expect((await me("GET", `/media/${id}/content`)).status).toBe(404);
    expect((await errorOf(await send(me, id, html))).code).toBe("conflict");
  });

  it("won't accept SVG or HTML uploads at all", async () => {
    const me = await person(["collector"]);
    const d = await draft(me);
    const { res } = await intent(me, d.id, jpeg(), { mimeType: "image/svg+xml" });
    expect((await errorOf(res)).code).toBe("validation_failed");
  });

  it("stops uploads and viewing once the collector's access ends", async () => {
    const me = await person(["collector"]);
    const d = await draft(me);
    const done = jpeg();
    const shown = await intent(me, d.id, done);
    await send(me, shown.id, done);
    const pending = await intent(me, d.id, jpeg());

    await t.runtime.db
      .update(schema.recordGrants)
      .set({ revokedAt: new Date() })
      .where(eq(schema.recordGrants.revisionId, d.id));

    expect((await send(me, pending.id, jpeg())).status).toBe(404);
    expect((await me("GET", `/media/${shown.id}/content`)).status).toBe(404);
    expect((await me("GET", `/media/${shown.id}/content`, undefined, { range: "bytes=0-3" })).status).toBe(404);
    expect((await intent(me, d.id, jpeg())).res.status).toBe(404);
  });

  it("hides another collector's files and drafts", async () => {
    const me = await person(["collector"]);
    const other = await person(["collector"]);
    const d = await draft(me);
    const bytes = jpeg();
    const { id } = await intent(me, d.id, bytes);
    expect((await send(other, id, bytes)).status).toBe(404);
    await send(me, id, bytes);
    expect((await other("GET", `/media/${id}/content`)).status).toBe(404);
    expect((await intent(other, d.id, bytes)).res.status).toBe(404);
  });

  it("makes a cover photo and removes files", async () => {
    const me = await person(["collector"]);
    const d = await draft(me);
    const ids: string[] = [];
    for (let i = 0; i < 2; i++) {
      const bytes = jpeg(64 + i);
      const { id } = await intent(me, d.id, bytes);
      await send(me, id, bytes);
      ids.push(id);
    }
    const cover = await me("PATCH", `/drafts/${d.id}/media/${ids[1]}`, { orderIndex: 0 });
    expect(uploadResponseSchema.parse(await cover.json()).media.orderIndex).toBe(0);

    expect((await me("DELETE", `/drafts/${d.id}/media/${ids[0]}`)).status).toBe(204);
    expect(store.has(`media/${ids[0]}`)).toBe(false);
    const reloaded = draftResponseSchema.parse(await (await me("GET", `/drafts/${d.id}`)).json()).draft;
    expect(reloaded.media.map((m) => m.id)).toEqual([ids[1]]);
  });

  it("still caps ordinary JSON bodies", async () => {
    const me = await person(["collector"]);
    const big = { nameEn: "x".repeat(70 * 1024) };
    expect((await me("POST", "/drafts", big, { "idempotency-key": `key-${n++}-abcdefgh` })).status).toBe(413);
  });
});
