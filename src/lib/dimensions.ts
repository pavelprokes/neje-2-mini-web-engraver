import type { Point, Rect } from '@/lib/protocol';

/** Distances from a box to the four edges of the work area, in device pixels. */
export interface EdgeDistances {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export interface Dimensions {
  readonly image: (EdgeDistances & { readonly width: number; readonly height: number }) | null;
  readonly head: EdgeDistances | null;
  /**
   * Head relative to the image's top-left corner. Negative when the head is left of or above
   * the image, so (0, 0) means the head sits exactly on the corner the job starts from.
   */
  readonly headToImage: { readonly dx: number; readonly dy: number } | null;
}

/**
 * Dimension lines for the work area: image size and offsets, head offsets, and the head relative
 * to the image. Works for any image aspect ratio; everything is measured on the image box.
 */
export function computeDimensions(area: { width: number; height: number }, image: Rect | null, head: Point | null): Dimensions {
  return {
    image: image && {
      width: image.width,
      height: image.height,
      left: image.x,
      top: image.y,
      right: area.width - (image.x + image.width),
      bottom: area.height - (image.y + image.height),
    },
    head: head && { left: head.x, top: head.y, right: area.width - head.x, bottom: area.height - head.y },
    headToImage: head && image && { dx: head.x - image.x, dy: head.y - image.y },
  };
}
