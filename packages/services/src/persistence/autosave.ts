const DB_NAME = 'savig-autosave';
const STORE = 'state';
const KEY = 'current';

export interface AutosaveStore {
  save(bytes: Uint8Array): Promise<void>;
  load(): Promise<Uint8Array | null>;
  clear(): Promise<void>;
}

// Autosave must never break the editor: every operation catches and degrades
// (save/clear no-op, load -> null) so a failing IndexedDB just means "no
// recovered draft", not a crash.
export function createAutosaveStore(factory: IDBFactory = indexedDB): AutosaveStore {
  const open = (): Promise<IDBDatabase> =>
    new Promise((resolve, reject) => {
      if (!factory) {
        reject(new Error('IndexedDB unavailable'));
        return;
      }
      const request = factory.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

  const run = <T>(mode: IDBTransactionMode, op: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> =>
    open().then(
      (db) =>
        new Promise<T>((resolve, reject) => {
          const tx = db.transaction(STORE, mode);
          const request = op(tx.objectStore(STORE));
          // Resolve on commit (oncomplete), not on the request's success, so a
          // following read on a new connection sees the durable write.
          tx.oncomplete = () => {
            db.close();
            resolve(request.result);
          };
          tx.onerror = () => {
            db.close();
            reject(tx.error);
          };
          tx.onabort = () => {
            db.close();
            reject(tx.error);
          };
        }),
    );

  return {
    async save(bytes) {
      try {
        await run('readwrite', (store) => store.put(bytes, KEY));
      } catch {
        /* degrade: autosave is best-effort */
      }
    },
    async load() {
      try {
        const value = await run<unknown>('readonly', (store) => store.get(KEY));
        if (value == null) return null;
        // structuredClone in some IndexedDB impls returns a typed array from a
        // different realm, so `instanceof Uint8Array` can be false. Detect via
        // the realm-agnostic ArrayBuffer.isView and copy into a local view.
        if (value instanceof Uint8Array) return value;
        if (ArrayBuffer.isView(value)) return new Uint8Array(value as unknown as ArrayLike<number>);
        return null;
      } catch {
        return null;
      }
    },
    async clear() {
      try {
        await run('readwrite', (store) => store.delete(KEY));
      } catch {
        /* degrade */
      }
    },
  };
}
