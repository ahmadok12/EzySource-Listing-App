import { useState } from "react";
import { Link, useBlocker, useLocation, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Check, Plus } from "lucide-react";
import type { Channel, CollectionReference, Draft } from "@ezysource/domain";
import { Button } from "../../components/Button";
import { GlassCard } from "../../components/GlassCard";
import { Sheet } from "../../components/Sheet";
import { ContactFields, ShopFields } from "../../collection/fields";
import {
  categoryName,
  contactInput,
  emptyContact,
  formFromDraft,
  locationLabel,
  toUpdateInput,
  type ContactForm,
  type FieldErrors,
  type ShopForm,
} from "../../collection/form";
import { formatTime } from "../../collection/format";
import { useDraft, useDraftActions, useReference } from "../../collection/queries";
import { ApiRequestError } from "../../lib/api";
import "../pages.css";
import "./collection.css";

const CHANNEL_LABELS: Record<Channel["type"], string> = {
  phone: "Phone",
  email: "Email",
  wechat: "WeChat",
  whatsapp: "WhatsApp",
  website: "Website",
  social: "Social",
};

/** The saved shop, opened right after saving: check it, add contacts, then Next shop. */
export function DraftPage() {
  const { id = "" } = useParams();
  const reference = useReference();
  const draft = useDraft(id);
  const navigate = useNavigate();
  const location = useLocation();
  const justSaved = (location.state as { saved?: boolean } | null)?.saved === true;

  if (draft.isError) {
    const gone = draft.error instanceof ApiRequestError && draft.error.status === 404;
    return (
      <section className="page collect">
        <BackLink />
        <GlassCard className="collect__card" role="status">
          <p className="page__row-title">{gone ? "This shop isn't available to you" : "Couldn't load this shop"}</p>
          <p className="page__meta">
            {gone
              ? "It may have been submitted, or your access to it has ended."
              : draft.error.message}
          </p>
        </GlassCard>
      </section>
    );
  }
  if (!draft.data || !reference.data) {
    return (
      <section className="page collect">
        <BackLink />
        <p className="page__meta">Loading…</p>
      </section>
    );
  }

  const d = draft.data;
  return (
    <section className="page collect">
      <BackLink />
      {justSaved ? (
        <p className="collect__toast" role="status">
          <Check size={16} aria-hidden="true" /> Shop saved
        </p>
      ) : null}
      <div>
        <p className="collect__booth">
          {[locationLabel(reference.data, d.districtId, d.floorId), d.boothNumber && `#${d.boothNumber}`]
            .filter(Boolean)
            .join(" · ") || "No location yet"}
        </p>
        <h1 className="page__title">{d.nameZh || d.nameEn || "Untitled shop"}</h1>
        {d.nameZh && d.nameEn ? <p className="page__lede">{d.nameEn}</p> : null}
        <p className="page__meta">
          Draft · saved {formatTime(d.updatedAt)}
        </p>
      </div>

      <ShopDetails draft={d} reference={reference.data} onReload={() => void draft.refetch()} />
      <Contacts draft={d} onReload={() => void draft.refetch()} />

      <Button className="collect__new" onClick={() => navigate("/admin/collection/new")}>
        <Plus size={20} aria-hidden="true" /> Next shop
      </Button>
    </section>
  );
}

function BackLink() {
  return (
    <Link to="/admin/collection" className="collect__back">
      <ArrowLeft size={18} aria-hidden="true" /> Collection
    </Link>
  );
}

function ConflictNotice({ error, onReload }: { error: Error | null; onReload: () => void }) {
  if (!error) return null;
  if (error instanceof ApiRequestError && error.code === "conflict") {
    return (
      <div className="collect__status" role="alert">
        <p>{error.message}</p>
        <Button variant="secondary" onClick={onReload}>
          Reload
        </Button>
      </div>
    );
  }
  return (
    <p className="page__error" role="alert">
      {error.message}
    </p>
  );
}

