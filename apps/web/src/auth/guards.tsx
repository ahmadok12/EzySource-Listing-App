import type { ReactNode } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import type { StaffRole } from "@ezysource/domain";
import { ApiRequestError } from "../lib/api";
import { Button } from "../components/Button";
import { GlassCard } from "../components/GlassCard";
import { useAuth, useMe } from "./AuthProvider";

function Status({ title, detail, children }: { title: string; detail?: string; children?: ReactNode }) {
  return (
    <GlassCard className="page__notice" role="status">
      <p className="page__row-title">{title}</p>
      {detail ? <p className="page__meta">{detail}</p> : null}
      {children}
    </GlassCard>
  );
}

function loginPath(location: { pathname: string; search: string }, base = "/login") {
  return `${base}?next=${encodeURIComponent(location.pathname + location.search)}`;
}

type Props = {
  /** Staff roles allowed in. Omit to allow any signed-in person. "any" = any staff role. */
  staff?: StaffRole[] | "any";
  /** Lets unfinished-screen previews render when this build has no sign-in configured. */
  allowPreviewWithoutAuth?: boolean;
};

/**
 * Client-side routing guard. It only decides what to show; the API enforces every
 * permission again on each request (specs/02).
 */
export function RequireAuth({ staff, allowPreviewWithoutAuth = false }: Props) {
  const { adapter, signedIn, signOut } = useAuth();
  const location = useLocation();
  const me = useMe();

  if (!adapter && allowPreviewWithoutAuth) return <Outlet />;
  if (signedIn === undefined) return <Status title="Loading…" />;
  if (!signedIn) return <Navigate to={loginPath(location)} replace />;

  if (me.isPending) return <Status title="Loading…" />;
  if (me.isError) {
    if (me.error instanceof ApiRequestError && me.error.status === 401) {
      return <Navigate to={loginPath(location)} replace />;
    }
    return (
      <Status title="Something went wrong" detail="Please refresh the page and try again.">
        <div className="page__actions">
          <Button variant="secondary" onClick={() => void signOut()}>
            Sign out
          </Button>
        </div>
      </Status>
    );
  }

  if (staff) {
    const held = me.data.staffRoles.filter((r) => staff === "any" || staff.includes(r));
    if (held.length === 0) {
      return <Status title="You don't have access to this" detail="Ask an administrator if you need it." />;
    }
  }
  if (me.data.mfaRequired && staff) {
    return <Navigate to={loginPath(location, "/login/mfa")} replace />;
  }
  return <Outlet />;
}
