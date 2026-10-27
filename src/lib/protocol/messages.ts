/**
 * Device → host messages: stream framing and decoding into a typed union.
 */
import { FRAME_TRAILER, MIN_FRAME_LENGTH, type LaserParams } from './frames';

/** Longest device frame seen is 0x26; anything far above is garbage, not a frame to wait for. */
export const MAX_FRAME_LENGTH = 64;

export const MODELS: Readonly<Record<number, string>> = {
  1: 'NEJE BL',
  11: 'NEJE KZ',
  13: 'NEJE KFZ',
  14: 'NEJE Master',
  20: 'NEJE KZ',
  21: 'NEJE BL',
  22: 'NEJE Master 1',
  23: 'NEJE Master 2',
  24: 'NEJE Master 2 Plus',
  25: 'NEJE Master 2 Max',
  26: 'NEJE Master 2 Mini',
  27: 'NEJE Master 2S',
  28: 'NEJE Master 2S Plus',
  29: 'NEJE Master 2S Max',
  30: 'NEJE Master 2S Mix',
};

export interface DeviceFeatures {
  readonly heartbeat: boolean;
  readonly battery: boolean;
  readonly temperature: boolean;
  readonly power: boolean;
  readonly sensitivity: boolean;
  readonly level: boolean;
  readonly mode: boolean;
}

export interface DeviceInfo {
  readonly modelId: number;
  /** Human readable model, `undefined` for ids this app does not know. */
  readonly model: string | undefined;
  readonly firmware: number;
  /** Work area in device pixels. */
  readonly width: number;
  readonly height: number;
  /** Size of one device pixel in micrometres. */
  readonly pixelPitchUm: number;
  /** Fastest baud rate the device offers. */
  readonly baudRate: number;
  readonly features: DeviceFeatures;
}

export type MachineState = 'idle' | 'working' | 'paused';

export type DeviceMessage =
  | { readonly type: 'info'; readonly info: DeviceInfo }
  | { readonly type: 'status'; readonly state: MachineState }
  | { readonly type: 'params'; readonly params: LaserParams }
  | { readonly type: 'jobAccepted'; readonly accepted: boolean }
  | { readonly type: 'progress'; readonly percent: number }
  | { readonly type: 'transferComplete' }
  | { readonly type: 'baudRate'; readonly ok: boolean; readonly baudRate: number }
  | {
      readonly type: 'telemetry';
      readonly temperatureC: number | null;
      readonly batteryPercent: number | null;
      readonly chargingCurrentMa: number | null;
    }
  | { readonly type: 'event'; readonly event: 'finished' | 'lowBattery' | 'paused' | 'other'; readonly code: number }
  | { readonly type: 'position'; readonly x: number; readonly y: number }
  /**
   * Sent about once a second while burning (verified on a Master 2 Mini, fw 7): percent done,
   * seconds since the burn began, and the head position relative to the job's top-left corner.
   */
  | { readonly type: 'burnProgress'; readonly percent: number; readonly elapsedSeconds: number; readonly x: number; readonly y: number }
  | { readonly type: 'unknown'; readonly cmd: number };

export type MessageOf<T extends DeviceMessage['type']> = Extract<DeviceMessage, { type: T }>;

/** Default pitch of the Master 2 family, used when a device reports 0. */
export const DEFAULT_PIXEL_PITCH_UM = 75;

/**
 * Splits a raw byte stream into frames. Resynchronises on garbage, which the device emits
 * after baud-rate changes and when the port is reopened.
 */
export class FrameParser {
  private buffer: number[] = [];

  push(chunk: Uint8Array): Uint8Array[] {
    for (const byte of chunk) this.buffer.push(byte);
    const frames: Uint8Array[] = [];
    for (;;) {
      const start = this.findHeader();
      if (start < 0) {
        // keep a trailing 0xFF, it may be the first half of a header split across reads
        this.buffer = this.buffer.at(-1) === 0xff ? [0xff] : [];
        return frames;
      }
      if (start > 0) this.buffer.splice(0, start);
      if (this.buffer.length < 3) return frames;
      const length = this.buffer[2]!;
      if (length < MIN_FRAME_LENGTH || length > MAX_FRAME_LENGTH) {
        this.buffer.shift();
        continue;
      }
      if (this.buffer.length < length) return frames;
      if (this.buffer[length - 1] !== FRAME_TRAILER) {
        this.buffer.shift();
        continue;
      }
      frames.push(Uint8Array.from(this.buffer.splice(0, length)));
    }
  }

