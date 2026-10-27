/**
 * Job history: motif + settings, kept in IndexedDB (images are too large for localStorage).
 * Data stays in the user's browser. All functions reject if IndexedDB is unavailable
 * (e.g. some private-browsing modes); callers treat history as optional.
 */
import { parseJobSettings, type JobSettings } from '@/lib/job';

const DB_NAME = 'neje-web-engraver';
const STORE = 'history';
export const HISTORY_LIMIT = 100;

export interface HistoryEntry {
  readonly id: number;
  readonly createdAt: number;
  readonly name: string;
  readonly asset: Blob;
  readonly thumbnail: Blob;
  readonly settings: JobSettings;
}

let db: Promise<IDBDatabase> | null = null;

function database(): Promise<IDBDatabase> {
  db ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  db.catch(() => (db = null));
  return db;
}

async function run<T>(mode: IDBTransactionMode, op: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const conn = await database();
  return new Promise((resolve, reject) => {
    const tx = conn.transaction(STORE, mode);
    const request = op(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function listHistory(): Promise<HistoryEntry[]> {
  const rows = await run('readonly', (s) => s.getAll() as IDBRequest<Record<string, unknown>[]>);
  return rows
    .filter((r) => typeof r.id === 'number' && r.asset instanceof Blob && r.thumbnail instanceof Blob)
    .map((r) => ({
      id: r.id as number,
      createdAt: typeof r.createdAt === 'number' ? r.createdAt : 0,
      name: typeof r.name === 'string' ? r.name : '',
      asset: r.asset as Blob,
      thumbnail: r.thumbnail as Blob,
      settings: parseJobSettings(r.settings),
    }))
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function addHistory(entry: Omit<HistoryEntry, 'id' | 'createdAt'>): Promise<void> {
  await run('readwrite', (s) => s.add({ ...entry, createdAt: Date.now() }));
  const all = await listHistory();
  await Promise.all(all.slice(HISTORY_LIMIT).map((old) => removeHistory(old.id)));
}

export async function removeHistory(id: number): Promise<void> {
  await run('readwrite', (s) => s.delete(id));
}
