import "../components/Button.css";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { GlassCard } from "../components/GlassCard";
import "./pages.css";

export function HomePage() {
  const { adapter, signedIn } = useAuth();
  return (
    <section className="page">
      <p className="page__kicker">Yiwu International Trade City</p>
      <h1 className="page__display">Find Futian suppliers before you fly.</h1>
      <p className="page__lede">
        EzySource is a subscription directory of shops in Yiwu's Futian market, with shop
        photos, catalogues and supplier contacts collected on the ground.
      </p>
      <GlassCard className="page__notice">
        <p className="page__row-title">Opening soon</p>
        <p className="page__meta">Plans and the supplier directory will appear here when they are ready.</p>
      </GlassCard>
      {adapter ? (
        <div className="page__actions">
          <Link className="button button--primary" to={signedIn ? "/account" : "/login"}>
            {signedIn ? "Your account" : "Sign in"}
          </Link>
        </div>
      ) : null}
    </section>
  );
}