function ShopDetails({
  draft,
  reference,
  onReload,
}: {
  draft: Draft;
  reference: CollectionReference;
  onReload: () => void;
}) {
  const { update } = useDraftActions(draft.id);
  const [editing, setEditing] = useState<ShopForm | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const dirty = editing !== null && JSON.stringify(editing) !== JSON.stringify(formFromDraft(draft));
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname,
  );

  function save() {
    if (!editing) return;
    const validated = toUpdateInput(editing, draft);
    if (!validated.ok) {
      setErrors(validated.errors);
      return;
    }
    setErrors({});
    update.mutate(validated.input, { onSuccess: () => setEditing(null) });
  }

  if (editing) {
    return (
      <form
        className="collect__form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <ShopFields
          form={editing}
          set={(key, value) => setEditing((f) => (f ? { ...f, [key]: value } : f))}
          errors={errors}
          reference={reference}
          withContact={false}
        />
        <ConflictNotice
          error={update.error}
          onReload={() => {
            update.reset();
            setEditing(null);
            onReload();
          }}
        />
        <div className="page__actions">
          <Button type="submit" disabled={update.isPending}>
            {update.isPending ? "Saving…" : "Save changes"}
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              update.reset();
              setEditing(null);
            }}
          >
            Cancel
          </Button>
        </div>
        {blocker.state === "blocked" ? (
          <Sheet title="Save your changes?" onClose={() => blocker.reset()}>
            <Button onClick={() => blocker.reset()}>Continue editing</Button>
            <Button
              variant="secondary"
              onClick={() => {
                blocker.reset();
                save();
              }}
            >
              Save changes
            </Button>
            <Button variant="secondary" onClick={() => blocker.proceed()}>
              Discard changes
            </Button>
          </Sheet>
        ) : null}
      </form>
    );
  }

  const facts: Array<[string, string]> = [
    ["Chinese name", draft.nameZh ?? ""],
    ["English name", draft.nameEn ?? ""],
    ["Booth", draft.boothNumber ?? ""],
    ["Location", locationLabel(reference, draft.districtId, draft.floorId)],
    ["Main category", categoryName(reference, draft.categories.find((c) => c.isPrimary)?.id)],
    ["Products", draft.keywords.map((k) => k.keyword).join(", ")],
    ["Company", draft.companyName ?? ""],
    ["Website", draft.sharedChannels.find((c) => c.type === "website")?.value ?? ""],
    ["Description", draft.description ?? ""],
  ];
  const missing = facts.slice(0, 5).filter(([, v]) => !v).map(([k]) => k.toLowerCase());

  return (
    <GlassCard className="collect__card">
      <div className="collect__card-head">
        <h2 className="collect__heading">Shop details</h2>
        <Button variant="secondary" onClick={() => setEditing(formFromDraft(draft))}>
          Edit
        </Button>
      </div>
      <dl className="collect__facts">
        {facts
          .filter(([, v]) => v)
          .map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
      </dl>
      {missing.length > 0 ? <p className="page__meta">Still to add: {missing.join(", ")}.</p> : null}
    </GlassCard>
  );
}

