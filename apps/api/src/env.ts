import type { AssuranceLevel, StaffRole } from "@ezysource/domain";
import type { AppUser } from "@ezysource/db";
import type { Services } from "./services";

export type Env = {
  APP_ENV: "local" | "staging" | "production";
  APP_VERSION: string;
  /** Runtime login user (member of ezysource_runtime). Secret. */
  DATABASE_URL?: string;
  /** Supabase project URL, used to verify login tokens. Not a secret. */
  SUPABASE_URL?: string;
  /** Private media bucket. */
  MEDIA?: R2Bucket;
};

/** The verified, current caller. Built fresh from the database on every request. */
export type Actor = {
  user: AppUser;
  staffRoles: StaffRole[];
  assuranceLevel: AssuranceLevel;
};

export type Variables = {
  requestId: string;
  services: Services;
  actor: Actor;
};

export type AppBindings = { Bindings: Env; Variables: Variables };
