import { useQuery } from "@tanstack/react-query";
import { staffListResponseSchema } from "@ezysource/domain";
import { apiGet } from "../../lib/api";
import { GlassCard } from "../../components/GlassCard";
import "../pages.css";

export function StaffPage() {
  const staff = useQuery({
    queryKey: ["admin", "staff"],
    queryFn: () => apiGet("/admin/staff", staffListResponseSchema.parse),
  });

  return (
    <section className="page">
      <h1 className="page__title">Staff</h1>
      {staff.isPending ? <p className="page__meta">Loading…</p> : null}
      {staff.isError ? (
        <p className="page__error" role="alert">
          {staff.error.message}
        </p>
      ) : null}
      {staff.data ? (
        <ul className="page__list">
          {staff.data.staff.map((person) => (
            <li key={person.userId}>
              <GlassCard>
                <p className="page__row-title">{person.displayName}</p>
                <p className="page__meta">
                  {person.roles.join(", ")}
                  {person.state === "suspended" ? " · suspended" : ""}
                </p>
              </GlassCard>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