function Contacts({ draft, onReload }: { draft: Draft; onReload: () => void }) {
  const { addContact, updateContact } = useDraftActions(draft.id);
  const [form, setForm] = useState<{ contactId: string | null; values: ContactForm } | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const busy = addContact.isPending || updateContact.isPending;
  const error = addContact.error ?? updateContact.error;

  function open(contactId: string | null) {
    addContact.reset();
    updateContact.reset();
    setErrors({});
    if (!contactId) {
      setForm({ contactId: null, values: emptyContact });
      return;
    }
    const c = draft.contacts.find((x) => x.id === contactId)!;
    const channel = (type: Channel["type"]) => c.channels.find((ch) => ch.type === type)?.value ?? "";
    setForm({
      contactId,
      values: {
        contactName: c.displayName ?? "",
        contactTitle: c.title ?? "",
        phone: channel("phone"),
        wechat: channel("wechat"),
        whatsapp: channel("whatsapp"),
        email: channel("email"),
      },
    });
  }

  function save() {
    if (!form) return;
    const validated = contactInput(form.values);
    if (!validated.ok) {
      setErrors(validated.errors);
      return;
    }
    setErrors({});
    const done = { onSuccess: () => setForm(null) };
    if (form.contactId) {
      // Keep channel types this form doesn't edit, such as social links.
      const kept = draft.contacts
        .find((c) => c.id === form.contactId)!
        .channels.filter((ch) => !["phone", "wechat", "whatsapp", "email"].includes(ch.type))
        .map(({ type, value, label }) => ({ type, value, label }));
      updateContact.mutate(
        {
          contactId: form.contactId,
          input: { expectedVersion: draft.version, ...validated.input, channels: [...validated.input.channels, ...kept] },
        },
        done,
      );
    } else {
      addContact.mutate({ expectedVersion: draft.version, ...validated.input }, done);
    }
  }

  return (
    <div className="collect__section">
      <div className="collect__card-head">
        <h2 className="collect__heading">Contacts</h2>
        {form ? null : (
          <Button variant="secondary" onClick={() => open(null)}>
            Add contact
          </Button>
        )}
      </div>

      {draft.contacts.length === 0 && draft.sharedChannels.filter((c) => c.type !== "website").length === 0 && !form ? (
        <p className="page__meta">No contacts yet.</p>
      ) : null}

      <ul className="page__list">
        {draft.contacts.map((c) => (
          <li key={c.id}>
            <GlassCard className="collect__card">
              <div className="collect__card-head">
                <p className="page__row-title">
                  {c.displayName || "Unnamed contact"}
                  {c.title ? <span className="page__meta"> · {c.title}</span> : null}
                </p>
                {c.isPrimary ? <span className="collect__badge">Main contact</span> : null}
              </div>
              <ChannelList channels={c.channels} />
              <div className="page__actions">
                <Button variant="secondary" onClick={() => open(c.id)} disabled={busy}>
                  Edit
                </Button>
                {c.isPrimary ? null : (
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={() =>
                      updateContact.mutate({
                        contactId: c.id,
                        input: { expectedVersion: draft.version, isPrimary: true },
                      })
                    }
                  >
                    Make main contact
                  </Button>
                )}
              </div>
            </GlassCard>
          </li>
        ))}
      </ul>

      {form ? (
        <form
          className="collect__group glass"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <p className="collect__legend">{form.contactId ? "Edit contact" : "New contact"}</p>
          <ContactFields
            form={form.values}
            set={(key, value) => setForm((f) => (f ? { ...f, values: { ...f.values, [key]: value } } : f))}
            errors={errors}
          />
          {errors._form ? (
            <p className="page__error" role="alert">
              {errors._form}
            </p>
          ) : null}
          <div className="page__actions">
            <Button type="submit" disabled={busy}>
              {busy ? "Saving…" : "Save contact"}
            </Button>
            <Button variant="secondary" onClick={() => setForm(null)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}
      <ConflictNotice
        error={error}
        onReload={() => {
          addContact.reset();
          updateContact.reset();
          setForm(null);
          onReload();
        }}
      />
    </div>
  );
}

function ChannelList({ channels }: { channels: Channel[] }) {
  if (channels.length === 0) return <p className="page__meta">No phone or chat details yet.</p>;
  return (
    <dl className="collect__facts">
      {channels.map((ch) => (
        <div key={ch.id}>
          <dt>{ch.label ? `${CHANNEL_LABELS[ch.type]} (${ch.label})` : CHANNEL_LABELS[ch.type]}</dt>
          <dd>{ch.value}</dd>
        </div>
      ))}
    </dl>
  );
}
