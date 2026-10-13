import { z } from "zod";

/** Staff roles from specs/00 and 06. Sourcing staff is future scope. */
export const staffRoles = ["owner", "administrator", "collector", "floor_mapper"] as const;
export const staffRoleSchema = z.enum(staffRoles);
export type StaffRole = z.infer<typeof staffRoleSchema>;

/** Customer-side roles. Supplier contacts are never user logins. */
export const customerRoles = ["account_owner", "member"] as const;
export const customerRoleSchema = z.enum(customerRoles);
export type CustomerRole = z.infer<typeof customerRoleSchema>;
