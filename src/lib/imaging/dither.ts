import type { DitherMode } from '@/lib/job';

export interface ToneOptions {
  /** -100…100, added to luminance. */
  readonly brightness: number;
  /** -100…100. */
  readonly contrast: number;
  /** 1…254, luminance below it burns. */
  readonly threshold: number;
  readonly invert: boolean;
  readonly dither: DitherMode;
}

type Kernel = readonly (readonly [dx: number, dy: number, weight: number])[];

const KERNELS: Record<DitherMode, Kernel> = {
  'floyd-steinberg': [
    [1, 0, 7 / 16],
    [-1, 1, 3 / 16],
    [0, 1, 5 / 16],
    [1, 1, 1 / 16],
  ],
  // Atkinson diffuses only 6/8 of the error, which keeps highlights clean and contrast high.
  atkinson: [
    [1, 0, 1 / 8],
    [2, 0, 1 / 8],
    [-1, 1, 1 / 8],
    [0, 1, 1 / 8],
    [1, 1, 1 / 8],
    [0, 2, 1 / 8],
  ],
  threshold: [],
};

/**
 * Converts RGBA pixels to a dot matrix (1 = burn). Transparent pixels count as white,
 * so cut-out logos do not burn their background.
 */
export function toDots(rgba: { width: number; height: number; data: ArrayLike<number> }, options: ToneOptions): Uint8Array {
  const { width, height, data } = rgba;
  const n = width * height;
  const lum = new Float32Array(n);
  // standard contrast curve, maps -100…100 onto the classic -255…255 formula range
  const c = options.contrast * 2.55;
  const factor = (259 * (c + 255)) / (255 * (259 - c));
  for (let i = 0; i < n; i++) {
    const p = i * 4;
    const alpha = (data[p + 3] ?? 255) / 255;
    const y = 0.299 * (data[p] ?? 0) + 0.587 * (data[p + 1] ?? 0) + 0.114 * (data[p + 2] ?? 0);
    let v = y * alpha + 255 * (1 - alpha);
    v = factor * (v - 128) + 128 + options.brightness * 2.55;
    lum[i] = options.invert ? 255 - v : v;
  }

  const kernel = KERNELS[options.dither];
  const dots = new Uint8Array(n);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const value = lum[i]!;
      const burn = value < options.threshold;
      dots[i] = burn ? 1 : 0;
      if (kernel.length === 0) continue;
      const error = value - (burn ? 0 : 255);
      for (const [dx, dy, w] of kernel) {
        const xx = x + dx;
        const yy = y + dy;
        if (xx >= 0 && xx < width && yy < height) lum[yy * width + xx]! += error * w;
      }
    }
  }
  return dots;
}
