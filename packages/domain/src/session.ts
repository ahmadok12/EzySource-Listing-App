import { z } from "zod";
import { staffRoleSchema } from "./roles";

/** Authentication assurance level from the login provider. aal2 = MFA completed. */
export const assuranceLevelSchema = z.enum(["aal1", "aal2"]);
export type AssuranceLevel = z.infer<typeof assuranceLevelSchema>;

/** Roles that must complete MFA before any privileged action (specs/06). */
export const mfaRequiredRoles = ["owner", "admin"] as const;

/** GET /api/me — the signed-in person as the server sees them right now. */
export const meResponseSchema = z.object({
  user: z.object({
    id: z.uuid(),
    displayName: z.string(),
  }),
  staffRoles: z.array(staffRoleSchema),
  assuranceLevel: assuranceLevelSchema,
  /** True when a staff role needs MFA and this session has not completed it. */
  mfaRequired: z.boolean(),
});
export type MeResponse = z.infer<typeof meResponseSchema>;

/** GET /api/admin/staff — active staff, owner/admin only. */
export const staffListResponseSchema = z.object({
  staff: z.array(
    z.object({
      userId: z.uuid(),
      displayName: z.string(),
      state: z.enum(["active", "suspended"]),
      roles: z.array(staffRoleSchema),
    }),
  ),
});
export type StaffListResponse = z.infer<typeof staffListResponseSchema>;
