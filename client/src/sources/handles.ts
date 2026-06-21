/**
 * IndexedDB store for File System Access directory handles.
 *
 * A `FileSystemDirectoryHandle` cannot be JSON-serialized into localStorage, but
 * it *is* structured-cloneable, so it survives in IndexedDB across reloads. We
 * keep only the handle here, keyed by an id; the human-facing workspace record
 * (id + name) still lives in localStorage like every other recent.
 *
 * This is the one, deliberate exception to the "localStorage only" rule — it
 * exists solely to remember which local folder you granted access to, so you
 * don't re-pick it on every refresh. See CLAUDE.md.
 */

const DB_NAME = 'lookmd';
const STORE = 'handles';
const VERSION = 1;

export interface HandleRecord {
  id: string;
  name: string;
  handle: FileSystemDirectoryHandle;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = run(t.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        t.oncomplete = () => db.close();
      }),
  );
}

export function putHandle(rec: HandleRecord): Promise<void> {
  return tx('readwrite', (s) => s.put(rec)).then(() => undefined);
}

export async function getHandle(id: string): Promise<HandleRecord | null> {
  try {
    const rec = await tx<HandleRecord | undefined>('readonly', (s) => s.get(id));
    return rec ?? null;
  } catch {
    return null;
  }
}

export function deleteHandle(id: string): Promise<void> {
  return tx('readwrite', (s) => s.delete(id)).then(() => undefined);
}
