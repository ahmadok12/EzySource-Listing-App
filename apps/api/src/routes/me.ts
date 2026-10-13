import { Hono } from "hono";
import type { MeResponse } from "@ezysource/domain";
import type { AppBindings } from "../env";
import { authenticate, needsMfa } from "../middleware/auth";

export const meRoutes = new Hono<AppBindings>().get("/me", authenticate, (c) => {
  const { user, staffRoles, assuranceLevel } = c.get("actor");
  const body: MeResponse = {
    user: { id: user.id, displayName: user.displayName },
    staffRoles,
    assuranceLevel,
    mfaRequired: needsMfa(staffRoles, assuranceLevel),
  };
  return c.json(body);
});
