import { and, inArray, sql, type SQL } from "drizzle-orm";
import { DomainError, type RevisionState, type StaffRole } from "@ezysource/domain";
import type { Database } from "./client";
import { collectionSessions, recordGrants, shopRevisions } from "./schema";

/**
 * Collector access rules shared by shop drafts and their media (specs/06). Not exported
 * from the package: callers go through the operations in collection.ts and media.ts.
 */

export type CollectionActor = { userId: string; roles: readonly StaffRole[]; requestId?: string };

export type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type Queryable = Database | Tx;

export const EDITABLE_STATES: RevisionState[] = ["draft", "returned"];

export const isReviewer = (actor: CollectionActor) =>
  actor.roles.includes("owner") || actor.roles.includes("admin");

export const notFound = () => new DomainError("not_found", "Not found.");

/** SQL true when `actor` may currently work on the revision in the outer query. */
export function accessible(actor: CollectionActor): SQL {
  const editable = inArray(shopRevisions.state, EDITABLE_STATES);
  if (isReviewer(actor)) return editable;
  return and(
    editable,
    sql`exists (
      select 1 from ${recordGrants} g
      where g.revision_id = ${shopRevisions.id}
        and g.user_id = ${actor.userId}
        and g.revoked_at is null
        and (g.expires_at is null or g.expires_at > now())
        and (
          g.policy_mode <> 'immediate_handoff'
          or exists (
            select 1 from ${collectionSessions} s
            where s.id = ${shopRevisions.sessionId}
              and s.collector_id = ${actor.userId}
              and s.finished_at is null
          )
        )
    )`,
  )!;
}
