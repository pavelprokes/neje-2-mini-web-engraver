/**
 * A localStorage-backed value usable with React's `useSyncExternalStore`: the server snapshot
 * is a fixed default (static HTML), the client reads storage, and other tabs stay in sync.
 */
export interface LocalStore<T> {
  subscribe(listener: () => void): () => void;
  getSnapshot(): T;
  getServerSnapshot(): T;
  set(value: T): void;
}

export function createLocalStore<T>(key: string, fallback: T, parse: (raw: unknown) => T | undefined): LocalStore<T> {
  let cached: { value: T } | null = null;
  const listeners = new Set<() => void>();

  const read = (): T => {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : (parse(JSON.parse(raw)) ?? fallback);
    } catch {
      return fallback;
    }
  };

  return {
    subscribe(listener) {
      const onStorage = (e: StorageEvent) => {
        if (e.key !== key) return;
        cached = null;
        listener();
      };
      listeners.add(listener);
      window.addEventListener('storage', onStorage);
      return () => {
        listeners.delete(listener);
        window.removeEventListener('storage', onStorage);
      };
    },
    getSnapshot: () => (cached ??= { value: read() }).value,
    getServerSnapshot: () => fallback,
    set(value) {
      cached = { value };
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch {
        // not persisted, still applies to this page view
      }
      listeners.forEach((l) => l());
    },
  };
}

export const motionTestOnConnect = createLocalStore('neje.motionTestOnConnect.v1', true, (v) => (typeof v === 'boolean' ? v : undefined));


export const dimensionsVisible = createLocalStore('neje.dimensions.v1', false, (v) => (typeof v === 'boolean' ? v : undefined));
