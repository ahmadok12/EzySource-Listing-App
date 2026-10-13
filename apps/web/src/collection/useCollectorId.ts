import { useAuth, useMe } from "../auth/AuthProvider";

/**
 * Who local recovery belongs to. Unsent forms are only ever restored for the same
 * signed-in person (specs/04). Null while that is still unknown.
 */
export function useCollectorId(): string | null {
  const { adapter } = useAuth();
  const me = useMe();
  // Builds without sign-in are screen previews only.
  if (!adapter) return "preview";
  return me.data?.user.id ?? null;
}
