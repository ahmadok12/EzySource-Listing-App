import { useEffect, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { uploadResponseSchema, type DraftMedia, type MediaPurpose } from "@ezysource/domain";
import { ApiRequestError, apiPutFile, apiSend } from "../lib/api";
import { objectStore, openCollectorDb, request, UPLOADS } from "./idb";
import { collectionKeys } from "./queries";

/**
 * Files waiting to upload (specs/04 "Upload protocol", specs/08 "IndexedDB queue").
 * Each file is kept on the phone with its target shop and section before anything is
 * sent, so taking the next shop's photos never changes where earlier ones go. The queue
 * runs while the app is open, two files at a time, and resumes when it's reopened.
 */
export type QueuedUpload = {
  /** Stable media ID, made on the phone and reused on every retry. */
  id: string;
  /** Only ever sent for the person who took it. */
  userId: string;
  draftId: string;
  purpose: MediaPurpose;
  contactId: string | null;
  caption: string | null;
  blob: Blob;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  state: "waiting" | "uploading" | "failed";
  error?: string | undefined;
  errorCode?: string | undefined;
  attempts: number;
  /** Earliest time to try again after a temporary failure (ms since epoch). */
  retryAt?: number | undefined;
  /** Set once the upload was restarted under a new ID after the server cancelled it. */
  restarted?: boolean;
  createdAt: string;
};

export type NewUpload = Omit<QueuedUpload, "userId" | "state" | "attempts" | "createdAt">;

export interface UploadStore {
  available(): Promise<boolean>;
  list(userId: string): Promise<QueuedUpload[]>;
  put(item: QueuedUpload): Promise<void>;
  remove(id: string): Promise<void>;
}

export class IndexedDbUploadStore implements UploadStore {
  async available() {
    try {
      await openCollectorDb();
      const probe = new Blob(["probe"]);
      await request((await objectStore(UPLOADS, "readwrite")).put({ id: "__probe__", userId: "", blob: probe }));
      await request((await objectStore(UPLOADS, "readwrite")).delete("__probe__"));
      return true;
    } catch {
      return false;
    }
  }

  async list(userId: string) {
    const index = (await objectStore(UPLOADS, "readonly")).index("userId");
    return (await request(index.getAll(userId))) as QueuedUpload[];
  }

  async put(item: QueuedUpload) {
    await request((await objectStore(UPLOADS, "readwrite")).put(item));
  }

  async remove(id: string) {
    await request((await objectStore(UPLOADS, "readwrite")).delete(id));
  }
}

const CONCURRENCY = 2;
const MAX_ATTEMPTS = 6;

/** Temporary problems are retried with growing, jittered waits; anything else needs a person. */
function isTemporary(error: ApiRequestError) {
  return error.code === "network" || error.status >= 500 || error.status === 429;
}

export class UploadQueue {
  private items = new Map<string, QueuedUpload>();
  private userId: string | null = null;
  private durable = false;
  private listeners = new Set<() => void>();
  private snapshot: readonly QueuedUpload[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;
  /** Called after a file is attached, so screens can reload the shop. */
  onUploaded: (draftId: string, media: DraftMedia) => void = () => {};

  constructor(
    private readonly store: UploadStore,
    private readonly random: () => number = Math.random,
  ) {}

  /** Loads this person's waiting files and starts sending. Switching person drops the previous list. */
  async start(userId: string) {
    if (this.userId === userId) return;
    this.stop();
    this.userId = userId;
    const generation = this.generation;
    this.durable = await this.store.available();
    const saved = this.durable ? await this.store.list(userId).catch(() => []) : [];
    if (generation !== this.generation) return;
    for (const item of saved) {
      // An upload cut off by closing the app, or stopped by signing out, starts again.
      const resume = item.state === "uploading" || (item.state === "failed" && item.errorCode === "unauthenticated");
      this.items.set(item.id, resume ? { ...item, state: "waiting", attempts: 0, retryAt: undefined } : item);
    }
    this.emit();
    this.pump();
  }

  stop() {
    this.generation++;
    this.userId = null;
    this.items.clear();
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.emit();
  }

  /** Whether waiting files survive the app closing. */
  isDurable() {
    return this.durable;
  }

  async add(input: NewUpload) {
    if (!this.userId) throw new Error("Sign in before adding files.");
    const item: QueuedUpload = {
      ...input,
      userId: this.userId,
      state: "waiting",
      attempts: 0,
      createdAt: new Date().toISOString(),
    };
    if (this.durable) {
      // A full phone can refuse the write; the file still uploads while the app stays open.
      await this.store.put(item).catch(() => {
        this.durable = false;
      });
    }
    this.items.set(item.id, item);
    this.emit();
    this.pump();
  }

  retry(id: string) {
    const item = this.items.get(id);
    if (!item || item.state !== "failed") return;
    void this.save({ ...item, state: "waiting", attempts: 0, retryAt: undefined, error: undefined, errorCode: undefined });
    this.pump();
  }

  /** Tries waiting files now, e.g. when the connection comes back. */
  wake() {
    for (const item of this.items.values()) {
      if (item.state === "waiting" && item.retryAt) this.items.set(item.id, { ...item, retryAt: undefined });
    }
    this.emit();
    this.pump();
  }

  async discard(id: string) {
    if (this.items.get(id)?.state === "uploading") return;
    this.items.delete(id);
    this.emit();
    if (this.durable) await this.store.remove(id).catch(() => {});
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.snapshot;

  private emit() {
    this.snapshot = [...this.items.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    for (const listener of this.listeners) listener();
  }

  private async save(item: QueuedUpload) {
    if (item.userId !== this.userId) return;
    this.items.set(item.id, item);
    this.emit();
    if (this.durable) await this.store.put(item).catch(() => {});
  }

  private pump() {
    if (!this.userId) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const now = Date.now();
    let running = this.snapshot.filter((i) => i.state === "uploading").length;
    let nextRetry = Infinity;
    for (const item of this.snapshot) {
      if (item.state !== "waiting") continue;
      if (item.retryAt && item.retryAt > now) {
        nextRetry = Math.min(nextRetry, item.retryAt);
        continue;
      }
      if (running >= CONCURRENCY) break;
      running++;
      void this.run(item);
    }
    if (nextRetry !== Infinity) this.timer = setTimeout(() => this.pump(), nextRetry - now);
  }

  private async run(start: QueuedUpload) {
    const generation = this.generation;
    let item: QueuedUpload = { ...start, state: "uploading" };
    this.items.set(item.id, item);
    this.emit();
    try {
      await apiSend(
        "POST",
        "/uploads/intents",
        {
          id: item.id,
          revisionId: item.draftId,
          purpose: item.purpose,
          contactId: item.contactId,
          caption: item.caption,
          mimeType: item.mimeType,
          sizeBytes: item.sizeBytes,
          sha256: item.sha256,
          width: item.width,
          height: item.height,
          durationMs: item.durationMs,
        },
        uploadResponseSchema.parse,
      );
      const { media } = await apiPutFile(`/uploads/${item.id}/content`, item.blob, item.mimeType, uploadResponseSchema.parse);
      if (generation !== this.generation) return;
      this.items.delete(item.id);
      this.emit();
      if (this.durable) await this.store.remove(item.id).catch(() => {});
      this.onUploaded(item.draftId, media);
    } catch (error) {
      if (generation !== this.generation) return;
      item = this.failed(item, error);
      if (item.id !== start.id) {
        this.items.delete(start.id);
        if (this.durable) await this.store.remove(start.id).catch(() => {});
      }
      await this.save(item);
    } finally {
      if (generation === this.generation) this.pump();
    }
  }

  private failed(item: QueuedUpload, error: unknown): QueuedUpload {
    if (!(error instanceof ApiRequestError)) {
      return { ...item, state: "failed", error: "Something went wrong sending this file. Try again." };
    }
    if (isTemporary(error)) {
      const attempts = item.attempts + 1;
      if (attempts >= MAX_ATTEMPTS) {
        return {
          ...item,
          state: "failed",
          attempts,
          errorCode: error.code,
          error: "Couldn't send this file. Check your connection and try again.",
        };
      }
      const wait = Math.min(60_000, 1000 * 2 ** attempts) * (0.75 + this.random() * 0.5);
      return { ...item, state: "waiting", attempts, retryAt: Date.now() + wait };
    }
    if (error.code === "conflict" && !item.restarted) {
      // The server cancelled this upload (it waited too long); send the same file under a new ID.
      return { ...item, id: crypto.randomUUID(), state: "waiting", attempts: 0, restarted: true };
    }
    const message =
      error.status === 404
        ? "You can't add files to this shop any more."
        : error.code === "unauthenticated"
          ? "Sign in again to send this file."
          : error.message;
    return { ...item, state: "failed", errorCode: error.code, error: message };
  }
}

export const uploadQueue = new UploadQueue(new IndexedDbUploadStore());

if (typeof window !== "undefined") {
  window.addEventListener("online", () => uploadQueue.wake());
}

/**
 * Starts the queue for the signed-in collector and returns every waiting file.
 * Mount it on each collection screen so uploads resume when the app is reopened.
 */
export function useUploadQueue(userId: string | null) {
  const client = useQueryClient();
  useEffect(() => {
    uploadQueue.onUploaded = (draftId) => {
      void client.invalidateQueries({ queryKey: collectionKeys.draft(draftId) });
    };
    if (userId) void uploadQueue.start(userId);
  }, [client, userId]);
  return useSyncExternalStore(uploadQueue.subscribe, uploadQueue.getSnapshot);
}
