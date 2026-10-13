import {
  createDb,
  getActiveStaffRoles,
  getMediaAsset,
  listActiveStaff,
  resolveUserForIdentity,
  type AppUser,
  type MediaAssetRecord,
} from "@ezysource/db";
import {
  R2ObjectStore,
  SupabaseTokenVerifier,
  type ObjectStore,
  type TokenVerifier,
} from "@ezysource/providers";
import type { StaffRole } from "@ezysource/domain";
import type { Env } from "./env";

/**
 * Everything a request handler needs from the outside world. Handlers never talk to
 * providers directly, so tests can swap in fakes and providers stay replaceable.
 */
export type Services = {
  verifier: TokenVerifier | null;
  users: {
    resolve(identity: { provider: string; subject: string }): Promise<AppUser>;
    staffRoles(userId: string): Promise<StaffRole[]>;
    listStaff(): Promise<Array<AppUser & { roles: StaffRole[] }>>;
  } | null;
  media: { get(id: string): Promise<MediaAssetRecord | null> } | null;
  store: ObjectStore | null;
  /** Releases per-request resources such as database connections. */
  close(): Promise<void>;
};

export type ServicesFactory = (env: Env) => Services;

/** Real services for the Worker. Missing configuration yields null, never a fake success. */
export const createServices: ServicesFactory = (env) => {
  const database = env.DATABASE_URL ? createDb(env.DATABASE_URL, { max: 1 }) : null;
  const db = database?.db;
  return {
    verifier: env.SUPABASE_URL ? new SupabaseTokenVerifier(env.SUPABASE_URL) : null,
    users: db
      ? {
          resolve: (identity) => resolveUserForIdentity(db, identity),
          staffRoles: (userId) => getActiveStaffRoles(db, userId),
          listStaff: () => listActiveStaff(db),
        }
      : null,
    media: db ? { get: (id) => getMediaAsset(db, id) } : null,
    store: env.MEDIA ? new R2ObjectStore(env.MEDIA) : null,
    close: async () => {
      await database?.sql.end({ timeout: 5 });
    },
  };
};
