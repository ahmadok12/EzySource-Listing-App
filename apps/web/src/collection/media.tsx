import { useEffect, useId, useRef, useState, type ChangeEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  CircleAlert,
  CloudUpload,
  FileText,
  ImagePlus,
  LoaderCircle,
  Mic,
  Camera,
  Smartphone,
  Square,
} from "lucide-react";
import {
  purposeKinds,
  uploadResponseSchema,
  type Draft,
  type DraftMedia,
  type MediaKind,
  type MediaPurpose,
  type UpdateMediaInput,
} from "@ezysource/domain";
import { Button } from "../components/Button";
import { Sheet } from "../components/Sheet";
import { TextField } from "../components/TextField";
import { apiDelete, apiGetFile, apiSend } from "../lib/api";
import { limitHint, MediaFileError, prepareFile } from "./prepareMedia";
import { collectionKeys } from "./queries";
import { uploadQueue, type QueuedUpload } from "./uploads";

/**
 * Photos, PDFs and voice notes on a saved shop (specs/04 "Media collection").
 * Every file says honestly where it is: on this phone, uploading, or saved.
 */

type Status = "saved" | "uploading" | "phone" | "failed" | "elsewhere";

type Tile = {
  id: string;
  kind: MediaKind;
  mimeType: string;
  caption: string | null;
  durationMs: number | null;
  status: Status;
  error?: string | undefined;
  /** The copy on this phone, while it hasn't been sent. */
  blob?: Blob;
  server?: DraftMedia;
};

const KIND_OF_TYPE = (type: string): MediaKind =>
  type === "application/pdf" ? "pdf" : type.startsWith("audio/") ? "audio" : "image";

function tilesFor(draft: Draft, queue: readonly QueuedUpload[], purpose: MediaPurpose, contactId: string | null) {
  const local = queue.filter((q) => q.draftId === draft.id && q.purpose === purpose && q.contactId === contactId);
  const localById = new Map(local.map((q) => [q.id, q]));
  const fromLocal = (q: QueuedUpload): Tile => ({
    id: q.id,
    kind: KIND_OF_TYPE(q.mimeType),
    mimeType: q.mimeType,
    caption: q.caption,
    durationMs: q.durationMs,
    status: q.state === "uploading" ? "uploading" : q.state === "failed" ? "failed" : "phone",
    error: q.error,
    blob: q.blob,
  });

  const tiles: Tile[] = draft.media
    .filter((m) => m.purpose === purpose && m.contactId === contactId)
    .map((m) => {
      const q = localById.get(m.id);
      if (m.state !== "validated" && q) return { ...fromLocal(q), server: m };
      return {
        id: m.id,
        kind: m.kind,
        mimeType: m.mimeType,
        caption: m.caption,
        durationMs: m.durationMs,
        status: m.state === "validated" ? "saved" : "elsewhere",
        server: m,
      };
    });
  const shown = new Set(tiles.map((t) => t.id));
  return [...tiles, ...local.filter((q) => !shown.has(q.id)).map(fromLocal)];
}

/** A private file as a local object URL, fetched with the signed-in person's token. */
function useFileUrl(tile: Tile, enabled: boolean) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let objectUrl: string | null = null;
    let cancelled = false;
    setFailed(false);
    const load = tile.blob ? Promise.resolve(tile.blob) : apiGetFile(`/media/${tile.id}/content`);
    load.then(
      (blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      },
      () => !cancelled && setFailed(true),
    );
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setUrl(null);
    };
  }, [tile.id, tile.blob, enabled]);
  return { url, failed };
}

const STATUS_TEXT: Record<Status, string> = {
  saved: "Saved",
  uploading: "Uploading",
  phone: "Saved on this phone",
  failed: "Not sent",
  elsewhere: "Waiting for the phone that took it",
};

