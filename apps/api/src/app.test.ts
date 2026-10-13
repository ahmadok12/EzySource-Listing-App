import { describe, expect, it } from "vitest";
import { apiErrorSchema, healthResponseSchema } from "@ezysource/domain";
import { app, createApp, MAX_JSON_BODY_BYTES } from "./app";
import type { Env } from "./env";

const env: Env = { APP_ENV: "local", APP_VERSION: "test" };

describe("api foundations", () => {
  it("reports health", async () => {
    const res = await app.request("/api/health", {}, env);
    expect(res.status).toBe(200);
    expect(healthResponseSchema.parse(await res.json()).version).toBe("test");
  });

  it("sets private, non-cacheable security headers", async () => {
    const res = await app.request("/api/health", {}, env);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("returns the shared error shape for unknown routes", async () => {
    const res = await app.request("/api/nope", {}, env);
    expect(res.status).toBe(404);
    const body = apiErrorSchema.parse(await res.json());
    expect(body.error.code).toBe("not_found");
    expect(body.error.requestId).toBe(res.headers.get("x-request-id"));
  });

  it("rejects oversized bodies", async () => {
    const res = await app.request(
      "/api/health",
      {
        method: "POST",
        body: "x".repeat(MAX_JSON_BODY_BYTES + 1),
        headers: { "content-type": "application/json" },
      },
      env,
    );
    expect(res.status).toBe(413);
    expect(apiErrorSchema.parse(await res.json()).error.code).toBe("payload_too_large");
  });

  it("hides internal error details", async () => {
    const probe = createApp();
    probe.get("/boom", () => {
      throw new Error("SELECT secret FROM users");
    });
    const res = await probe.request("/api/boom", {}, env);
    const text = await res.text();
    expect(res.status).toBe(500);
    expect(text).not.toContain("SELECT");
  });
});
