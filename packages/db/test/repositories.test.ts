import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  getActiveStaffRoles,
  getMediaAsset,
  listActiveStaff,
  resolveUserForIdentity,
} from "../src/repositories";
import { mediaAssets, staffRoles } from "../src/schema";
import { adminUrl, createTestDatabase, type TestDatabase } from "./harness";

/** Repositories run with the API's runtime credentials, as they will in production. */
describe.skipIf(!adminUrl)("repositories (runtime role)", () => {
  let t: TestDatabase;

  beforeAll(async () => {
    t = await createTestDatabase(adminUrl!);
  }, 60_000);

  afterAll(async () => {
    await t?.drop();
  });

  it("creates a user with no roles on first sign-in and reuses it after", async () => {
    const identity = { provider: "supabase", subject: "first-sign-in" };
    const first = await resolveUserForIdentity(t.runtime.db, identity);
    expect(first.state).toBe("active");
    expect(await getActiveStaffRoles(t.runtime.db, first.id)).toEqual([]);
    expect((await resolveUserForIdentity(t.runtime.db, identity)).id).toBe(first.id);
  });

  it("creates exactly one user when first sign-ins race", async () => {
    const identity = { provider: "supabase", subject: "racing" };
    const raced = createTestRuntimePool();
    const users = await Promise.all(raced.map((db) => resolveUserForIdentity(db, identity)));
    expect(new Set(users.map((u) => u.id)).size).toBe(1);
    await Promise.all(raced.map((db) => db.$client.end()));
  });

  it("reads only unrevoked staff roles", async () => {
    const user = await resolveUserForIdentity(t.runtime.db, { provider: "supabase", subject: "staff" });
    await t.runtime.db.insert(staffRoles).values([
      { userId: user.id, role: "collector" },
      { userId: user.id, role: "admin" },
    ]);
    expect(await getActiveStaffRoles(t.runtime.db, user.id)).toEqual(["admin", "collector"]);

    await t.runtime.db
      .update(staffRoles)
      .set({ revokedAt: new Date() })
      .where(eq(staffRoles.role, "admin"));
    expect(await getActiveStaffRoles(t.runtime.db, user.id)).toEqual(["collector"]);

    const staff = await listActiveStaff(t.runtime.db);
    expect(staff.find((s) => s.id === user.id)?.roles).toEqual(["collector"]);
  });

  it("reads media metadata", async () => {
    const user = await resolveUserForIdentity(t.runtime.db, { provider: "supabase", subject: "uploader" });
    const [asset] = await t.runtime.db
      .insert(mediaAssets)
      .values({
        objectKey: "test/object",
        kind: "image",
        mimeType: "image/jpeg",
        sizeBytes: 10,
        state: "validated",
        uploaderId: user.id,
      })
      .returning({ id: mediaAssets.id });
    expect(await getMediaAsset(t.runtime.db, asset!.id)).toMatchObject({
      objectKey: "test/object",
      uploaderId: user.id,
    });
    expect(await getMediaAsset(t.runtime.db, "00000000-0000-0000-0000-000000000000")).toBeNull();
  });

  function createTestRuntimePool() {
    return Array.from({ length: 4 }, () => t.newRuntimeDb());
  }
});
