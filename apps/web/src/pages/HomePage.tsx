import { GlassCard } from "../components/GlassCard";
import "./pages.css";

export function HomePage() {
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
        <p className="page__meta">Member sign-in and plans will appear here when they are ready.</p>
      </GlassCard>
    </section>
  );
}
