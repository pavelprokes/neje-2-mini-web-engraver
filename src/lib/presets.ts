/**
 * Laser presets. Built-ins are NEJE's reference values, a starting point (said so in the UI);
 * user presets live in localStorage of this browser.
 */
import { LIMITS } from '@/lib/job';

export interface Preset {
  readonly id: string;
  /** Built-ins carry an i18n key, user presets a free-form name. */
  readonly label: { readonly key: BuiltInPresetKey } | { readonly name: string };
  readonly power: number;
  readonly burnTimeMs: number;
}

export type BuiltInPresetKey =
  | 'presetWoodPaper'
  | 'presetBamboo'
  | 'presetPlastic'
  | 'presetLeather'
  | 'presetAcrylic'
  | 'presetBone'
  | 'presetPaintedMetal'
  | 'presetRubber';

/** NEJE's reference burning times for the Master 2 family at 100 % power (NEJE wiki, "Setting"). */
export const BUILT_IN_PRESETS: readonly Preset[] = [
  { id: 'wood-paper', label: { key: 'presetWoodPaper' }, power: 100, burnTimeMs: 30 },
  { id: 'bamboo', label: { key: 'presetBamboo' }, power: 100, burnTimeMs: 30 },
  { id: 'plastic', label: { key: 'presetPlastic' }, power: 100, burnTimeMs: 40 },
  { id: 'leather', label: { key: 'presetLeather' }, power: 100, burnTimeMs: 20 },
  { id: 'acrylic', label: { key: 'presetAcrylic' }, power: 100, burnTimeMs: 30 },
  { id: 'bone', label: { key: 'presetBone' }, power: 100, burnTimeMs: 30 },
  { id: 'painted-metal', label: { key: 'presetPaintedMetal' }, power: 100, burnTimeMs: 30 },
  { id: 'rubber', label: { key: 'presetRubber' }, power: 100, burnTimeMs: 50 },
];

const STORAGE_KEY = 'neje.presets.v1';

const inRange = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;

export function loadUserPresets(): Preset[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    if (!Array.isArray(raw)) return [];
    return raw.flatMap((p: Record<string, unknown>) =>
      typeof p?.id === 'string' &&
      typeof p.name === 'string' &&
      inRange(p.power, LIMITS.power.min, LIMITS.power.max) &&
      inRange(p.burnTimeMs, LIMITS.burnTimeMs.min, LIMITS.burnTimeMs.max)
        ? [{ id: p.id, label: { name: p.name.slice(0, 80) }, power: p.power, burnTimeMs: p.burnTimeMs }]
        : [],
    );
  } catch {
    return [];
  }
}

export function saveUserPresets(presets: readonly Preset[]): void {
  const plain = presets.map((p) => ({ id: p.id, name: 'name' in p.label ? p.label.name : '', power: p.power, burnTimeMs: p.burnTimeMs }));
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(plain));
  } catch {
    // storage full or blocked; presets are a convenience
  }
}

// ---- store for useSyncExternalStore: one cached array, shared across components and tabs ----

const EMPTY: readonly Preset[] = [];
let cached: readonly Preset[] | null = null;
const listeners = new Set<() => void>();

export const userPresetStore = {
  subscribe(listener: () => void): () => void {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return;
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
  getSnapshot: (): readonly Preset[] => (cached ??= loadUserPresets()),
  getServerSnapshot: (): readonly Preset[] => EMPTY,
  set(next: readonly Preset[]): void {
    cached = next;
    saveUserPresets(next);
    listeners.forEach((l) => l());
  },
};
