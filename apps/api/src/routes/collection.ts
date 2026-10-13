import { Hono } from "hono";
import {
  addContactSchema,
  createDraftSchema,
  draftListQuerySchema,
  idempotencyKeySchema,
  sessionDefaultsSchema,
  updateContactSchema,
  updateDraftSchema,
  updateMediaSchema,
  type CollectionContext,
  type CollectionReference,
  type DraftListResponse,
  type DraftResponse,
  type SessionResponse,
  type UploadResponse,
} from "@ezysource/domain";
import type { AppBindings } from "../env";
import { ApiError } from "../errors";
import { actor, body, collection, id, invalid, staffOnly } from "./helpers";

/**
 * Shop collection API (specs/08 API table). Collectors, admins and owners only;
 * which records a collector can open is decided per request from their grants.
 */

export const collectionRoutes = new Hono<AppBindings>()
  .use("/collection/*", ...staffOnly)
  .use("/drafts", ...staffOnly)
  .use("/drafts/*", ...staffOnly)

  .get("/collection/reference", async (c) => {
    const body: CollectionReference = await collection(c).reference();
    return c.json(body);
  })

  .get("/collection/context", async (c) => {
    const body: CollectionContext = await collection(c).context(actor(c));
    return c.json(body);
  })

  .post("/collection/sessions", async (c) => {
    const input = await body(c, sessionDefaultsSchema);
    const res: SessionResponse = { session: await collection(c).startSession(actor(c), input) };
    return c.json(res, 201);
  })

  .patch("/collection/sessions/:id", async (c) => {
    const input = await body(c, sessionDefaultsSchema);
    const res: SessionResponse = {
      session: await collection(c).updateSession(actor(c), id(c, "id"), input),
    };
    return c.json(res);
  })

  .post("/collection/sessions/:id/finish", async (c) => {
    const res: SessionResponse = { session: await collection(c).finishSession(actor(c), id(c, "id")) };
    return c.json(res);
  })

  .post("/drafts", async (c) => {
    const key = idempotencyKeySchema.safeParse(c.req.header("idempotency-key"));
    if (!key.success) {
      throw new ApiError("validation_failed", key.error.issues[0]!.message);
    }
    const input = await body(c, createDraftSchema);
    const { draft, replayed } = await collection(c).createDraft(actor(c), key.data, input);
    const res: DraftResponse = { draft };
    return c.json(res, replayed ? 200 : 201);
  })

  .get("/drafts", async (c) => {
    const query = draftListQuerySchema.safeParse(c.req.query());
    if (!query.success) throw invalid(query.error);
    const res: DraftListResponse = await collection(c).listDrafts(actor(c), query.data);
    return c.json(res);
  })

  .get("/drafts/:id", async (c) => {
    const res: DraftResponse = { draft: await collection(c).getDraft(actor(c), id(c, "id")) };
    return c.json(res);
  })

  .patch("/drafts/:id", async (c) => {
    const input = await body(c, updateDraftSchema);
    const res: DraftResponse = { draft: await collection(c).updateDraft(actor(c), id(c, "id"), input) };
    return c.json(res);
  })

  .post("/drafts/:id/contacts", async (c) => {
    const input = await body(c, addContactSchema);
    const res: DraftResponse = { draft: await collection(c).addContact(actor(c), id(c, "id"), input) };
    return c.json(res, 201);
  })

  .patch("/drafts/:id/contacts/:contactId", async (c) => {
    const input = await body(c, updateContactSchema);
    const res: DraftResponse = {
      draft: await collection(c).updateContact(actor(c), id(c, "id"), id(c, "contactId"), input),
    };
    return c.json(res);
  })

  .patch("/drafts/:id/media/:mediaId", async (c) => {
    const input = await body(c, updateMediaSchema);
    const res: UploadResponse = {
      media: await collection(c).updateMedia(actor(c), id(c, "id"), id(c, "mediaId"), input),
    };
    return c.json(res);
  })

  .delete("/drafts/:id/media/:mediaId", async (c) => {
    const { objectKey } = await collection(c).removeMedia(actor(c), id(c, "id"), id(c, "mediaId"));
    // The record is already marked removed; a leftover object is harmless and private.
    const store = c.get("services").store;
    if (objectKey && store) await store.delete(objectKey).catch(() => {});
    return c.body(null, 204);
  });
