/**
 * The collector's on-device database (specs/08 "IndexedDB queue"). One database holds
 * unsent shop forms and files waiting to upload; both are scoped to the signed-in person.
 */
const DB_NAME = "ezysource-collector";
const VERSION = 2;

export const DRAFT_FORMS = "draft-forms";
export const UPLOADS = "uploads";

export function request<T>(req: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
  });
}

let opening: Promise<IDBDatabase> | null = null;

export function openCollectorDb(): Promise<IDBDatabase> {
  opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is not available"));
      return;
    }
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(DRAFT_FORMS)) {
        db.createObjectStore(DRAFT_FORMS, { keyPath: "localId" }).createIndex("userId", "userId");
      }
      if (!db.objectStoreNames.contains(UPLOADS)) {
        db.createObjectStore(UPLOADS, { keyPath: "id" }).createIndex("userId", "userId");
      }
    };
    req.onsuccess = () => {
      // Another tab upgrading the database closes this connection; reopen next time.
      req.result.onversionchange = () => {
        req.result.close();
        opening = null;
      };
      resolve(req.result);
    };
    req.onerror = () => reject(req.error ?? new Error("Could not open IndexedDB"));
    req.onblocked = () => reject(new Error("IndexedDB is blocked"));
  });
  opening.catch(() => {
    opening = null;
  });
  return opening;
}

export async function objectStore(name: string, mode: IDBTransactionMode) {
  return (await openCollectorDb()).transaction(name, mode).objectStore(name);
}
