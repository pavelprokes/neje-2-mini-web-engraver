/**
 * Turns any user-supplied file into something drawable. Raster formats go through
 * `createImageBitmap` (PNG, JPEG, WebP, GIF, BMP, AVIF, ICO…). SVG stays vector and is only
 * rasterised at the final job resolution, so it is always sharp.
 */

export interface ImageAsset {
  readonly source: CanvasImageSource;
  readonly width: number;
  readonly height: number;
  readonly kind: 'raster' | 'vector';
  /** Releases decoded pixels / object URLs. */
  dispose(): void;
}

export class ImageDecodeError extends Error {
  constructor(readonly fileName: string) {
    super(`cannot decode "${fileName}"`);
    this.name = 'ImageDecodeError';
  }
}

export const ACCEPTED_TYPES = 'image/*,.svg,.svgz';

const SVG_FALLBACK_SIZE = 1000;

export const isSvg = (file: Blob & { name?: string }): boolean => file.type === 'image/svg+xml' || /\.svgz?$/i.test(file.name ?? '');

/**
 * Gives an SVG an explicit pixel size so browsers report an intrinsic size when decoding it.
 * Width/height may be missing, percentages or units, in which case the viewBox decides.
 */
export function normalizeSvg(markup: string): { markup: string; width: number; height: number } {
  const doc = new DOMParser().parseFromString(markup, 'image/svg+xml');
  const svg = doc.documentElement;
  if (svg.nodeName.toLowerCase() !== 'svg' || doc.getElementsByTagName('parsererror').length > 0) throw new SyntaxError('not an SVG document');
  const box = (svg.getAttribute('viewBox') ?? '').split(/[\s,]+/).map(Number);
  const hasBox = box.length === 4 && box.every(Number.isFinite) && box[2]! > 0 && box[3]! > 0;
  const plain = (attr: string): number | null => {
    const raw = svg.getAttribute(attr)?.trim() ?? '';
    return /^\d+(\.\d+)?(px)?$/.test(raw) ? Number.parseFloat(raw) : null;
  };
  let width = plain('width');
  let height = plain('height');
  if (hasBox) {
    const ratio = box[3]! / box[2]!;
    if (width === null && height === null) [width, height] = [box[2]!, box[3]!];
    else if (width === null) width = height! / ratio;
    else if (height === null) height = width * ratio;
  }
  width ??= SVG_FALLBACK_SIZE;
  height ??= SVG_FALLBACK_SIZE;
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  if (!hasBox) svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  return { markup: new XMLSerializer().serializeToString(svg), width, height };
}

export async function decodeImage(file: Blob & { name?: string }): Promise<ImageAsset> {
  const name = file.name ?? 'image';
  try {
    if (isSvg(file)) {
      const { markup, width, height } = normalizeSvg(await file.text());
      const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml' }));
      const image = new Image();
      image.src = url;
      try {
        await image.decode();
      } catch (error) {
        URL.revokeObjectURL(url);
        throw error;
      }
      return { source: image, width, height, kind: 'vector', dispose: () => URL.revokeObjectURL(url) };
    }
    const bitmap = await createImageBitmap(file);
    return { source: bitmap, width: bitmap.width, height: bitmap.height, kind: 'raster', dispose: () => bitmap.close() };
  } catch {
    throw new ImageDecodeError(name);
  }
}