  private findHeader(): number {
    for (let i = 0; i < this.buffer.length - 1; i++) if (this.buffer[i] === 0xff && this.buffer[i + 1] === 0xaa) return i;
    return -1;
  }
}

const at = (f: Uint8Array, i: number): number => f[i] ?? 0;
const be16 = (f: Uint8Array, i: number): number => (at(f, i) << 8) | at(f, i + 1);
const be32 = (f: Uint8Array, i: number): number => ((at(f, i) << 24) | (at(f, i + 1) << 16) | (at(f, i + 2) << 8) | at(f, i + 3)) >>> 0;
const unlessUnset = (value: number, unset: number): number | null => (value === unset ? null : value);
const YES = 0x59; // 'Y'

function decodeInfo(f: Uint8Array): DeviceInfo {
  const flag = (i: number) => at(f, i) === YES;
  return {
    modelId: at(f, 5),
    model: MODELS[at(f, 5)],
    firmware: at(f, 7),
    width: be16(f, 8),
    height: be16(f, 10),
    pixelPitchUm: at(f, 16) || DEFAULT_PIXEL_PITCH_UM,
    baudRate: be32(f, 22),
    features: {
      heartbeat: flag(26),
      battery: flag(28),
      temperature: flag(29),
      power: flag(30),
      sensitivity: flag(31),
      level: flag(32),
      mode: flag(33),
    },
  };
}

const EVENTS = { 1: 'finished', 2: 'lowBattery', 3: 'paused' } as const;

export function decodeMessage(f: Uint8Array): DeviceMessage {
  const cmd = at(f, 3);
  switch (cmd) {
    case 0x01:
      return { type: 'info', info: decodeInfo(f) };
    case 0x02: {
      const s = at(f, 6);
      return { type: 'status', state: s === 0 ? 'idle' : s === 2 ? 'paused' : 'working' };
    }
    case 0x03:
      return {
        type: 'params',
        params: { burnTimeMs: at(f, 5), power: at(f, 6), level: at(f, 7), sensitivity: at(f, 8), mode: at(f, 9) },
      };
    case 0x04:
      if (at(f, 5) === 2) return { type: 'jobAccepted', accepted: at(f, 6) === 1 };
      if (at(f, 5) === 3) return { type: 'progress', percent: Math.min(100, at(f, 6)) };
      if (at(f, 5) === 4) return { type: 'transferComplete' };
      break;
    case 0x06:
      return { type: 'baudRate', ok: at(f, 5) === 1, baudRate: be32(f, 6) };
    case 0x0b:
      return {
        type: 'telemetry',
        temperatureC: unlessUnset(at(f, 5), 0xff),
        batteryPercent: unlessUnset(at(f, 6), 0xff),
        chargingCurrentMa: unlessUnset(be16(f, 7), 0xffff),
      };
    case 0x0c: {
      const code = at(f, 5);
      return { type: 'event', event: EVENTS[code as keyof typeof EVENTS] ?? 'other', code };
    }
    case 0x0d:
      // `0d 02 '%' pp 00 ss 00 xx 00 yy`: percent, seconds and job-relative position (BE16 pairs)
      if (at(f, 4) === 0x02 && at(f, 5) === 0x25)
        return { type: 'burnProgress', percent: Math.min(100, at(f, 6)), elapsedSeconds: be16(f, 7), x: be16(f, 9), y: be16(f, 11) };
      if (at(f, 5) === 0x50) return { type: 'position', y: be16(f, 6), x: be16(f, 8) };
      break;
  }
  return { type: 'unknown', cmd };
}

export const toHex = (bytes: Uint8Array): string => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(' ');

export function fromHex(hex: string): Uint8Array<ArrayBuffer> {
  const parts = hex.trim().split(/\s+/);
  return Uint8Array.from(parts, (p) => {
    const v = Number.parseInt(p, 16);
    if (Number.isNaN(v) || v < 0 || v > 0xff) throw new SyntaxError(`invalid hex byte "${p}"`);
    return v;
  });
}
