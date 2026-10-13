import { useMe } from "../../auth/AuthProvider";
import { GlassCard } from "../../components/GlassCard";
import "../pages.css";

export function AdminHomePage() {
  const me = useMe();
  return (
    <section className="page">
      <h1 className="page__title">Admin</h1>
      <GlassCard className="page__notice">
        <p className="page__row-title">Signed in as {me.data?.user.displayName ?? "staff"}</p>
        <p className="page__meta">Roles: {me.data?.staffRoles.join(", ") || "none"}</p>
      </GlassCard>
    </section>
  );
}
