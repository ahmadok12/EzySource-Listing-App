import type { Context } from "hono";
import { z } from "zod";
import type { AppBindings } from "../env";
import { ApiError } from "../errors";
import { authenticate, requireStaff } from "../middleware/auth";
import type { CollectionService } from "../services";

/** Shared by the collection and upload routes. */

export type C = Context<AppBindings>;

export function collection(c: C): CollectionService {
  const service = c.get("services").collection;
  if (!service) throw new ApiError("upstream_unavailable", "The database isn't configured on this server yet.");
  return service;
}

export function actor(c: C) {
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

export function invalid(error: z.ZodError) {
  const fieldErrors = toFieldErrors(error);
  return new ApiError("validation_failed", fieldErrors._form?.[0] ?? "Check the highlighted fields.", fieldErrors);
}

export async function body<S extends z.ZodType>(c: C, schema: S): Promise<z.output<S>> {
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
export function id(c: C, name: string) {
  const parsed = z.uuid().safeParse(c.req.param(name));
  if (!parsed.success) throw new ApiError("not_found", "Not found.");
  return parsed.data;
}

export const staffOnly = [authenticate, requireStaff("collector", "admin", "owner")] as const;

