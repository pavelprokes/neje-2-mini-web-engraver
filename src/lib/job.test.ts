import { describe, expect, it } from 'vitest';
import { toDots } from './imaging/dither';
import { computeDimensions } from './dimensions';
import { dotBounds, fitPadded } from './imaging/raster';
import { paddedWidth } from './protocol';
import { DEFAULT_JOB_SETTINGS, DEFAULT_WORK_AREA, estimateSeconds, layoutJob, mmToPx, parseJobSettings, pxToMm } from './job';

const area = DEFAULT_WORK_AREA; // 1466 × 1600 px at 75 µm

describe('units', () => {
  it('converts between millimetres and device pixels', () => {
    expect(mmToPx(75, area)).toBe(1000);
    expect(pxToMm(1466, area)).toBe(110);
  });
});

describe('layoutJob', () => {
  const s = { ...DEFAULT_JOB_SETTINGS, widthMm: 30 };

  it('keeps the aspect ratio and respects rotation', () => {
    expect(layoutJob(s, { width: 200, height: 100 }, area)).toEqual({ x: 0, y: 0, width: 400, height: 200 });
    expect(layoutJob({ ...s, rotation: 90 }, { width: 200, height: 100 }, area)).toEqual({ x: 0, y: 0, width: 400, height: 800 });
  });

  it('shrinks to fit and clamps the position into the work area', () => {
    const r = layoutJob({ ...s, widthMm: 500, xMm: 999, yMm: 999 }, { width: 100, height: 200 }, area);
    expect(r.height).toBe(1600);
    expect(r.width).toBe(800);
    expect(r.y + r.height).toBe(area.height);
    expect(r.x + paddedWidth(r.width)).toBeLessThanOrEqual(area.width);
  });

  it('keeps the byte-padded width inside the area (1466 px is not a multiple of 8)', () => {
    const r = layoutJob({ ...s, widthMm: 999, xMm: 999 }, { width: 1000, height: 10 }, area);
    expect(r.width).toBe(1464);
    expect(r.x + paddedWidth(r.width)).toBeLessThanOrEqual(area.width);
  });
});

describe('parseJobSettings', () => {
  it('accepts valid settings unchanged', () => {
    expect(parseJobSettings(DEFAULT_JOB_SETTINGS)).toEqual(DEFAULT_JOB_SETTINGS);
  });

  it('repairs anything untrusted field by field', () => {
    const parsed = parseJobSettings({ widthMm: -5, power: 900, rotation: 45, dither: 'magic', invert: 'yes', burnTimeMs: 12.6, oddRows: 'legacy' });
    expect(parsed).toMatchObject({ widthMm: 1, power: 100, rotation: 0, dither: 'floyd-steinberg', invert: false, burnTimeMs: 13, oddRows: 'legacy' });
    expect(parseJobSettings(null)).toEqual(DEFAULT_JOB_SETTINGS);
    expect(parseJobSettings('nope')).toEqual(DEFAULT_JOB_SETTINGS);
  });
});

describe('toDots', () => {
  const tone = { brightness: 0, contrast: 0, threshold: 128, invert: false, dither: 'threshold' } as const;
  const px = (...rgba: number[]) => ({ width: rgba.length / 4, height: 1, data: rgba });

  it('burns dark pixels, never transparent or white ones', () => {
    const image = px(0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 0, 30, 30, 30, 255);
    expect([...toDots(image, tone)]).toEqual([1, 0, 0, 1]);
    expect([...toDots(image, { ...tone, invert: true })]).toEqual([0, 1, 1, 0]);
  });

  it('brightness and contrast move pixels across the threshold', () => {
    const grey = px(120, 120, 120, 255);
    expect([...toDots(grey, tone)]).toEqual([1]);
    expect([...toDots(grey, { ...tone, brightness: 10 })]).toEqual([0]);
    expect([...toDots(px(140, 140, 140, 255), { ...tone, contrast: -100 })]).toEqual([0]);
  });

  it.each(['floyd-steinberg', 'atkinson'] as const)('%s renders 50 %% grey as roughly half the dots', (dither) => {
    const n = 64 * 64;
    const data = new Uint8Array(n * 4).map((_, i) => (i % 4 === 3 ? 255 : 128));
    const burned = toDots({ width: 64, height: 64, data }, { ...tone, dither }).reduce((a, b) => a + b, 0);
    expect(burned / n).toBeGreaterThan(0.4);
    expect(burned / n).toBeLessThan(0.6);
  });
});

describe('estimateSeconds', () => {
  it('counts dwell time only', () => expect(estimateSeconds(1000, 10)).toBe(10));
});

describe('trace bounds', () => {
  it('trims blank margins and offsets to the job position', () => {
    // 6×4 matrix, dots at (2,1) and (4,2)
    const dots = new Uint8Array(24);
    dots[1 * 6 + 2] = dots[2 * 6 + 4] = 1;
    expect(dotBounds(dots, 6, { x: 100, y: 50 })).toEqual({ x: 102, y: 51, width: 3, height: 2 });
    expect(dotBounds(new Uint8Array(24), 6)).toBeNull();
  });

  it('shifts a padded box back inside the work area', () => {
    expect(fitPadded({ x: 1460, y: 0, width: 3, height: 1 }, area)).toEqual({ x: 1458, y: 0, width: 3, height: 1 }); // 1458 + 8 = 1466
    expect(fitPadded({ x: 10, y: 0, width: 3, height: 1 }, area)).toEqual({ x: 10, y: 0, width: 3, height: 1 });
  });
});

describe('computeDimensions', () => {
  const box = { width: 1466, height: 1600 };

  it('measures the image and the head against all edges', () => {
    const d = computeDimensions(box, { x: 100, y: 200, width: 400, height: 300 }, { x: 50, y: 250 });
    expect(d.image).toEqual({ width: 400, height: 300, left: 100, top: 200, right: 966, bottom: 1100 });
    expect(d.head).toEqual({ left: 50, top: 250, right: 1416, bottom: 1350 });
    expect(d.headToImage).toEqual({ dx: -50, dy: 50 }); // head left of the image, inside its height
  });

  it('is zero when the head sits on the image corner, and skips what is unknown', () => {
    expect(computeDimensions(box, { x: 10, y: 20, width: 8, height: 8 }, { x: 10, y: 20 }).headToImage).toEqual({ dx: 0, dy: 0 });
    expect(computeDimensions(box, null, { x: 1, y: 2 })).toMatchObject({ image: null, headToImage: null });
    expect(computeDimensions(box, { x: 0, y: 0, width: 8, height: 8 }, null)).toMatchObject({ head: null, headToImage: null });
  });
});
