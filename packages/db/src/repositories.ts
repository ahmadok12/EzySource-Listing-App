import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { StaffRole } from "@ezysource/domain";
import type { Database } from "./client";
import { appUsers, authIdentities, mediaAssets, staffRoles } from "./schema";

export type AppUser = {
  id: string;
  displayName: string;
  state: "active" | "suspended";
};

const userColumns = {
  id: appUsers.id,
  displayName: appUsers.displayName,
  state: appUsers.state,
};

function toAppUser(row: { id: string; displayName: string; state: string }): AppUser {
  return { ...row, state: row.state === "active" ? "active" : "suspended" };
}

/**
 * Finds the app user for a verified login, creating one with no roles on first
 * sign-in (specs/02 account flow). Roles are never granted here.
 */
export async function resolveUserForIdentity(
  db: Database,
  identity: { provider: string; subject: string },
): Promise<AppUser> {
  const find = async (tx: Pick<Database, "select">) => {
    const [row] = await tx
      .select(userColumns)
      .from(authIdentities)
      .innerJoin(appUsers, eq(appUsers.id, authIdentities.userId))
      .where(
        and(
          eq(authIdentities.provider, identity.provider),
          eq(authIdentities.providerSubject, identity.subject),
        ),
      );
    return row ? toAppUser(row) : null;
  };

  const existing = await find(db);
  if (existing) return existing;

  return db.transaction(async (tx) => {
    // Serialise first sign-in for this identity so two requests can't create two users.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`identity:${identity.provider}:${identity.subject}`}))`,
    );
    const raced = await find(tx);
    if (raced) return raced;

    const [user] = await tx
      .insert(appUsers)
      .values({ displayName: "New user" })
      .returning(userColumns);
    await tx.insert(authIdentities).values({
      userId: user!.id,
      provider: identity.provider,
      providerSubject: identity.subject,
    });
    return toAppUser(user!);
  });
}

/** Current, unrevoked staff roles. Read on every request so revocation is immediate. */
export async function getActiveStaffRoles(db: Database, userId: string): Promise<StaffRole[]> {
  const rows = await db
    .select({ role: staffRoles.role })
    .from(staffRoles)
    .where(and(eq(staffRoles.userId, userId), isNull(staffRoles.revokedAt)))
    .orderBy(asc(staffRoles.role));
  return rows.map((r) => r.role as StaffRole);
}

export async function listActiveStaff(db: Database) {
  const rows = await db
    .select({ ...userColumns, role: staffRoles.role })
    .from(staffRoles)
    .innerJoin(appUsers, eq(appUsers.id, staffRoles.userId))
    .where(isNull(staffRoles.revokedAt))
    .orderBy(asc(appUsers.displayName), asc(staffRoles.role))
    .limit(500);

  const byUser = new Map<string, AppUser & { roles: StaffRole[] }>();
  for (const row of rows) {
    const entry = byUser.get(row.id) ?? { ...toAppUser(row), roles: [] };
    entry.roles.push(row.role as StaffRole);
    byUser.set(row.id, entry);
  }
  return [...byUser.values()];
}

export type MediaAssetRecord = {
  id: string;
  objectKey: string;
  mimeType: string;
  sizeBytes: number;
  state: string;
  uploaderId: string;
};

export async function getMediaAsset(db: Database, id: string): Promise<MediaAssetRecord | null> {
  const [row] = await db
    .select({
      id: mediaAssets.id,
      objectKey: mediaAssets.objectKey,
      mimeType: mediaAssets.mimeType,
      sizeBytes: mediaAssets.sizeBytes,
      state: mediaAssets.state,
      uploaderId: mediaAssets.uploaderId,
    })
    .from(mediaAssets)
    .where(eq(mediaAssets.id, id));
  return row ?? null;
}
