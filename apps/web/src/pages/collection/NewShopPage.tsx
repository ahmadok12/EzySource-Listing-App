import { useCallback, useEffect, useRef, useState } from "react";
import { useBlocker, useNavigate, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import type { CollectionReference, CollectionSession } from "@ezysource/domain";
import { Button } from "../../components/Button";
import { Sheet } from "../../components/Sheet";
import { ShopFields } from "../../collection/fields";
import { emptyShopForm, hasTyped, locationLabel, toCreateInput, type FieldErrors, type ShopForm } from "../../collection/form";
import { localDrafts, type LocalDraft } from "../../collection/localDrafts";
import { collectionKeys, createDraft, useCollectionContext, useReference } from "../../collection/queries";
import { useCollectorId } from "../../collection/useCollectorId";
import { ApiRequestError } from "../../lib/api";
import "../pages.css";
import "./collection.css";

/** Quick shop form. Resumes an unsent form with ?local=<id>. */
export function NewShopPage() {
  const [params] = useSearchParams();
  const userId = useCollectorId();
  const reference = useReference();
  const context = useCollectionContext();
  const localId = params.get("local");

  const error = reference.error ?? context.error;
  if (error) {
    return (
      <section className="page">
        <h1 className="page__title">New shop</h1>
        <p className="page__error" role="alert">
          {error.message}
        </p>
      </section>
    );
  }
  if (!reference.data || !context.data || !userId) {
    return (
      <section className="page">
        <h1 className="page__title">New shop</h1>
        <p className="page__meta">Loading…</p>
      </section>
    );
  }
  return (
    <NewShopForm
      key={localId ?? "new"}
      resumeId={localId}
      userId={userId}
      reference={reference.data}
      session={context.data.session}
    />
  );
}

type Storage = "checking" | "ok" | "unavailable";
type SendState =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "offline" }
  | { kind: "conflict" }
  | { kind: "failed"; message: string };

