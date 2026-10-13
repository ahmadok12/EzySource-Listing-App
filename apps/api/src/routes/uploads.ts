import { Hono } from "hono";
import {
  mediaKindOf,
  mediaLimits,
  normalizeMediaType,
  uploadIntentSchema,
  type UploadResponse,
} from "@ezysource/domain";
import { ChecksumMismatchError } from "@ezysource/providers";
import type { AppBindings } from "../env";
import { ApiError } from "../errors";
import { looksLike, SNIFF_BYTES } from "../sniff";
import { actor, body, collection, id, staffOnly, type C } from "./helpers";

/** The largest file any section accepts. The upload route is exempt from the JSON body cap. */
export const MAX_UPLOAD_BYTES = Math.max(...Object.values(mediaLimits).map((l) => l.maxBytes));

export const UPLOAD_CONTENT_PATH = /^\/api\/uploads\/[^/]+\/content$/;

function storage(c: C) {
  const store = c.get("services").store;
  if (!store) throw new ApiError("upstream_unavailable", "File storage isn't configured on this server yet.");
  return store;
}

const rejectFile = (message: string) => new ApiError("validation_failed", message);

/**
 * Upload protocol (specs/04, specs/08):
 * 1. POST /uploads/intents fixes the target shop and section and stages a media ID.
 * 2. PUT /uploads/:id/content sends the bytes through this API into private storage,
 *    where size and checksum are verified, the type is checked from the first bytes,
 *    and the file is attached. Access is checked again at every step, so a collector
 *    whose access ended can't finish attaching a file. Retrying either step is safe.
 *
 * Bytes pass through the API rather than a pre-signed storage URL, so no separate
 * storage credentials are needed and no upload capability outlives a revoked grant.
 */
export const uploadRoutes = new Hono<AppBindings>()
  .use("/uploads/*", ...staffOnly)

  .post("/uploads/intents", async (c) => {
    const input = await body(c, uploadIntentSchema);
    const { media, replayed } = await collection(c).uploadIntent(actor(c), input);
    const res: UploadResponse = { media };
    return c.json(res, replayed ? 200 : 201);
  })

  .put("/uploads/:id/content", async (c) => {
    const store = storage(c);
    const service = collection(c);
    const who = actor(c);
    const mediaId = id(c, "id");

    const target = await service.uploadTarget(who, mediaId);
    if (!target) throw new ApiError("not_found", "Not found.");
    if (target.state === "validated") {
      // Already stored: the phone missed our answer last time.
      const res: UploadResponse = { media: await service.finishUpload(who, mediaId, "validated") };
      return c.json(res);
    }
    if (target.state !== "staged" && target.state !== "uploaded") {
      throw new ApiError("conflict", "This upload was cancelled. Add the file again.");
    }

    const type = normalizeMediaType(c.req.header("content-type") ?? "");
    if (type !== target.mimeType) throw rejectFile("The file type doesn't match what was announced.");
    const length = Number(c.req.header("content-length"));
    if (!Number.isInteger(length) || length !== target.sizeBytes || length > MAX_UPLOAD_BYTES) {
      throw rejectFile("The file size doesn't match what was announced.");
    }
    const stream = c.req.raw.body;
    if (!stream) throw rejectFile("Send the file's bytes.");

    try {
      await store.put(target.objectKey, stream, { size: length, sha256: target.checksum, contentType: type });
    } catch (error) {
      if (error instanceof ChecksumMismatchError) {
        throw rejectFile("The file was damaged on the way. Try sending it again.");
      }
      throw error;
    }

    const head = await store.get(target.objectKey, { offset: 0, length: SNIFF_BYTES });
    const first = head ? new Uint8Array(await new Response(head.body).arrayBuffer()) : new Uint8Array();
    if (!looksLike(first, type)) {
      await store.delete(target.objectKey);
      await service.finishUpload(who, mediaId, "rejected");
      const kind = mediaKindOf(type);
      throw rejectFile(
        kind === "image"
          ? "This isn't a photo we can read. Take the photo again."
          : kind === "pdf"
            ? "This isn't a readable PDF."
            : "This isn't a recording we can play.",
      );
    }

    try {
      const res: UploadResponse = { media: await service.finishUpload(who, mediaId, "validated") };
      return c.json(res);
    } catch (error) {
      // Access ended while the bytes were on their way: don't keep them.
      await store.delete(target.objectKey).catch(() => {});
      throw error;
    }
  });
