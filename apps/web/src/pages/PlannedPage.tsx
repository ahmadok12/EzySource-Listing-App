import { GlassCard } from "../components/GlassCard";
import "./pages.css";

/** Development-only stand-in for a destination that a later milestone builds. */
export function PlannedPage({ title, milestone }: { title: string; milestone: number }) {
  return (
    <section className="page">
      <h1 className="page__title">{title}</h1>
      <GlassCard className="page__notice">
        <p className="page__row-title">Not built yet</p>
        <p className="page__meta">
          Planned for milestone {milestone}. This screen is only visible in development previews.
        </p>
      </GlassCard>
    </section>
  );
}
