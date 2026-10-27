/**
 * Host → device command frames of the NEJE "new" serial protocol used by the Master 2 family.
 *
 * Wire format: `FF AA <len> <cmd> <sub> <payload…> 55`, where `len` is the total frame length.
 * Multi-byte fields are big-endian. There is no checksum. See docs/PROTOCOL.md.
 */

export type Bytes = Uint8Array<ArrayBuffer>;

export const FRAME_HEADER = [0xff, 0xaa] as const;
export const FRAME_TRAILER = 0x55;
/** Smallest valid frame: header (2) + len + cmd + sub + trailer. */
export const MIN_FRAME_LENGTH = 6;

export const Command = {
  Identify: 0x01,
  JobControl: 0x02,
  LaserParams: 0x03,
  StartJob: 0x04,
  Position: 0x05,
  BaudRate: 0x06,
} as const;

/** Pixel rectangle in device coordinates (origin top-left). */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface LaserParams {
  /** Dwell time per dot in milliseconds, 1–240. */
  readonly burnTimeMs: number;
  /** Laser power (PWM duty) in percent, 0–100. */
  readonly power: number;
  /** Idle pointer brightness, device specific scale. */
  readonly level: number;
  /** Motion-detection sensitivity, device specific scale. */
  readonly sensitivity: number;
  /** Speed mode, device specific value. */
  readonly mode: number;
}

export const MAX_BURN_TIME_MS = 240;

function u8(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 0 || value > 0xff) throw new RangeError(`${name} must be an integer 0–255, got ${value}`);
  return value;
}

function be16(value: number, name: string): [number, number] {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff) throw new RangeError(`${name} must be an integer 0–65535, got ${value}`);
  return [value >> 8, value & 0xff];
}

function be32(value: number, name: string): [number, number, number, number] {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) throw new RangeError(`${name} must be a uint32, got ${value}`);
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

export function buildFrame(cmd: number, sub: number, payload: readonly number[] = []): Bytes {
  const length = payload.length + MIN_FRAME_LENGTH;
  return Uint8Array.from([...FRAME_HEADER, u8(length, 'frame length'), cmd, sub, ...payload, FRAME_TRAILER]);
}

/** Rows are bit-packed, so the device works with widths rounded up to whole bytes. */
export const paddedWidth = (width: number): number => Math.ceil(width / 8) * 8;

/** Bytes of bitmap payload the device expects for a job of the given size. */
export const bitmapLength = (width: number, height: number): number => (paddedWidth(width) * height) / 8;

/**
 * Burn time encoding copied from the vendor app: `(t + ⌊t/255⌋) & 0xFF`.
 * It is the identity for the supported range, which is why the range stops at 240 ms.
 */
export function encodeBurnTime(ms: number): number {
  if (!Number.isInteger(ms) || ms < 1 || ms > MAX_BURN_TIME_MS) throw new RangeError(`burn time must be 1–${MAX_BURN_TIME_MS} ms, got ${ms}`);
  return (ms + Math.floor(ms / 255)) & 0xff;
}

const rectFields = (r: Rect): number[] => [
  ...be16(r.x, 'x'),
  ...be16(r.y, 'y'),
  ...be16(paddedWidth(r.width), 'width'),
  ...be16(r.height, 'height'),
];

const NONE16 = [0xff, 0xff] as const;
const POSITION_TARGET = 0x50; // 'P'

export const commands = {
  identify: (): Bytes => buildFrame(Command.Identify, 1, [0x5a, 0xa5]),
  pause: (): Bytes => buildFrame(Command.JobControl, 1, [1, 0]),
  resume: (): Bytes => buildFrame(Command.JobControl, 1, [1, 1]),
  cancel: (): Bytes => buildFrame(Command.JobControl, 1, [1, 2]),

  setLaserParams: (p: LaserParams): Bytes => {
    if (!Number.isInteger(p.power) || p.power < 0 || p.power > 100) throw new RangeError(`power must be 0–100 %, got ${p.power}`);
    return buildFrame(Command.LaserParams, 1, [
      encodeBurnTime(p.burnTimeMs),
      p.power,
      u8(p.level, 'level'),
      u8(p.sensitivity, 'sensitivity'),
      u8(p.mode, 'mode'),
    ]);
  },

  setBaudRate: (baud: number): Bytes => buildFrame(Command.BaudRate, 1, be32(baud, 'baud rate')),

  /** Traces the job outline with the weak pointer laser. */
  previewOn: (r: Rect): Bytes => buildFrame(Command.Position, 1, [POSITION_TARGET, 2, ...rectFields(r)]),
  previewOff: (): Bytes => buildFrame(Command.Position, 1, [POSITION_TARGET, 0, ...NONE16, ...NONE16, ...NONE16, ...NONE16]),
  /** Moves the head to a device pixel position. */
  moveTo: (x: number, y: number): Bytes =>
    buildFrame(Command.Position, 1, [POSITION_TARGET, 1, ...be16(x, 'x'), ...be16(y, 'y'), ...NONE16, ...NONE16]),

  /** Announces a job; the device answers with a job-accepted message before the bitmap is streamed. */
  startJob: (r: Rect): Bytes =>
    buildFrame(Command.StartJob, 1, [1, POSITION_TARGET, ...rectFields(r), ...be32(bitmapLength(r.width, r.height), 'bitmap length')]),
} as const;
