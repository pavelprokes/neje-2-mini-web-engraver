import { describe, expect, it } from 'vitest';
import { toDots } from './imaging/dither';
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
