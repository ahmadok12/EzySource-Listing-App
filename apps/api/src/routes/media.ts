import { Hono } from "hono";
import { z } from "zod";
import type { AppBindings } from "../env";
import { ApiError } from "../errors";
import { authenticate, needsMfa } from "../middleware/auth";

/** Only these types are ever served, so stored HTML or SVG can never execute (specs/12). */
const SERVABLE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "audio/mpeg",
  "audio/mp4",
  "audio/webm",
  "audio/ogg",
  "application/pdf",
]);

const SERVABLE_STATES = new Set(["validated"]);

const notFound = () => new ApiError("not_found", "Not found.");

/** Parses a single `bytes=` range. Returns null for no range, "invalid" if unsatisfiable. */
export function parseRange(header: string | undefined, size: number) {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (match[1] === "" && match[2] === "")) return "invalid" as const;
  let start: number;
  let end: number;
  if (match[1] === "") {
    const suffix = Number(match[2]);
    if (suffix === 0) return "invalid" as const;
    start = Math.max(size - suffix, 0);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === "" ? size - 1 : Math.min(Number(match[2]), size - 1);
  }
  if (start >= size || end < start) return "invalid" as const;
  return { offset: start, length: end - start + 1 };
}

/**
 * Authorises every request, including each range request, before reading bytes.
 * Never returns a long-lived URL that would outlive a revoked permission (specs/08).
 * Unauthorised and missing look the same (non-disclosing 404).
 */
export const mediaRoutes = new Hono<AppBindings>().get("/media/:id/content", authenticate, async (c) => {
  const { media, store, collection } = c.get("services");
  if (!media || !store) {
    throw new ApiError("upstream_unavailable", "File storage isn't configured on this server yet.");
  }

  const id = z.uuid().safeParse(c.req.param("id"));
  if (!id.success) throw notFound();

  // Owners and admins (after two-step verification) may open any file. Collectors may
  // open a file only while it is on a draft they can still work on; that is checked
  // again on every request, including each range request.
  const actor = c.get("actor");
  const reviewerRoles = actor.staffRoles.filter((r) => r === "owner" || r === "admin");
  let asset: { objectKey: string; mimeType: string; sizeBytes: number; state: string } | null = null;
  if (reviewerRoles.length > 0) {
    if (needsMfa(reviewerRoles, actor.assuranceLevel)) {
      throw new ApiError("mfa_required", "Complete two-step verification to continue.");
    }
    asset = await media.get(id.data);
  } else if (actor.staffRoles.includes("collector") && collection) {
    asset = await collection.readableMedia(
      { userId: actor.user.id, roles: actor.staffRoles, requestId: c.get("requestId") },
      id.data,
    );
  }
  if (!asset || !SERVABLE_STATES.has(asset.state) || !SERVABLE_TYPES.has(asset.mimeType)) {
    throw notFound();
  }

  const range = parseRange(c.req.header("range"), asset.sizeBytes);
  if (range === "invalid") {
    return c.body(null, 416, { "Content-Range": `bytes */${asset.sizeBytes}` });
  }

  const object = await store.get(asset.objectKey, range ?? undefined);
  if (!object) throw notFound();

  const headers: Record<string, string> = {
    "Content-Type": asset.mimeType,
    "Accept-Ranges": "bytes",
    "Content-Disposition": "inline",
    "Content-Security-Policy": "default-src 'none'; sandbox; frame-ancestors 'none'",
  };
  if (range && object.range) {
    const last = object.range.offset + object.range.length - 1;
    headers["Content-Range"] = `bytes ${object.range.offset}-${last}/${object.size}`;
    headers["Content-Length"] = String(object.range.length);
    return c.body(object.body, 206, headers);
  }
  headers["Content-Length"] = String(object.size);
  return c.body(object.body, 200, headers);
});
