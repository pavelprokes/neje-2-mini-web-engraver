import { MAX_BURN_TIME_MS, paddedWidth, type OddRowOrder, type Rect } from '@/lib/protocol';

export type DitherMode = 'floyd-steinberg' | 'atkinson' | 'threshold';
export type Rotation = 0 | 90 | 180 | 270;

/**
 * Everything that defines a job except the motif itself. Stored with history entries, so
 * swapping the image keeps all of it. Bump `version` and extend `parseJobSettings` on change.
 */
export interface JobSettings {
  readonly version: 1;
  readonly widthMm: number;
  readonly xMm: number;
  readonly yMm: number;
  readonly rotation: Rotation;
  readonly mirrored: boolean;
  readonly brightness: number;
  readonly contrast: number;
  readonly threshold: number;
  readonly dither: DitherMode;
  readonly invert: boolean;
  readonly power: number;
  readonly burnTimeMs: number;
  readonly oddRows: OddRowOrder;
}

export interface WorkArea {
  readonly width: number;
  readonly height: number;
  readonly pixelPitchUm: number;
}

/** NEJE Master 2 Mini, used until a device reports its own geometry. */
export const DEFAULT_WORK_AREA: WorkArea = { width: 1466, height: 1600, pixelPitchUm: 75 };

export const LIMITS = {
  widthMm: { min: 1, max: 1000 },
  brightness: { min: -100, max: 100 },
  contrast: { min: -100, max: 100 },
  threshold: { min: 1, max: 254 },
  power: { min: 1, max: 100 },
  burnTimeMs: { min: 1, max: MAX_BURN_TIME_MS },
} as const;

export const DEFAULT_JOB_SETTINGS: JobSettings = {
  version: 1,
  widthMm: 40,
  xMm: 0,
  yMm: 0,
  rotation: 0,
  mirrored: false,
  brightness: 0,
  contrast: 0,
  threshold: 128,
  dither: 'floyd-steinberg',
  invert: false,
  power: 80,
  burnTimeMs: 10,
  oddRows: 'mirror',
};

const DITHER_MODES: readonly DitherMode[] = ['floyd-steinberg', 'atkinson', 'threshold'];
const ROTATIONS: readonly Rotation[] = [0, 90, 180, 270];

export const mmToPx = (mm: number, area: WorkArea): number => Math.round((mm * 1000) / area.pixelPitchUm);
export const pxToMm = (px: number, area: WorkArea): number => Math.round(((px * area.pixelPitchUm) / 1000) * 10) / 10;

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

function num(value: unknown, fallback: number, min: number, max: number, integer = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return clamp(integer ? Math.round(value) : value, min, max);
}

/** Validates settings from untrusted storage, falling back to defaults field by field. */
export function parseJobSettings(input: unknown): JobSettings {
  const o = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>;
  const d = DEFAULT_JOB_SETTINGS;
  return {
    version: 1,
    widthMm: num(o.widthMm, d.widthMm, LIMITS.widthMm.min, LIMITS.widthMm.max),
    xMm: num(o.xMm, d.xMm, 0, 10_000),
    yMm: num(o.yMm, d.yMm, 0, 10_000),
    rotation: ROTATIONS.includes(o.rotation as Rotation) ? (o.rotation as Rotation) : d.rotation,
    mirrored: typeof o.mirrored === 'boolean' ? o.mirrored : d.mirrored,
    brightness: num(o.brightness, d.brightness, LIMITS.brightness.min, LIMITS.brightness.max, true),
    contrast: num(o.contrast, d.contrast, LIMITS.contrast.min, LIMITS.contrast.max, true),
    threshold: num(o.threshold, d.threshold, LIMITS.threshold.min, LIMITS.threshold.max, true),
    dither: DITHER_MODES.includes(o.dither as DitherMode) ? (o.dither as DitherMode) : d.dither,
    invert: typeof o.invert === 'boolean' ? o.invert : d.invert,
    power: num(o.power, d.power, LIMITS.power.min, LIMITS.power.max, true),
    burnTimeMs: num(o.burnTimeMs, d.burnTimeMs, LIMITS.burnTimeMs.min, LIMITS.burnTimeMs.max, true),
    oddRows: o.oddRows === 'legacy' ? 'legacy' : 'mirror',
  };
}

/**
 * Resolves settings and the motif's aspect ratio into a device pixel rectangle that fits the
 * work area. Width wins; height follows the aspect ratio; both shrink to fit; position clamps.
 * The byte-padded width (what the device actually scans) always stays inside the area.
 */
export function layoutJob(settings: JobSettings, source: { width: number; height: number }, area: WorkArea): Rect {
  const sideways = settings.rotation === 90 || settings.rotation === 270;
  const aspect = sideways ? source.width / source.height : source.height / source.width;
  // the device receives byte-padded rows, so the padded width is what has to fit
  const maxWidth = Math.floor(area.width / 8) * 8;
  let width = clamp(mmToPx(settings.widthMm, area), 1, maxWidth);
  let height = Math.max(1, Math.round(width * aspect));
  if (height > area.height) {
    height = area.height;
    width = clamp(Math.round(height / aspect), 1, maxWidth);
  }
  return {
    x: clamp(mmToPx(settings.xMm, area), 0, area.width - paddedWidth(width)),
    y: clamp(mmToPx(settings.yMm, area), 0, area.height - height),
    width,
    height,
  };
}

/**
 * Rough job duration: dwell time per burned dot only. Head travel is ignored, so real jobs
 * take longer; good enough to tell seconds from hours.
 */
export const estimateSeconds = (burnedDots: number, burnTimeMs: number): number => (burnedDots * burnTimeMs) / 1000;
