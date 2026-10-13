import "./Logo.css";

export function Logo({ subtitle }: { subtitle?: string }) {
  return (
    <span className="logo">
      <span className="logo__mark" aria-hidden="true">
        E
      </span>
      <span className="logo__text">
        <span className="logo__name">EzySource</span>
        {subtitle ? <span className="logo__subtitle">{subtitle}</span> : null}
      </span>
    </span>
  );
}
