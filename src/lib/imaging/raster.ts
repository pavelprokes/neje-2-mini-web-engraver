import { layoutJob, type JobSettings, type WorkArea } from '@/lib/job';
import type { Rect } from '@/lib/protocol';
import type { ImageAsset } from './decode';
import { toDots } from './dither';

export interface Raster {
  /** Where the job sits on the work area, in device pixels. */
  readonly rect: Rect;
  /** One byte per device pixel, 1 = burn. */
  readonly dots: Uint8Array;
  readonly burnedDots: number;
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
  return { rect, dots, burnedDots };
}
