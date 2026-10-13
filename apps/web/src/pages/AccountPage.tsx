import { Link, useNavigate } from "react-router-dom";
import { useAuth, useMe } from "../auth/AuthProvider";
import { Button } from "../components/Button";
import { GlassCard } from "../components/GlassCard";
import "./pages.css";

export function AccountPage() {
  const { signOut } = useAuth();
  const me = useMe();
  const navigate = useNavigate();

  return (
    <section className="page">
      <h1 className="page__title">Account</h1>
      {me.data ? (
        <GlassCard className="page__notice">
          <p className="page__row-title">{me.data.user.displayName}</p>
          <p className="page__meta">
            {me.data.staffRoles.length > 0 ? `Staff: ${me.data.staffRoles.join(", ")}` : "Member"}
          </p>
          {me.data.staffRoles.length > 0 ? <Link to="/admin">Go to admin</Link> : null}
        </GlassCard>
      ) : null}
      <div>
        <Button
          variant="secondary"
          onClick={async () => {
            await signOut();
            navigate("/", { replace: true });
          }}
        >
          Sign out
        </Button>
      </div>
    </section>
  );
}
