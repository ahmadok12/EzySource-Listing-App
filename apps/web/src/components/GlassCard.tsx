import type { HTMLAttributes } from "react";

export function GlassCard({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={["glass", className].filter(Boolean).join(" ")}
      style={{ borderRadius: "var(--radius-card)", padding: "var(--space-4)" }}
      {...rest}
    />
  );
}
