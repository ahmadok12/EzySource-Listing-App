import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { apiErrorSchema, meResponseSchema, staffListResponseSchema } from "@ezysource/domain";
import { createApp } from "../src/app";
import type { Env } from "../src/env";
import type { Services } from "../src/services";
import { createTokenIssuer, FakeWorld } from "./fakes";

const env: Env = { APP_ENV: "local", APP_VERSION: "test" };
let issuer: Awaited<ReturnType<typeof createTokenIssuer>>;
let world: FakeWorld;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  issuer = await createTokenIssuer();
});

beforeEach(() => {
  world = new FakeWorld();
  app = createApp({ services: () => world.services(issuer.verifier) });
});

async function get(path: string, token?: string, headers: Record<string, string> = {}) {
  return app.request(
    path,
    { headers: { ...headers, ...(token ? { authorization: `Bearer ${token}` } : {}) } },
    env,
  );
}

async function errorCode(res: Response) {
  return apiErrorSchema.parse(await res.json()).error.code;
}

describe("authentication", () => {
  it("rejects requests without a valid bearer token", async () => {
    expect((await get("/api/me")).status).toBe(401);
    expect((await get("/api/me", "garbage")).status).toBe(401);
    const foreign = await createTokenIssuer();
    expect((await get("/api/me", await foreign.sign("user"))).status).toBe(401);
  });

  it("ignores cookies; only an Authorization header authenticates", async () => {
    const token = await issuer.sign("cookie-user");
    const res = await get("/api/me", undefined, { cookie: `sb-access-token=${token}` });
    expect(res.status).toBe(401);
  });

  it("creates a role-less app user on first sign-in", async () => {
    const res = await get("/api/me", await issuer.sign("new-member"));
    expect(res.status).toBe(200);
    const me = meResponseSchema.parse(await res.json());
    expect(me.staffRoles).toEqual([]);
    expect(me.mfaRequired).toBe(false);
  });

  it("blocks suspended users even with a valid token", async () => {
    world.userFor("suspended").state = "suspended";
    const res = await get("/api/me", await issuer.sign("suspended"));
    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe("forbidden");
  });

  it("reports when an admin still needs MFA", async () => {
    world.roles.set(world.userFor("admin").id, ["admin"]);
    const aal1 = meResponseSchema.parse(await (await get("/api/me", await issuer.sign("admin"))).json());
    expect(aal1.mfaRequired).toBe(true);
    const aal2 = meResponseSchema.parse(
      await (await get("/api/me", await issuer.sign("admin", "aal2"))).json(),
    );
    expect(aal2.mfaRequired).toBe(false);
  });

  it("returns 503, not a fake success, when sign-in isn't configured", async () => {
    const unconfigured = createApp({
      services: () => ({ ...world.services(null), users: null }) satisfies Services,
    });
    const res = await unconfigured.request("/api/me", {}, env);
    expect(res.status).toBe(503);
  });
});

describe("admin routes", () => {
  it("require owner or admin with MFA", async () => {
    const member = await issuer.sign("member", "aal2");
    expect(await errorCode(await get("/api/admin/staff", member))).toBe("forbidden");

    world.roles.set(world.userFor("collector").id, ["collector"]);
    expect(await errorCode(await get("/api/admin/staff", await issuer.sign("collector", "aal2")))).toBe(
      "forbidden",
    );

    world.roles.set(world.userFor("admin").id, ["admin"]);
    const noMfa = await get("/api/admin/staff", await issuer.sign("admin", "aal1"));
    expect(noMfa.status).toBe(403);
    expect(await errorCode(noMfa)).toBe("mfa_required");

    const ok = await get("/api/admin/staff", await issuer.sign("admin", "aal2"));
    expect(ok.status).toBe(200);
    const body = staffListResponseSchema.parse(await ok.json());
    expect(body.staff.map((s) => s.roles)).toContainEqual(["admin"]);
  });

  it("apply role revocation on the very next request with the same token", async () => {
    const owner = world.userFor("owner");
    world.roles.set(owner.id, ["owner"]);
    const token = await issuer.sign("owner", "aal2");
    expect((await get("/api/admin/staff", token)).status).toBe(200);
    world.roles.set(owner.id, []);
    expect((await get("/api/admin/staff", token)).status).toBe(403);
  });
});

describe("private media", () => {
  const bytes = new TextEncoder().encode("0123456789");
  const assetId = "11111111-1111-4111-8111-111111111111";

  beforeEach(() => {
    const uploader = world.userFor("uploader");
    world.store.put("private/a.jpg", bytes);
    world.media.set(assetId, {
      id: assetId,
      objectKey: "private/a.jpg",
      mimeType: "image/jpeg",
      sizeBytes: bytes.length,
      state: "validated",
      uploaderId: uploader.id,
    });
  });

  const path = `/api/media/${assetId}/content`;

  it("serves the uploader's own file with private, sandboxed headers", async () => {
    const res = await get(path, await issuer.sign("uploader"));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("0123456789");
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("content-security-policy")).toContain("sandbox");
  });

  it("requires sign-in", async () => {
    expect((await get(path)).status).toBe(401);
  });

  it("hides other people's files behind a 404", async () => {
    const res = await get(path, await issuer.sign("someone-else", "aal2"));
    expect(res.status).toBe(404);
    world.roles.set(world.userFor("collector").id, ["collector"]);
    expect((await get(path, await issuer.sign("collector", "aal2"))).status).toBe(404);
  });

  it("lets owner/admin read after MFA only", async () => {
    world.roles.set(world.userFor("admin").id, ["admin"]);
    expect(await errorCode(await get(path, await issuer.sign("admin", "aal1")))).toBe("mfa_required");
    expect((await get(path, await issuer.sign("admin", "aal2"))).status).toBe(200);
  });

  it("serves byte ranges and re-checks access on each range request", async () => {
    const token = await issuer.sign("uploader");
    const res = await get(path, token, { range: "bytes=2-5" });
    expect(res.status).toBe(206);
    expect(await res.text()).toBe("2345");
    expect(res.headers.get("content-range")).toBe("bytes 2-5/10");

    const tail = await get(path, token, { range: "bytes=-3" });
    expect(await tail.text()).toBe("789");

    expect((await get(path, token, { range: "bytes=20-" })).status).toBe(416);

    const stranger = await issuer.sign("stranger");
    expect((await get(path, stranger, { range: "bytes=0-1" })).status).toBe(404);
  });

  it("never serves staged, rejected or non-allowlisted files", async () => {
    const token = await issuer.sign("uploader");
    world.media.get(assetId)!.state = "staged";
    expect((await get(path, token)).status).toBe(404);
    world.media.get(assetId)!.state = "rejected";
    expect((await get(path, token)).status).toBe(404);
    world.media.get(assetId)!.state = "validated";
    world.media.get(assetId)!.mimeType = "text/html";
    expect((await get(path, token)).status).toBe(404);
  });

  it("returns 404 for malformed IDs", async () => {
    expect((await get("/api/media/not-a-uuid/content", await issuer.sign("uploader"))).status).toBe(404);
  });
});
