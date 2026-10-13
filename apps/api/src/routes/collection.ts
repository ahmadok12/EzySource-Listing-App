import { Hono, type Context } from "hono";
import { z } from "zod";
import {
  addContactSchema,
  createDraftSchema,
  draftListQuerySchema,
  idempotencyKeySchema,
  sessionDefaultsSchema,
  updateContactSchema,
  updateDraftSchema,
  type CollectionContext,
  type CollectionReference,
  type DraftListResponse,
  type DraftResponse,
  type SessionResponse,
} from "@ezysource/domain";
import type { AppBindings } from "../env";
import { ApiError } from "../errors";
import { authenticate, requireStaff } from "../middleware/auth";
import type { CollectionService } from "../services";

/**
 * Shop collection API (specs/08 API table). Collectors, admins and owners only;
 * which records a collector can open is decided per request from their grants.
 */

type C = Context<AppBindings>;

function collection(c: C): CollectionService {
  const service = c.get("services").collection;
  if (!service) throw new ApiError("upstream_unavailable", "The database isn't configured on this server yet.");
  return service;
}

function actor(c: C) {
  const { user, staffRoles } = c.get("actor");
  return { userId: user.id, roles: staffRoles, requestId: c.get("requestId") };
}

function toFieldErrors(error: z.ZodError) {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const field = issue.path.length > 0 ? issue.path.join(".") : "_form";
    (fieldErrors[field] ??= []).push(issue.message);
  }
  return fieldErrors;
}

function invalid(error: z.ZodError) {
  const fieldErrors = toFieldErrors(error);
  return new ApiError("validation_failed", fieldErrors._form?.[0] ?? "Check the highlighted fields.", fieldErrors);
}

async function body<S extends z.ZodType>(c: C, schema: S): Promise<z.output<S>> {
  let json: unknown;
  try {
    json = await c.req.json();
  } catch {
    throw new ApiError("validation_failed", "Send a JSON body.");
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw invalid(parsed.error);
  return parsed.data;
}

/** Path IDs that aren't UUIDs can't name a record, so they get the same 404. */
function id(c: C, name: string) {
  const parsed = z.uuid().safeParse(c.req.param(name));
  if (!parsed.success) throw new ApiError("not_found", "Not found.");
  return parsed.data;
}

const staffOnly = [authenticate, requireStaff("collector", "admin", "owner")] as const;

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
  });
