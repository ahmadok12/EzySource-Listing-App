import type { ShopForm } from "./form";

/**
 * Unsent shop forms kept on this device (specs/04 "Recovery and accidental closing").
 * Local storage is recovery, not a backup: callers must check `available()` before
 * telling the collector their work is safe on the phone.
 */
export type LocalDraft = {
  localId: string;
  /** The signed-in person who typed it. Never restored for anyone else. */
  userId: string;
  /** Reused on every retry, so a save that reached the server is never duplicated. */
  idempotencyKey: string;
  sessionId: string | null;
  form: ShopForm;
  updatedAt: string;
  /** Set when a send was attempted and failed. */
  lastError?: string;
};

export interface LocalDraftStore {
  available(): Promise<boolean>;
  list(userId: string): Promise<LocalDraft[]>;
  get(localId: string, userId: string): Promise<LocalDraft | null>;
  put(draft: LocalDraft): Promise<void>;
  remove(localId: string): Promise<void>;
}

const DB_NAME = "ezysource-collector";
const STORE = "draft-forms";

function request<T>(req: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
  });
}

class IndexedDbDraftStore implements LocalDraftStore {
  private db: Promise<IDBDatabase> | null = null;

  private open() {
    this.db ??= new Promise<IDBDatabase>((resolve, reject) => {
      if (typeof indexedDB === "undefined") {
        reject(new Error("IndexedDB is not available"));
        return;
      }
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const store = req.result.createObjectStore(STORE, { keyPath: "localId" });
        store.createIndex("userId", "userId");
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error("Could not open IndexedDB"));
      req.onblocked = () => reject(new Error("IndexedDB is blocked"));
    });
    this.db.catch(() => {
      this.db = null;
    });
    return this.db;
  }

  private async store(mode: IDBTransactionMode) {
    return (await this.open()).transaction(STORE, mode).objectStore(STORE);
  }

  async available() {
    try {
      await this.open();
      // Private browsing and full disks can still refuse writes; probe one.
      const probe = await this.store("readwrite");
      await request(probe.put({ localId: "__probe__", userId: "" }));
      await request((await this.store("readwrite")).delete("__probe__"));
      return true;
    } catch {
      return false;
    }
  }

  async list(userId: string) {
    const index = (await this.store("readonly")).index("userId");
    const rows = (await request(index.getAll(userId))) as LocalDraft[];
    return rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async get(localId: string, userId: string) {
    const row = (await request((await this.store("readonly")).get(localId))) as LocalDraft | undefined;
    return row && row.userId === userId ? row : null;
  }

  async put(draft: LocalDraft) {
    await request((await this.store("readwrite")).put(draft));
  }

  async remove(localId: string) {
    await request((await this.store("readwrite")).delete(localId));
  }
}

export const localDrafts: LocalDraftStore = new IndexedDbDraftStore();
