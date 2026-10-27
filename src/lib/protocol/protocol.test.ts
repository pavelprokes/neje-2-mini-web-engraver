import { describe, expect, it } from 'vitest';
import { CAPTURED } from '@/lib/transport/simulator';
import { packBitmap } from './bitmap';
import { bitmapLength, commands, encodeBurnTime, paddedWidth } from './frames';
import { decodeMessage, FrameParser, fromHex, toHex } from './messages';

const hex = (b: Uint8Array) => toHex(b).toUpperCase();

describe('commands', () => {
  it('match the bytes observed in the vendor app and on hardware', () => {
    expect(hex(commands.identify())).toBe('FF AA 08 01 01 5A A5 55');
    expect(hex(commands.pause())).toBe('FF AA 08 02 01 01 00 55');
    expect(hex(commands.resume())).toBe('FF AA 08 02 01 01 01 55');
    expect(hex(commands.cancel())).toBe('FF AA 08 02 01 01 02 55');
    expect(hex(commands.setBaudRate(250_000))).toBe('FF AA 0A 06 01 00 03 D0 90 55');
    expect(hex(commands.setLaserParams({ burnTimeMs: 7, power: 80, level: 10, sensitivity: 0, mode: 2 }))).toBe('FF AA 0B 03 01 07 50 0A 00 02 55');
    expect(hex(commands.previewOff())).toBe('FF AA 10 05 01 50 00 FF FF FF FF FF FF FF FF 55');
    expect(hex(commands.moveTo(1465, 1599))).toBe('FF AA 10 05 01 50 01 05 B9 06 3F FF FF FF FF 55');
  });

  it('pad the job width to whole bytes in preview and start frames', () => {
    const rect = { x: 300, y: 2, width: 101, height: 50 };
    expect(hex(commands.previewOn(rect))).toBe('FF AA 10 05 01 50 02 01 2C 00 02 00 68 00 32 55');
    // 101 px → 104 px → 13 bytes/row × 50 rows = 650 bytes
    expect(hex(commands.startJob(rect))).toBe('FF AA 14 04 01 01 50 01 2C 00 02 00 68 00 32 00 00 02 8A 55');
  });

  it('encode their own length', () => {
    for (const f of [commands.identify(), commands.startJob({ x: 0, y: 0, width: 8, height: 8 }), commands.previewOff()]) expect(f[2]).toBe(f.length);
  });

  it('reject values the wire format cannot carry', () => {
    expect(() => commands.moveTo(-1, 0)).toThrow(RangeError);
    expect(() => commands.moveTo(70_000, 0)).toThrow(RangeError);
    expect(() => commands.setLaserParams({ burnTimeMs: 7, power: 101, level: 0, sensitivity: 0, mode: 0 })).toThrow(RangeError);
    expect(() => encodeBurnTime(0)).toThrow(RangeError);
    expect(() => encodeBurnTime(241)).toThrow(RangeError);
  });

  it('keep the vendor burn time encoding, identity in range', () => {
    expect(encodeBurnTime(1)).toBe(1);
    expect(encodeBurnTime(240)).toBe(240);
  });
});

