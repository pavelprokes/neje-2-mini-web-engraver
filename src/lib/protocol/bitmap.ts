import { bitmapLength, paddedWidth, type Bytes } from './frames';

/**
 * Bit order of odd rows. The device scans in a serpentine, so odd rows are sent reversed.
 * `mirror` is the exact reversal of the even-row order. `legacy` reproduces the table in the
 * vendor app (`01 02 04 08 10 10 20 40`), which looks like a typo: it can never set the top bit.
 * Kept selectable until a calibration burn confirms what the firmware expects.
 */
export type OddRowOrder = 'mirror' | 'legacy';

const EVEN_ROW = [0x80, 0x40, 0x20, 0x10, 0x08, 0x04, 0x02, 0x01] as const;
const ODD_ROW: Record<OddRowOrder, readonly number[]> = {
  mirror: [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80],
  legacy: [0x01, 0x02, 0x04, 0x08, 0x10, 0x10, 0x20, 0x40],
};

/**
 * Packs a dot matrix (one byte per pixel, non-zero = burn) into the device bitmap layout:
 * rows padded to whole bytes, even rows MSB-first, odd rows reversed.
 */
export function packBitmap(dots: Uint8Array, width: number, height: number, oddRows: OddRowOrder = 'mirror'): Bytes {
  if (dots.length !== width * height) throw new RangeError(`expected ${width * height} dots, got ${dots.length}`);
  const rowBytes = paddedWidth(width) / 8;
  const out = new Uint8Array(bitmapLength(width, height));
  const odd = ODD_ROW[oddRows];
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      if (!dots[row + x]) continue;
      if (y % 2 === 0) out[y * rowBytes + (x >> 3)]! |= EVEN_ROW[x & 7]!;
      else out[(y + 1) * rowBytes - 1 - (x >> 3)]! |= odd[x & 7]!;
    }
  }
  return out;
}
