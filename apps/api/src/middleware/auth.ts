import { createMiddleware } from "hono/factory";
import { mfaRequiredRoles, type StaffRole } from "@ezysource/domain";
import type { AppBindings } from "../env";
import { ApiError } from "../errors";

/**
 * Verifies the bearer token, then loads the caller's current state from the database:
 * suspension and staff roles are never taken from token claims (specs/06).
 * Bearer tokens only, no cookies, so cross-site requests carry no credentials.
 */
export const authenticate = createMiddleware<AppBindings>(async (c, next) => {
  const { verifier, users } = c.get("services");
  if (!verifier || !users) {
    throw new ApiError("upstream_unavailable", "Sign-in isn't configured on this server yet.");
  }

  const header = c.req.header("authorization") ?? "";
  const match = /^Bearer ([A-Za-z0-9._~+/=-]+)$/.exec(header);
  const identity = match ? await verifier.verify(match[1]!) : null;
  if (!identity) {
    throw new ApiError("unauthenticated", "Please sign in again.");
  }

  const user = await users.resolve(identity);
  if (user.state !== "active") {
    throw new ApiError("forbidden", "This account is suspended.");
  }

  c.set("actor", {
    user,
    staffRoles: await users.staffRoles(user.id),
    assuranceLevel: identity.assuranceLevel,
  });
  await next();
});

export function needsMfa(roles: readonly StaffRole[], assuranceLevel: string) {
  return assuranceLevel !== "aal2" && roles.some((r) => (mfaRequiredRoles as readonly string[]).includes(r));
}

/** Allows only callers holding one of `allowed`. Owner/admin must have completed MFA. */
export function requireStaff(...allowed: StaffRole[]) {
  return createMiddleware<AppBindings>(async (c, next) => {
    const actor = c.get("actor");
    const held = actor.staffRoles.filter((r) => allowed.includes(r));
    if (held.length === 0) {
      throw new ApiError("forbidden", "You don't have access to this.");
    }
    if (needsMfa(held, actor.assuranceLevel)) {
      throw new ApiError("mfa_required", "Complete two-step verification to continue.");
    }
    await next();
  });
}
