import { and, eq, isNull, sql } from "drizzle-orm";
import type { Database } from "./client";
import { appUsers, auditEvents, authIdentities, staffRoles } from "./schema";

export type BootstrapOwnerInput = {
  /** Login provider name, e.g. "supabase". */
  provider: string;
  /** The provider's user ID for the person who signed in. */
  providerSubject: string;
  displayName: string;
  /** Allow adding a second owner. Off by default so the command is safe to re-run. */
  allowAdditional?: boolean;
};

export type BootstrapOwnerResult =
  | { status: "created"; userId: string }
  | { status: "already_owner"; userId: string }
  | { status: "owner_exists" };

/**
 * Makes a signed-in identity the owner. This is an explicit operator step run with
 * migration credentials, never "first public signup wins" (specs/09 Milestone 0).
 * The API's runtime role cannot do this: the database refuses owner rows from it.
 */
export async function bootstrapOwner(
  db: Database,
  input: BootstrapOwnerInput,
): Promise<BootstrapOwnerResult> {
  return db.transaction(async (tx) => {
    // Serialise concurrent bootstrap runs.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('ezysource.bootstrap_owner'))`);

    const [identity] = await tx
      .select({ userId: authIdentities.userId })
      .from(authIdentities)
      .where(
        and(
          eq(authIdentities.provider, input.provider),
          eq(authIdentities.providerSubject, input.providerSubject),
        ),
      );

    const owners = await tx
      .select({ userId: staffRoles.userId })
      .from(staffRoles)
      .where(and(eq(staffRoles.role, "owner"), isNull(staffRoles.revokedAt)));

    if (identity && owners.some((o) => o.userId === identity.userId)) {
      return { status: "already_owner", userId: identity.userId };
    }
    if (owners.length > 0 && !input.allowAdditional) {
      return { status: "owner_exists" };
    }

    let userId = identity?.userId;
    if (!userId) {
      const [user] = await tx
        .insert(appUsers)
        .values({ displayName: input.displayName })
        .returning({ id: appUsers.id });
      userId = user!.id;
      await tx.insert(authIdentities).values({
        userId,
        provider: input.provider,
        providerSubject: input.providerSubject,
      });
    }

    await tx.insert(staffRoles).values({ userId, role: "owner" });
    await tx
      .update(appUsers)
      .set({ authzVersion: sql`${appUsers.authzVersion} + 1`, updatedAt: sql`now()` })
      .where(eq(appUsers.id, userId));
    await tx.insert(auditEvents).values({
      actorLabel: "cli:bootstrap-owner",
      action: "staff_role.owner_bootstrap",
      targetType: "app_user",
      targetId: userId,
      outcome: "success",
      summary: { provider: input.provider, additional: owners.length > 0 },
    });

    return { status: "created", userId };
  });
}