describe('decodeMessage', () => {
  it('decodes the info frame of a real Master 2 Mini', () => {
    const m = decodeMessage(CAPTURED.info);
    expect(m).toMatchObject({
      type: 'info',
      info: { modelId: 26, model: 'NEJE Master 2 Mini', firmware: 7, width: 1466, height: 1600, pixelPitchUm: 75, baudRate: 250_000 },
    });
    if (m.type !== 'info') throw new Error();
    expect(m.info.features).toEqual({ heartbeat: true, battery: false, temperature: true, power: true, sensitivity: true, level: true, mode: true });
  });

  it('decodes params, status and telemetry', () => {
    expect(decodeMessage(CAPTURED.params)).toEqual({ type: 'params', params: { burnTimeMs: 7, power: 80, level: 10, sensitivity: 0, mode: 2 } });
    expect(decodeMessage(CAPTURED.status)).toEqual({ type: 'status', state: 'idle' });
    expect(decodeMessage(CAPTURED.telemetry)).toEqual({ type: 'telemetry', temperatureC: 24, batteryPercent: null, chargingCurrentMa: null });
  });

  it('decodes job flow messages', () => {
    expect(decodeMessage(fromHex('ff aa 08 04 01 02 01 55'))).toEqual({ type: 'jobAccepted', accepted: true });
    expect(decodeMessage(fromHex('ff aa 08 04 01 02 00 55'))).toEqual({ type: 'jobAccepted', accepted: false });
    expect(decodeMessage(fromHex('ff aa 08 04 01 03 2a 55'))).toEqual({ type: 'progress', percent: 42 });
    expect(decodeMessage(fromHex('ff aa 08 0c 01 01 00 55'))).toEqual({ type: 'event', event: 'finished', code: 1 });
    expect(decodeMessage(fromHex('ff aa 0b 06 01 01 00 03 d0 90 55'))).toEqual({ type: 'baudRate', ok: true, baudRate: 250_000 });
    expect(decodeMessage(fromHex('ff aa 0a 0d 01 50 00 10 00 20 55'))).toEqual({ type: 'position', y: 16, x: 32 });
  });

  it('reports unknown commands instead of guessing', () => {
    expect(decodeMessage(fromHex('ff aa 0f 00 01 0c 01 f6 54 c6 2a 08 82 9e 55'))).toEqual({ type: 'unknown', cmd: 0 });
  });
});

describe('FrameParser', () => {
  it('reassembles frames split across reads and skips garbage', () => {
    // garbage as seen on hardware after a baud switch / port reopen
    const stream = Uint8Array.from([0x02, 0xc8, 0xff, ...CAPTURED.info, ...CAPTURED.params, 0x91, 0xc8, ...CAPTURED.telemetry]);
    const parser = new FrameParser();
    const types: string[] = [];
    for (let i = 0; i < stream.length; i += 5) for (const f of parser.push(stream.subarray(i, i + 5))) types.push(decodeMessage(f).type);
    expect(types).toEqual(['info', 'params', 'telemetry']);
  });

  it('does not stall on a garbage length byte', () => {
    const parser = new FrameParser();
    expect(parser.push(Uint8Array.from([0xff, 0xaa, 0xc8, ...CAPTURED.telemetry])).map((f) => decodeMessage(f).type)).toEqual(['telemetry']);
  });

  it('recovers from a false header with a bad trailer', () => {
    const parser = new FrameParser();
    expect(parser.push(fromHex('ff aa 08 01 02 03 04 00'))).toEqual([]);
    expect(parser.push(CAPTURED.telemetry).map((f) => decodeMessage(f).type)).toEqual(['telemetry']);
  });
});

describe('packBitmap', () => {
  it('packs even rows MSB first and odd rows reversed', () => {
    const w = 10;
    const dots = new Uint8Array(w * 2);
    dots[0] = dots[9] = dots[w] = dots[w + 9] = 1;
    expect([...packBitmap(dots, w, 2)]).toEqual([0x80, 0x40, 0x02, 0x01]);
  });

  it('fills full rows completely only with the mirrored order', () => {
    const full = new Uint8Array(16).fill(1);
    expect([...packBitmap(full, 8, 2, 'mirror')]).toEqual([0xff, 0xff]);
    expect([...packBitmap(full, 8, 2, 'legacy')]).toEqual([0xff, 0x7f]);
  });

  it('produces exactly the length announced in the start frame', () => {
    expect(packBitmap(new Uint8Array(101 * 50), 101, 50).length).toBe(bitmapLength(101, 50));
    expect(paddedWidth(101)).toBe(104);
    expect(() => packBitmap(new Uint8Array(3), 2, 2)).toThrow(RangeError);
  });
});