function formatDuration(ms: number | null) {
  if (!ms) return "";
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function StatusBadge({ status }: { status: Status }) {
  if (status === "saved") return null;
  const icon =
    status === "uploading" ? (
      <LoaderCircle size={12} className="media__spin" aria-hidden="true" />
    ) : status === "failed" ? (
      <CircleAlert size={12} aria-hidden="true" />
    ) : status === "phone" ? (
      <Smartphone size={12} aria-hidden="true" />
    ) : (
      <CloudUpload size={12} aria-hidden="true" />
    );
  return (
    <span className={`media__badge media__badge--${status}`}>
      {icon} {STATUS_TEXT[status]}
    </span>
  );
}

function TileButton({ tile, cover, onOpen }: { tile: Tile; cover: boolean; onOpen: () => void }) {
  const showImage = tile.kind === "image" && tile.status !== "elsewhere";
  const { url } = useFileUrl(tile, showImage);
  const label =
    tile.kind === "image"
      ? `Photo, ${STATUS_TEXT[tile.status].toLowerCase()}`
      : tile.kind === "pdf"
        ? `PDF, ${STATUS_TEXT[tile.status].toLowerCase()}`
        : `Voice note ${tile.caption ?? ""}, ${STATUS_TEXT[tile.status].toLowerCase()}`;
  return (
    <button type="button" className={`media__tile media__tile--${tile.kind}`} onClick={onOpen} aria-label={label}>
      {tile.kind === "image" ? (
        url ? <img src={url} alt="" className="media__thumb" /> : <span className="media__thumb media__thumb--empty" />
      ) : tile.kind === "pdf" ? (
        <span className="media__doc">
          <FileText size={22} aria-hidden="true" /> PDF
        </span>
      ) : (
        <span className="media__doc">
          <Mic size={20} aria-hidden="true" />
          <span className="media__doc-title">{tile.caption || "Voice note"}</span>
          <span className="page__meta">{formatDuration(tile.durationMs)}</span>
        </span>
      )}
      {cover ? <span className="media__cover">Cover</span> : null}
      <StatusBadge status={tile.status} />
    </button>
  );
}

function useMediaActions(draftId: string) {
  const client = useQueryClient();
  const refresh = () => client.invalidateQueries({ queryKey: collectionKeys.draft(draftId) });
  return {
    update: useMutation({
      mutationFn: ({ mediaId, input }: { mediaId: string; input: UpdateMediaInput }) =>
        apiSend("PATCH", `/drafts/${draftId}/media/${mediaId}`, input, uploadResponseSchema.parse),
      onSuccess: refresh,
    }),
    remove: useMutation({
      mutationFn: (mediaId: string) => apiDelete(`/drafts/${draftId}/media/${mediaId}`),
      onSuccess: refresh,
    }),
  };
}

function TileSheet({
  draftId,
  tile,
  canMakeCover,
  onClose,
}: {
  draftId: string;
  tile: Tile;
  canMakeCover: boolean;
  onClose: () => void;
}) {
  const { update, remove } = useMediaActions(draftId);
  const [confirming, setConfirming] = useState(false);
  const [caption, setCaption] = useState(tile.caption ?? "");
  const viewable = tile.status !== "elsewhere";
  const { url, failed } = useFileUrl(tile, viewable);
  const onServer = tile.status === "saved";
  const error = update.error ?? remove.error;
  const noun = tile.kind === "image" ? "photo" : tile.kind === "pdf" ? "PDF" : "voice note";

  async function removeIt() {
    if (onServer) {
      remove.mutate(tile.id, { onSuccess: onClose });
    } else {
      await uploadQueue.discard(tile.id);
      onClose();
    }
  }

  return (
    <Sheet title={tile.kind === "audio" ? tile.caption || "Voice note" : `This ${noun}`} onClose={onClose}>
      <p className="page__meta">{tile.error ?? STATUS_TEXT[tile.status]}</p>
      {tile.kind === "image" && url ? <img src={url} alt="" className="media__large" /> : null}
      {tile.kind === "audio" && url ? <audio src={url} controls className="media__audio" /> : null}
      {tile.kind === "pdf" && url ? (
        <a className="button button--secondary" href={url} target="_blank" rel="noopener noreferrer">
          Open PDF
        </a>
      ) : null}
      {viewable && !url && !failed ? <p className="page__meta">Loading…</p> : null}
      {failed ? <p className="page__error">Couldn't open this file.</p> : null}

      {onServer && tile.kind === "audio" ? (
        <form
          className="media__caption"
          onSubmit={(e) => {
            e.preventDefault();
            update.mutate({ mediaId: tile.id, input: { caption } });
          }}
        >
          <TextField label="Title" value={caption} onChange={(e) => setCaption(e.target.value)} maxLength={200} />
          <Button type="submit" variant="secondary" disabled={update.isPending || caption === (tile.caption ?? "")}>
            Save title
          </Button>
        </form>
      ) : null}

      {tile.status === "failed" ? (
        <Button
          onClick={() => {
            uploadQueue.retry(tile.id);
            onClose();
          }}
        >
          Try again
        </Button>
      ) : null}
      {canMakeCover && onServer ? (
        <Button
          variant="secondary"
          disabled={update.isPending}
          onClick={() => update.mutate({ mediaId: tile.id, input: { orderIndex: 0 } }, { onSuccess: onClose })}
        >
          Make cover photo
        </Button>
      ) : null}
      {error ? (
        <p className="page__error" role="alert">
          {error.message}
        </p>
      ) : null}

      {tile.status === "uploading" ? null : confirming ? (
        <div className="media__confirm" role="group" aria-label={`Remove this ${noun}?`}>
          <p className="page__row-title">Remove this {noun}?</p>
          <Button onClick={() => void removeIt()} disabled={remove.isPending}>
            {remove.isPending ? "Removing…" : "Remove"}
          </Button>
          <Button variant="secondary" onClick={() => setConfirming(false)}>
            Keep it
          </Button>
        </div>
      ) : (
        <Button variant="secondary" onClick={() => setConfirming(true)}>
          Remove {noun}
        </Button>
      )}
      <Button variant="secondary" onClick={onClose}>
        Close
      </Button>
    </Sheet>
  );
}

/** Phones get a camera button; desktops only choose files (specs/09 "Desktop contains no camera capture action"). */
function useHasCamera() {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(pointer: coarse)").matches
    : false;
}

async function queueFiles(
  files: Iterable<Blob & { name?: string }>,
  target: { draftId: string; purpose: MediaPurpose; contactId: string | null },
  extra: { caption?: string | null; durationMs?: number | undefined } = {},
) {
  const problems: string[] = [];
  for (const file of files) {
    try {
      const prepared = await prepareFile(file, target.purpose, { durationMs: extra.durationMs });
      await uploadQueue.add({ id: crypto.randomUUID(), ...target, caption: extra.caption ?? null, ...prepared });
    } catch (error) {
      const name = file.name ? `${file.name}: ` : "";
      problems.push(name + (error instanceof MediaFileError ? error.message : "Couldn't add this file."));
    }
  }
  return problems;
}

function AddFiles({
  draftId,
  purpose,
  contactId,
  label,
  onProblems,
  single = false,
}: {
  draftId: string;
  purpose: MediaPurpose;
  contactId: string | null;
  label: string;
  onProblems: (problems: string[]) => void;
  /** One small button; on phones the system chooser still offers the camera. */
  single?: boolean;
}) {
  const camera = useRef<HTMLInputElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const hasCamera = useHasCamera() && !single;
  const [busy, setBusy] = useState(false);
  const accept = purposeKinds[purpose].includes("pdf") ? "image/*,application/pdf" : "image/*";

  async function onChange(e: ChangeEvent<HTMLInputElement>) {
    const files = [...(e.target.files ?? [])];
    e.target.value = "";
    if (files.length === 0) return;
    setBusy(true);
    onProblems(await queueFiles(files, { draftId, purpose, contactId }));
    setBusy(false);
  }

  return (
    <div className={single ? "media__add media__add--single" : "media__add"}>
      {hasCamera ? (
        <Button variant="secondary" onClick={() => camera.current?.click()} disabled={busy}>
          <Camera size={18} aria-hidden="true" /> Take photo
        </Button>
      ) : null}
      <Button
        variant="secondary"
        onClick={() => picker.current?.click()}
        disabled={busy}
        aria-label={single ? label : undefined}
      >
        <ImagePlus size={18} aria-hidden="true" /> {hasCamera ? "Choose" : single ? "Add" : label}
      </Button>
      {hasCamera ? (
        <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={(e) => void onChange(e)} />
      ) : null}
      <input
        ref={picker}
        type="file"
        accept={accept}
        multiple
        hidden
        aria-label={label}
        onChange={(e) => void onChange(e)}
      />
    </div>
  );
}

const RECORDING_TYPES = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm", "audio/ogg;codecs=opus"];
const MAX_RECORDING_MS = 5 * 60_000;

type Recording =
  | { state: "idle" }
  | { state: "recording"; startedAt: number }
  | { state: "recorded"; blob: Blob; durationMs: number };

/** Records a voice note on the phone, or uploads one. Stops by itself at 5 minutes. */
function VoiceNotes({ draftId, onProblems }: { draftId: string; onProblems: (problems: string[]) => void }) {
  const supported =
    typeof window !== "undefined" &&
    typeof window.MediaRecorder !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia;
  const [recording, setRecording] = useState<Recording>({ state: "idle" });
  const [elapsed, setElapsed] = useState(0);
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const titleId = useId();

  const stop = () => {
    if (recorder.current && recorder.current.state !== "inactive") recorder.current.stop();
  };

  useEffect(() => {
    if (recording.state !== "recording") return;
    const tick = setInterval(() => {
      const ms = Date.now() - recording.startedAt;
      setElapsed(ms);
      if (ms >= MAX_RECORDING_MS) stop();
    }, 250);
    // A call or switching apps interrupts recording; keep what was captured.
    const onHide = () => document.visibilityState === "hidden" && stop();
    document.addEventListener("visibilitychange", onHide);
    return () => {
      clearInterval(tick);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [recording]);

  useEffect(() => () => stop(), []);

  async function start() {
    setError(null);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError("Allow microphone access to record, or upload a recording instead.");
      return;
    }
    const mimeType = RECORDING_TYPES.find((t) => MediaRecorder.isTypeSupported(t));
    const r = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const chunks: Blob[] = [];
    const startedAt = Date.now();
    r.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);
    r.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(chunks, { type: r.mimeType || mimeType || "audio/webm" });
      setRecording(blob.size > 0 ? { state: "recorded", blob, durationMs: Date.now() - startedAt } : { state: "idle" });
    };
    recorder.current = r;
    r.start(1000);
    setElapsed(0);
    setRecording({ state: "recording", startedAt });
  }

  async function save(blob: Blob, durationMs?: number) {
    const problems = await queueFiles([blob], { draftId, purpose: "voice", contactId: null }, {
      caption: title.trim() || null,
      ...(durationMs ? { durationMs } : {}),
    });
    onProblems(problems);
    if (problems.length === 0) {
      setRecording({ state: "idle" });
      setTitle("");
    }
  }

  return (
    <div className="media__voice">
      {recording.state === "recording" ? (
        <div className="media__recording" role="status">
          <span className="media__dot" aria-hidden="true" /> Recording {formatDuration(elapsed) || "0:00"} of 5:00
          <Button onClick={stop}>
            <Square size={16} aria-hidden="true" /> Stop
          </Button>
        </div>
      ) : recording.state === "recorded" ? (
        <form
          className="media__caption"
          onSubmit={(e) => {
            e.preventDefault();
            void save(recording.blob, recording.durationMs);
          }}
        >
          <p className="page__meta" id={titleId}>
            Recorded {formatDuration(recording.durationMs)}
          </p>
          <TextField label="Title (optional)" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
          <div className="page__actions">
            <Button type="submit">Save voice note</Button>
            <Button variant="secondary" onClick={() => setRecording({ state: "idle" })}>
              Discard
            </Button>
          </div>
        </form>
      ) : (
        <div className="media__add">
          {supported ? (
            <Button variant="secondary" onClick={() => void start()}>
              <Mic size={18} aria-hidden="true" /> Record
            </Button>
          ) : null}
          <Button variant="secondary" onClick={() => picker.current?.click()}>
            <CloudUpload size={18} aria-hidden="true" /> Upload a recording
          </Button>
          <input
            ref={picker}
            type="file"
            accept="audio/*"
            hidden
            aria-label="Upload a recording"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void save(file);
            }}
          />
        </div>
      )}
      {error ? (
        <p className="page__error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** One kind of file on a shop: its tiles, what's allowed, and how to add more. */
export function MediaSection({
  draft,
  queue,
  purpose,
  contactId = null,
  title,
  hint,
  addLabel,
  compact = false,
}: {
  draft: Draft;
  queue: readonly QueuedUpload[];
  purpose: MediaPurpose;
  contactId?: string | null;
  title: string;
  hint?: string;
  addLabel: string;
  compact?: boolean;
}) {
  const tiles = tilesFor(draft, queue, purpose, contactId);
  const [open, setOpen] = useState<string | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const openTile = tiles.find((t) => t.id === open);
  const Heading = compact ? "h4" : "h3";

  return (
    <section className={compact ? "media media--compact" : "media"} aria-label={title}>
      <div className="media__head">
        <Heading className={compact ? "page__meta" : "media__title"}>{title}</Heading>
        {compact ? (
          <AddFiles draftId={draft.id} purpose={purpose} contactId={contactId} label={addLabel} onProblems={setProblems} single />
        ) : (
          <p className="page__meta">{[hint, limitHint(purpose)].filter(Boolean).join(" ")}</p>
        )}
      </div>
      {tiles.length > 0 ? (
        <div className="media__grid">
          {tiles.map((tile, i) => (
            <TileButton
              key={tile.id}
              tile={tile}
              cover={purpose === "overview" && i === 0 && tile.status === "saved"}
              onOpen={() => setOpen(tile.id)}
            />
          ))}
        </div>
      ) : null}
      {problems.length > 0 ? (
        <ul className="page__error media__problems" role="alert">
          {problems.map((p, i) => (
            <li key={i}>{p}</li>
          ))}
        </ul>
      ) : null}
      {compact ? null : purpose === "voice" ? (
        <VoiceNotes draftId={draft.id} onProblems={setProblems} />
      ) : (
        <AddFiles draftId={draft.id} purpose={purpose} contactId={contactId} label={addLabel} onProblems={setProblems} />
      )}
      {openTile ? (
        <TileSheet
          draftId={draft.id}
          tile={openTile}
          canMakeCover={purpose === "overview" && tiles[0]?.id !== openTile.id}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </section>
  );
}

/** What's still on this phone for one shop, in plain words (specs/04 durability states). */
export function UploadNotice({ queue, draftId }: { queue: readonly QueuedUpload[]; draftId?: string }) {
  const mine = draftId ? queue.filter((q) => q.draftId === draftId) : queue;
  const failed = mine.filter((q) => q.state === "failed").length;
  const pending = mine.length - failed;
  if (mine.length === 0) return null;
  const parts: string[] = [];
  if (pending > 0) {
    parts.push(
      `Sending ${pending} ${pending === 1 ? "file" : "files"}. ` +
        (uploadQueue.isDurable()
          ? "They're kept on this phone until they're sent."
          : "This phone can't keep a copy, so keep the app open until they're sent."),
    );
  }
  if (failed > 0) parts.push(`${failed} ${failed === 1 ? "file wasn't" : "files weren't"} sent. Tap a file to try again.`);
  return (
    <p className={failed > 0 ? "page__error" : "collect__status"} role="status">
      {parts.join(" ")}
    </p>
  );
}

/** All of a shop's media, in the order a collector walks up to a booth. */
export function ShopMedia({ draft, queue }: { draft: Draft; queue: readonly QueuedUpload[] }) {
  return (
    <div className="collect__section">
      <h2 className="collect__heading">Photos and notes</h2>
      <UploadNotice queue={queue} draftId={draft.id} />
      <div className="collect__card glass media__card">
        <MediaSection
          draft={draft}
          queue={queue}
          purpose="sign"
          title="Shop sign"
          hint="The name board above the booth."
          addLabel="Add sign photo"
        />
        <MediaSection
          draft={draft}
          queue={queue}
          purpose="overview"
          title="Shop photos"
          hint="Storefront, inside and displays. The first photo is the cover."
          addLabel="Add shop photos"
        />
        <MediaSection
          draft={draft}
          queue={queue}
          purpose="section"
          title="Products"
          hint="Product photos and catalogues."
          addLabel="Add product photos or PDFs"
        />
        <MediaSection
          draft={draft}
          queue={queue}
          purpose="voice"
          title="Voice notes"
          hint="Private to the EzySource team. Subscribers never hear these."
          addLabel="Upload a recording"
        />
      </div>
    </div>
  );
}

/** A contact's business card and chat QR codes, kept with that person (specs/04). */
export function ContactMedia({
  draft,
  queue,
  contactId,
}: {
  draft: Draft;
  queue: readonly QueuedUpload[];
  contactId: string;
}) {
  return (
    <div className="media__contact">
      <MediaSection draft={draft} queue={queue} purpose="card_front" contactId={contactId} title="Business card" addLabel="Add card photo" compact />
      <MediaSection draft={draft} queue={queue} purpose="wechat_qr" contactId={contactId} title="WeChat QR code" addLabel="Add WeChat QR" compact />
      <MediaSection draft={draft} queue={queue} purpose="whatsapp_qr" contactId={contactId} title="WhatsApp QR code" addLabel="Add WhatsApp QR" compact />
    </div>
  );
}
