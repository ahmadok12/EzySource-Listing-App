import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import type { CollectionContext, CollectionReference, CollectionSession } from "@ezysource/domain";
import { Button } from "../../components/Button";
import { GlassCard } from "../../components/GlassCard";
import { LocationPicker } from "../../collection/fields";
import { categoryName, locationLabel } from "../../collection/form";
import { formatTime } from "../../collection/format";
import { localDrafts } from "../../collection/localDrafts";
import { useCollectionContext, useDrafts, useReference, useSessionActions } from "../../collection/queries";
import { useCollectorId } from "../../collection/useCollectorId";
import "../pages.css";
import "./collection.css";

const MODE_NOTES: Record<CollectionContext["policy"]["mode"], string> = {
  review_then_submit: "You can open and edit your shops until you submit them.",
  own_until_revoked: "Your shops stay available to you until an admin removes access.",
  temporary: "Your shops stay available for a limited time after saving.",
  immediate_handoff: "Shops stay open only until you finish this session.",
};

/** Collector home: the session, a big "New shop" action, unsent and saved shops. */
export function CollectionHomePage() {
  const reference = useReference();
  const context = useCollectionContext();

  if (reference.isError || context.isError) {
    return (
      <section className="page">
        <h1 className="page__title">Collection</h1>
        <p className="page__error" role="alert">
          {(reference.error ?? context.error)?.message}
        </p>
      </section>
    );
  }
  if (!reference.data || !context.data) {
    return (
      <section className="page">
        <h1 className="page__title">Collection</h1>
        <p className="page__meta">Loading…</p>
      </section>
    );
  }

  return (
    <section className="page collect">
      <h1 className="page__title">Collection</h1>
      {context.data.session ? (
        <ActiveSession reference={reference.data} session={context.data.session} />
      ) : (
        <StartSession reference={reference.data} />
      )}
      <p className="page__meta">{MODE_NOTES[context.data.policy.mode]}</p>
      <UnsentShops reference={reference.data} />
      <SavedShops reference={reference.data} />
    </section>
  );
}

function StartSession({ reference }: { reference: CollectionReference }) {
  const [location, setLocation] = useState({ districtId: "", floorId: "", categoryId: "" });
  const { start } = useSessionActions();
  return (
    <GlassCard className="collect__card">
      <p className="page__row-title">Where are you collecting today?</p>
      <p className="page__meta">New shops start with this location and category. You can change it any time.</p>
      <LocationPicker reference={reference} value={location} onChange={setLocation} categoryLabel="Usual category (optional)" />
      {start.isError ? (
        <p className="page__error" role="alert">
          {start.error.message}
        </p>
      ) : null}
      <Button
        disabled={start.isPending}
        onClick={() =>
          start.mutate({
            districtId: location.districtId || null,
            floorId: location.floorId || null,
            defaultCategoryId: location.categoryId || null,
          })
        }
      >
        {start.isPending ? "Starting…" : "Start session"}
      </Button>
    </GlassCard>
  );
}

function ActiveSession({ reference, session }: { reference: CollectionReference; session: CollectionSession }) {
  const navigate = useNavigate();
  const { update, finish } = useSessionActions();
  const [changing, setChanging] = useState(false);
  const [location, setLocation] = useState({
    districtId: session.districtId ?? "",
    floorId: session.floorId ?? "",
    categoryId: session.defaultCategoryId ?? "",
  });
  const where = locationLabel(reference, session.districtId, session.floorId) || "No location set";
  const category = categoryName(reference, session.defaultCategoryId);
  const error = update.error ?? finish.error;

  return (
    <>
      <GlassCard className="collect__card">
        <p className="page__kicker">Session started {formatTime(session.startedAt)}</p>
        <p className="collect__where">{where}</p>
        {category ? <p className="page__meta">{category}</p> : null}
        {changing ? (
          <>
            <LocationPicker
              reference={reference}
              value={location}
              onChange={setLocation}
              categoryLabel="Usual category (optional)"
            />
            <div className="page__actions">
              <Button
                disabled={update.isPending}
                onClick={() =>
                  update.mutate(
                    {
                      id: session.id,
                      defaults: {
                        districtId: location.districtId || null,
                        floorId: location.floorId || null,
                        defaultCategoryId: location.categoryId || null,
                      },
                    },
                    { onSuccess: () => setChanging(false) },
                  )
                }
              >
                Save location
              </Button>
              <Button variant="secondary" onClick={() => setChanging(false)}>
                Cancel
              </Button>
            </div>
          </>
        ) : (
          <div className="page__actions">
            <Button variant="secondary" onClick={() => setChanging(true)}>
              Change location
            </Button>
            <Button variant="secondary" disabled={finish.isPending} onClick={() => finish.mutate(session.id)}>
              Finish session
            </Button>
          </div>
        )}
        {error ? (
          <p className="page__error" role="alert">
            {error.message}
          </p>
        ) : null}
      </GlassCard>
      <Button className="collect__new" onClick={() => navigate("/admin/collection/new")}>
        <Plus size={20} aria-hidden="true" /> New shop
      </Button>
    </>
  );
}

/** Forms typed on this phone that haven't reached the server yet. */
function UnsentShops({ reference }: { reference: CollectionReference }) {
  const userId = useCollectorId();
  const unsent = useQuery({
    queryKey: ["collection", "local", userId],
    queryFn: () => localDrafts.list(userId!),
    enabled: userId !== null,
  });

  if (!unsent.data?.length) return null;
  return (
    <div className="collect__section">
      <h2 className="collect__heading">On this phone, not sent yet</h2>
      <ul className="page__list">
        {unsent.data.map((d) => (
          <li key={d.localId}>
            <Link className="collect__row glass" to={`/admin/collection/new?local=${d.localId}`}>
              <span className="collect__booth">{d.form.boothNumber || "No booth"}</span>
              <span className="page__row-title">{d.form.nameZh || d.form.nameEn || d.form.contactName || "Untitled shop"}</span>
              <span className="page__meta">
                {[locationLabel(reference, d.form.districtId, d.form.floorId), d.lastError ? "Not sent" : "Not sent yet"]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SavedShops({ reference }: { reference: CollectionReference }) {
  const drafts = useDrafts();
  return (
    <div className="collect__section">
      <h2 className="collect__heading">Your saved shops</h2>
      {drafts.isPending ? <p className="page__meta">Loading…</p> : null}
      {drafts.isError ? (
        <p className="page__error" role="alert">
          {drafts.error.message}
        </p>
      ) : null}
      {drafts.data?.drafts.length === 0 ? <p className="page__meta">Shops you save appear here.</p> : null}
      {drafts.data?.drafts.length ? (
        <ul className="page__list">
          {drafts.data.drafts.map((d) => (
            <li key={d.id}>
              <Link className="collect__row glass" to={`/admin/drafts/${d.id}`}>
                <span className="collect__booth">{d.boothNumber || "No booth"}</span>
                <span className="page__row-title">{d.nameZh || d.nameEn || "Untitled shop"}</span>
                <span className="page__meta">
                  {[locationLabel(reference, d.districtId, d.floorId), `Saved ${formatTime(d.updatedAt)}`]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
