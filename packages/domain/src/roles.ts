import { z } from "zod";

/**
 * Staff roles from specs/03 (staff_roles.role) and specs/06.
 * "sourcing" is future scope (specs/10) but reserved in the schema.
 */
export const staffRoles = ["owner", "admin", "collector", "mapper", "sourcing"] as const;
export const staffRoleSchema = z.enum(staffRoles);
export type StaffRole = z.infer<typeof staffRoleSchema>;

/** Customer account membership roles (specs/03 account_members.role). */
export const accountMemberRoles = ["owner", "member"] as const;
export const accountMemberRoleSchema = z.enum(accountMemberRoles);
export type AccountMemberRole = z.infer<typeof accountMemberRoleSchema>;
