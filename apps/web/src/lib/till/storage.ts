// Copyright (c) 2026, Rademics. All rights reserved.
// The till's own database (pos-offline plan §2): a small key-value store on
// the browser's built-in IndexedDB, never cookies. Written by us with no extra
// library. The engine only sees the KeyValueStore interface, so tests run on
// the in-memory store below.

export interface KeyValueStore {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
  /** All entries whose key starts with the prefix, in key order. */
  entries<T>(prefix: string): Promise<[string, T][]>;
}

/** Keeps values in memory (tests, and browsers without IndexedDB). Values are copied like IndexedDB does. */
export class MemoryStore implements KeyValueStore {
  readonly data = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | undefined> {
    const v = this.data.get(key);
    return v === undefined ? undefined : (structuredClone(v) as T);
  }

  async set<T>(key: string, value: T): Promise<void> {
    this.data.set(key, structuredClone(value));
  }

  async delete(key: string): Promise<void> {
    this.data.delete(key);
  }

  async entries<T>(prefix: string): Promise<[string, T][]> {
    return [...this.data.keys()]
      .filter((k) => k.startsWith(prefix))
      .sort()
      .map((k) => [k, structuredClone(this.data.get(k)) as T]);
  }
}

const OBJECT_STORE = "kv";

function promised<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("The till database failed"));
  });
}

/** IndexedDB-backed store; one database per till so two tills on one computer never mix. */
export class IndexedDbStore implements KeyValueStore {
  private db: Promise<IDBDatabase> | null = null;

  constructor(private readonly name: string) {}

  private open(): Promise<IDBDatabase> {
    if (!this.db) {
      this.db = new Promise((resolve, reject) => {
        const req = indexedDB.open(this.name, 1);
        req.onupgradeneeded = () => {
          if (!req.result.objectStoreNames.contains(OBJECT_STORE)) req.result.createObjectStore(OBJECT_STORE);
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error("Cannot open the till database"));
        req.onblocked = () => reject(new Error("The till database is open in another window; close it"));
      });
      this.db.catch(() => {
        this.db = null;
      });
    }
    return this.db;
  }

  private async tx(mode: IDBTransactionMode): Promise<IDBObjectStore> {
    const db = await this.open();
    return db.transaction(OBJECT_STORE, mode).objectStore(OBJECT_STORE);
  }

  async get<T>(key: string): Promise<T | undefined> {
    return (await promised((await this.tx("readonly")).get(key))) as T | undefined;
  }

  /** Resolves only when the write is committed to disk, so "saved before use" really holds. */
  private async write(run: (store: IDBObjectStore) => void): Promise<void> {
    const store = await this.tx("readwrite");
    await new Promise<void>((resolve, reject) => {
      const t = store.transaction;
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error ?? new Error("Saving on the till failed"));
      t.onabort = () => reject(t.error ?? new Error("Saving on the till failed"));
      run(store);
    });
  }

  async set<T>(key: string, value: T): Promise<void> {
    await this.write((s) => s.put(value, key));
  }

  async delete(key: string): Promise<void> {
    await this.write((s) => s.delete(key));
  }

  async entries<T>(prefix: string): Promise<[string, T][]> {
    const store = await this.tx("readonly");
    const range = IDBKeyRange.bound(prefix, `${prefix}￿`);
    const [keys, values] = await Promise.all([promised(store.getAllKeys(range)), promised(store.getAll(range))]);
    return keys.map((k, i) => [String(k), values[i] as T]);
  }
}

/** The store for a till on this computer: IndexedDB when the browser has it. */
export function tillStore(tillId: string): KeyValueStore {
  if (typeof indexedDB === "undefined") return new MemoryStore();
  return new IndexedDbStore(`retail-erp-till-${tillId}`);
}