function NewShopForm({
  resumeId,
  userId,
  reference,
  session,
}: {
  resumeId: string | null;
  userId: string;
  reference: CollectionReference;
  session: CollectionSession | null;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<ShopForm>(() => emptyShopForm(session));
  const [loaded, setLoaded] = useState(resumeId === null);
  const [missing, setMissing] = useState(false);
  const [storage, setStorage] = useState<Storage>("checking");
  const [localSaved, setLocalSaved] = useState(false);
  const [send, setSend] = useState<SendState>({ kind: "idle" });
  const [errors, setErrors] = useState<FieldErrors>({});
  const ids = useRef<{ localId: string; idempotencyKey: string }>({
    localId: resumeId ?? crypto.randomUUID(),
    idempotencyKey: crypto.randomUUID(),
  });
  const done = useRef(false);
  /** Why the last send failed, kept with every local save so the list can show "Not sent". */
  const lastError = useRef<string | undefined>(undefined);

  const set = useCallback(<K extends keyof ShopForm>(key: K, value: ShopForm[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setLocalSaved(false);
  }, []);

  useEffect(() => {
    void localDrafts.available().then((ok) => setStorage(ok ? "ok" : "unavailable"));
  }, []);

  // Resume an unsent form, only for the person who typed it.
  useEffect(() => {
    if (!resumeId) return;
    void localDrafts
      .get(resumeId, userId)
      .then((record) => {
        if (record) {
          ids.current = { localId: record.localId, idempotencyKey: record.idempotencyKey };
          setForm(record.form);
          setLocalSaved(true);
          lastError.current = record.lastError;
          if (record.lastError) setSend({ kind: "offline" });
        } else {
          setMissing(true);
        }
      })
      .catch(() => setMissing(true))
      .finally(() => setLoaded(true));
  }, [resumeId, userId]);

  const record = useCallback(
    (extra: Partial<LocalDraft> = {}): LocalDraft => ({
      localId: ids.current.localId,
      userId,
      idempotencyKey: ids.current.idempotencyKey,
      sessionId: session?.id ?? null,
      form,
      updatedAt: new Date().toISOString(),
      ...(lastError.current ? { lastError: lastError.current } : {}),
      ...extra,
    }),
    [form, session, userId],
  );

  const typed = hasTyped(form, session);

  // Autosave to this phone shortly after typing stops; never on every keystroke to the server.
  useEffect(() => {
    if (!loaded || storage !== "ok" || !typed || done.current) return;
    const timer = setTimeout(() => {
      void localDrafts
        .put(record())
        .then(() => {
          setLocalSaved(true);
          void queryClient.invalidateQueries({ queryKey: ["collection", "local"] });
        })
        .catch(() => setStorage("unavailable"));
    }, 400);
    return () => clearTimeout(timer);
  }, [loaded, storage, typed, record, queryClient]);

  const save = useCallback(async () => {
    const validated = toCreateInput(form, null);
    if (!validated.ok) {
      setErrors(validated.errors);
      return false;
    }
    setErrors({});
    setSend({ kind: "sending" });
    if (storage === "ok") await localDrafts.put(record()).catch(() => {});
    try {
      const { draft } = await createDraft(validated.input, ids.current.idempotencyKey);
      done.current = true;
      await localDrafts.remove(ids.current.localId).catch(() => {});
      void queryClient.invalidateQueries({ queryKey: collectionKeys.drafts });
      void queryClient.invalidateQueries({ queryKey: ["collection", "local"] });
      navigate(`/admin/drafts/${draft.id}`, { replace: true, state: { saved: true } });
      return true;
    } catch (error) {
      if (!(error instanceof ApiRequestError)) throw error;
      if (error.code === "network") {
        setSend({ kind: "offline" });
        lastError.current = "network";
        if (storage === "ok") await localDrafts.put(record()).catch(() => {});
      } else if (error.code === "conflict") {
        setSend({ kind: "conflict" });
      } else {
        setSend({ kind: "failed", message: error.message });
      }
      return false;
    }
  }, [form, navigate, queryClient, record, storage]);

  // Send automatically when the connection comes back.
  useEffect(() => {
    if (send.kind !== "offline") return;
    const retry = () => void save();
    window.addEventListener("online", retry);
    return () => window.removeEventListener("online", retry);
  }, [send.kind, save]);

  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      !done.current && typed && currentLocation.pathname !== nextLocation.pathname,
  );

  async function discard() {
    await localDrafts.remove(ids.current.localId).catch(() => {});
    void queryClient.invalidateQueries({ queryKey: ["collection", "local"] });
    done.current = true;
    if (blocker.state === "blocked") blocker.proceed();
    else navigate("/admin/collection");
  }

  if (!loaded) return <p className="page__meta">Loading…</p>;

  const where = locationLabel(reference, session?.districtId, session?.floorId);

  return (
    <section className="page collect">
      <div>
        <h1 className="page__title">New shop</h1>
        <p className="page__meta">{session ? `Session · ${where || "no location"}` : "No session started"}</p>
      </div>

      {missing ? (
        <p className="collect__status" role="status">
          That unsent shop isn't on this phone any more. You're starting a new one.
        </p>
      ) : null}

      <form
        className="collect__form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <ShopFields form={form} set={set} errors={errors} reference={reference} withContact />

        <div className="collect__footer">
          <Durability storage={storage} localSaved={localSaved && typed} send={send} />
          {errors._form ? (
            <p className="page__error" role="alert">
              {errors._form}
            </p>
          ) : null}
          {send.kind === "conflict" ? (
            <div className="collect__status" role="alert">
              <p>This shop was already sent with different details. Check your saved shops first.</p>
              <Button
                variant="secondary"
                onClick={() => {
                  ids.current = { ...ids.current, idempotencyKey: crypto.randomUUID() };
                  void save();
                }}
              >
                Save as a new shop
              </Button>
            </div>
          ) : null}
          <Button type="submit" disabled={send.kind === "sending"} className="collect__save">
            {send.kind === "sending" ? "Saving…" : send.kind === "offline" ? "Try again" : "Save shop"}
          </Button>
          {typed ? (
            <button type="button" className="collect__link" onClick={() => void discard()}>
              Discard this shop
            </button>
          ) : null}
        </div>
      </form>

      {blocker.state === "blocked" ? (
        <Sheet title="Save this shop first?" onClose={() => blocker.reset()}>
          <p className="page__meta">
            {storage === "ok"
              ? "It's kept on this phone, but nobody else can see it until it's saved."
              : "This phone can't keep a copy, so leaving now loses what you typed."}
          </p>
          <Button onClick={() => blocker.reset()}>Continue editing</Button>
          <Button
            variant="secondary"
            onClick={() => {
              blocker.reset();
              void save();
            }}
          >
            Save shop
          </Button>
          <Button variant="secondary" onClick={() => void discard()}>
            Discard
          </Button>
        </Sheet>
      ) : null}
    </section>
  );
}

/** Says honestly where the shop is right now (specs/04). */
function Durability({ storage, localSaved, send }: { storage: Storage; localSaved: boolean; send: SendState }) {
  let text: string | null = null;
  if (send.kind === "sending") text = "Saving…";
  else if (send.kind === "offline") {
    text =
      storage === "ok"
        ? "Saved on this phone. It will be sent when you're back online."
        : "Not saved. You're offline and this phone can't keep a copy.";
  } else if (send.kind === "failed") text = send.message;
  else if (storage === "unavailable") text = "This phone can't keep a copy. Save before closing the app.";
  else if (localSaved) text = "Saved on this phone";
  if (!text) return null;
  return (
    <p className={send.kind === "failed" ? "page__error" : "collect__status"} role="status">
      {text}
    </p>
  );
}
