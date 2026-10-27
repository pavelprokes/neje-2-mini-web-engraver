import { layoutJob, type JobSettings, type WorkArea } from '@/lib/job';
import { paddedWidth, type Rect } from '@/lib/protocol';
import type { ImageAsset } from './decode';
import { toDots } from './dither';

export interface Raster {
  /** Where the job sits on the work area, in device pixels. */
  readonly rect: Rect;
  /** One byte per device pixel, 1 = burn. */
  readonly dots: Uint8Array;
  readonly burnedDots: number;
  /**
   * Tight box around the dots that will actually burn (blank margins trimmed), in device pixels.
   * `null` when nothing burns. This is what "trace frame" outlines.
   */
  readonly burnBounds: Rect | null;
}

/** Bounding box of the non-zero dots of a `width`-wide matrix, offset by `origin`. */
export function dotBounds(dots: Uint8Array, width: number, origin: { x: number; y: number } = { x: 0, y: 0 }): Rect | null {
  const height = dots.length / width;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      if (!dots[row + x]) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      maxY = y;
    }
  }
  if (maxX < 0) return null;
  return { x: origin.x + minX, y: origin.y + minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/**
 * The device traces and burns byte-padded widths, so a narrow box near the right edge must
 * shift left to stay inside the work area.
 */
export function fitPadded(rect: Rect, area: { width: number }): Rect {
  const overflow = rect.x + paddedWidth(rect.width) - area.width;
  return overflow > 0 ? { ...rect, x: Math.max(0, rect.x - overflow) } : rect;
}

/** Renders the motif at device resolution with rotation, mirroring and tone settings applied. */
export function renderRaster(asset: ImageAsset, settings: JobSettings, area: WorkArea): Raster {
  const rect = layoutJob(settings, asset, area);
  const { width, height } = rect;
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('2D canvas is not available');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  ctx.translate(width / 2, height / 2);
  ctx.rotate((settings.rotation * Math.PI) / 180);
  if (settings.mirrored) ctx.scale(-1, 1);
  const sideways = settings.rotation === 90 || settings.rotation === 270;
  const [w, h] = sideways ? [height, width] : [width, height];
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(asset.source, -w / 2, -h / 2, w, h);
  const dots = toDots(ctx.getImageData(0, 0, width, height), settings);
  let burnedDots = 0;
  for (const d of dots) burnedDots += d;
  return { rect, dots, burnedDots, burnBounds: dotBounds(dots, width, rect) };
}
