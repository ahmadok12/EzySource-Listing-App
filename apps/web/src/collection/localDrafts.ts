import type { ShopForm } from "./form";
import { DRAFT_FORMS, objectStore, openCollectorDb, request } from "./idb";

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

class IndexedDbDraftStore implements LocalDraftStore {
  private store(mode: IDBTransactionMode) {
    return objectStore(DRAFT_FORMS, mode);
  }

  async available() {
    try {
      await openCollectorDb();
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
