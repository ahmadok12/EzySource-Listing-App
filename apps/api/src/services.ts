import {
  addDraftContact,
  createDb,
  createDraft,
  finishCollectionSession,
  getActiveStaffRoles,
  getCollectionContext,
  getCollectionReference,
  getDraft,
  listDrafts,
  startCollectionSession,
  updateCollectionSession,
  updateDraft,
  updateDraftContact,
  type Database,
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
  collection: CollectionService | null;
  store: ObjectStore | null;
  /** Releases per-request resources such as database connections. */
  close(): Promise<void>;
};

type WithoutDb<F> = F extends (db: Database, ...args: infer A) => infer R ? (...args: A) => R : never;

/** Shop collection operations. Each one checks the actor's access itself (packages/db/src/collection.ts). */
export type CollectionService = {
  reference: WithoutDb<typeof getCollectionReference>;
  context: WithoutDb<typeof getCollectionContext>;
  startSession: WithoutDb<typeof startCollectionSession>;
  updateSession: WithoutDb<typeof updateCollectionSession>;
  finishSession: WithoutDb<typeof finishCollectionSession>;
  createDraft: WithoutDb<typeof createDraft>;
  getDraft: WithoutDb<typeof getDraft>;
  listDrafts: WithoutDb<typeof listDrafts>;
  updateDraft: WithoutDb<typeof updateDraft>;
  addContact: WithoutDb<typeof addDraftContact>;
  updateContact: WithoutDb<typeof updateDraftContact>;
};

export function createCollectionService(db: Database): CollectionService {
  return {
    reference: () => getCollectionReference(db),
    context: (...a) => getCollectionContext(db, ...a),
    startSession: (...a) => startCollectionSession(db, ...a),
    updateSession: (...a) => updateCollectionSession(db, ...a),
    finishSession: (...a) => finishCollectionSession(db, ...a),
    createDraft: (...a) => createDraft(db, ...a),
    getDraft: (...a) => getDraft(db, ...a),
    listDrafts: (...a) => listDrafts(db, ...a),
    updateDraft: (...a) => updateDraft(db, ...a),
    addContact: (...a) => addDraftContact(db, ...a),
    updateContact: (...a) => updateDraftContact(db, ...a),
  };
}

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
    collection: db ? createCollectionService(db) : null,
    store: env.MEDIA ? new R2ObjectStore(env.MEDIA) : null,
    close: async () => {
      await database?.sql.end({ timeout: 5 });
    },
  };
};
