import { afterEach, describe, expect, it } from 'vitest';
import { CAPTURED, SimulatorTransport, type SimulatorOptions } from '@/lib/transport/simulator';
import { packBitmap } from './bitmap';
import { decodeMessage, FrameParser, fromHex } from './messages';
import { NejeError, NejeSession, type SessionSnapshot } from './session';

const sessions: NejeSession[] = [];

function setup(options: SimulatorOptions = {}) {
  const sim = new SimulatorTransport({ heartbeatMs: 20, burnMs: 50, ...options });
  const session = new NejeSession(sim, { chunkSize: 64, identifyTimeoutMs: 200 });
  sessions.push(session);
  return { sim, session };
}

const until = (session: NejeSession, predicate: (s: SessionSnapshot) => boolean, timeoutMs = 2000) =>
  new Promise<SessionSnapshot>((resolve, reject) => {
    const check = () => predicate(session.getSnapshot()) && (unsubscribe(), clearTimeout(timer), resolve(session.getSnapshot()));
    const unsubscribe = session.subscribe(check);
    const timer = setTimeout(() => (unsubscribe(), reject(new Error(`timed out, last snapshot ${JSON.stringify(session.getSnapshot())}`))), timeoutMs);
    check();
  });

/** Command frames the simulator received, decoded by command byte, ignoring raw bitmap data. */
const sentCommands = (sim: SimulatorTransport) =>
  sim.received.filter((b) => b[0] === 0xff && b[1] === 0xaa).map((b) => `${b[3]}:${b[5]}:${b[6]}`);

afterEach(async () => {
  await Promise.all(sessions.splice(0).map((s) => s.close()));
});

describe('NejeSession', () => {
  it('connects and exposes device info, params and telemetry', async () => {
    const { session } = setup();
    const info = await session.connect();
    expect(info.model).toBe('NEJE Master 2 Mini');
    const s = await until(session, (x) => x.params !== null && x.temperatureC !== null);
    expect(s).toMatchObject({ link: 'connected', machine: 'idle', temperatureC: 24, params: { power: 80, burnTimeMs: 7 } });
  });

  it('fails with NO_RESPONSE when nothing answers', async () => {
    const silent = { open() {}, async write() {}, async close() {} };
    const session = new NejeSession(silent, { identifyTimeoutMs: 20, identifyAttempts: 2 });
    await expect(session.connect()).rejects.toMatchObject({ code: 'NO_RESPONSE' });
  });

  it('changes laser params but keeps the device-only ones', async () => {
    const { session } = setup();
    await session.connect();
    await until(session, (s) => s.params !== null);
    const echo = session.waitFor('params', 500);
    await session.setLaserParams({ power: 55 });
    expect((await echo).params).toEqual({ burnTimeMs: 7, power: 55, level: 10, sensitivity: 0, mode: 2 });
  });

  it('runs a job from upload to finish', async () => {
    const { sim, session } = setup();
    await session.connect();
    const rect = { x: 10, y: 20, width: 101, height: 50 };
    await session.engrave(rect, packBitmap(new Uint8Array(101 * 50).fill(1), 101, 50));
    const done = await until(session, (s) => s.job.stage === 'finished');
    expect(done.machine).toBe('idle');
    const payload = sim.received.filter((b) => !(b[0] === 0xff && b[1] === 0xaa)).reduce((n, b) => n + b.length, 0);
    expect(payload).toBe(650);
  });

  it('rejects jobs outside the work area or with a wrong bitmap size', async () => {
    const { session } = setup();
    await session.connect();
    await expect(session.engrave({ x: 1460, y: 0, width: 16, height: 1 }, new Uint8Array(2))).rejects.toMatchObject({ code: 'OUT_OF_BOUNDS' });
    await expect(session.engrave({ x: 0, y: 0, width: 16, height: 1 }, new Uint8Array(3))).rejects.toThrow(RangeError);
  });

  it('surfaces a busy machine', async () => {
    const { session } = setup({ busy: true });
    await session.connect();
    await expect(session.engrave({ x: 0, y: 0, width: 8, height: 1 }, new Uint8Array(1))).rejects.toMatchObject({ code: 'BUSY' });
    expect(session.getSnapshot().job).toEqual({ stage: 'failed', code: 'BUSY' });
  });

  it('stops mid-upload by zero-padding the bitmap before cancelling', async () => {
    const { sim, session } = setup();
    await session.connect();
    const w = 64;
    const h = 64; // 512 bytes = 8 chunks of 64
    const upload = session.engrave({ x: 0, y: 0, width: w, height: h }, packBitmap(new Uint8Array(w * h).fill(1), w, h));
    await until(session, (s) => s.job.stage === 'uploading' && s.job.sent >= 128);
    await session.stop();
    await expect(upload).rejects.toBeInstanceOf(NejeError);

    const data = sim.received.filter((b) => !(b[0] === 0xff && b[1] === 0xaa));
    const total = data.reduce((n, b) => n + b.length, 0);
    expect(total).toBe(512); // the device got exactly what was announced…
    expect(data.at(-1)!.every((b) => b === 0)).toBe(true); // …ending in blank padding
    const lastFrame = sim.received.at(-1)!;
    expect(decodeMessage(new FrameParser().push(lastFrame)[0]!)).toBeDefined();
    expect(sentCommands(sim).slice(-2)).toEqual(['2:1:2', '5:80:0']); // cancel, then preview off
    await until(session, (s) => s.machine === 'idle');
    expect(session.getSnapshot().job.stage).toBe('cancelled');
  });

  it('stop always sends cancel and preview off, even on an idle machine', async () => {
    const { sim, session } = setup();
    await session.connect();
    const before = sim.received.length;
    await session.stop();
    expect(sim.received.slice(before).map((b) => `${b[3]}:${b[5]}:${b[6]}`)).toEqual(['2:1:2', '5:80:0']);
    await new Promise((r) => setTimeout(r, 10));
    expect(session.getSnapshot().job).toEqual({ stage: 'none' }); // the idle "finished" reply is not a finished job
  });

  it('refuses commands while bitmap data is streaming', async () => {
    // a real serial link takes time per chunk; make the simulator do the same
    const sim = new SimulatorTransport({ heartbeatMs: 20, burnMs: 50 });
    const write = sim.write.bind(sim);
    sim.write = async (b) => {
      if (!(b[0] === 0xff && b[1] === 0xaa)) await new Promise((r) => setTimeout(r, 5));
      return write(b);
    };
    const session = new NejeSession(sim, { chunkSize: 64 });
    sessions.push(session);
    await session.connect();
    const upload = session.engrave({ x: 0, y: 0, width: 64, height: 64 }, new Uint8Array(512));
    await until(session, (s) => s.job.stage === 'uploading' && s.job.sent > 0 && s.job.sent < 512);
    await expect(session.setLaserParams({ power: 10 })).rejects.toMatchObject({ code: 'BUSY' });
    await expect(session.pause()).rejects.toMatchObject({ code: 'BUSY' });
    await upload;
  });

  it('a stop before the job is announced keeps it from starting', async () => {
    const { sim, session } = setup();
    await session.connect();
    const upload = session.engrave({ x: 0, y: 0, width: 8, height: 1 }, new Uint8Array(1), { power: 50 });
    await session.stop();
    await expect(upload).rejects.toMatchObject({ code: 'ABORTED' });
    expect(sentCommands(sim).some((c) => c.startsWith('4:'))).toBe(false);
  });

  it('will not start a job during motion or twice', async () => {
    const { session } = setup();
    await session.connect();
    const motion = session.traceSquare(10, { x: 0, y: 0 }, 30);
    await expect(session.engrave({ x: 0, y: 0, width: 8, height: 1 }, new Uint8Array(1))).rejects.toMatchObject({ code: 'BUSY' });
    await motion;
    const first = session.engrave({ x: 0, y: 0, width: 8, height: 1 }, new Uint8Array(1));
    await expect(session.engrave({ x: 0, y: 0, width: 8, height: 1 }, new Uint8Array(1))).rejects.toMatchObject({ code: 'BUSY' });
    await first;
  });

  it('a job that is never accepted is drained with zeros and cancelled', async () => {
    const written: Uint8Array[] = [];
    let deliver: (b: Uint8Array) => void = () => {};
    const mute = {
      open: (onData: (b: Uint8Array) => void) => (deliver = onData),
      async write(b: Uint8Array) {
        written.push(b.slice());
        if (b[3] === 0x01) queueMicrotask(() => deliver(CAPTURED.info)); // answers identify only
      },
      async close() {},
    };
    const session = new NejeSession(mute, { jobAcceptTimeoutMs: 20, chunkSize: 4 });
    await session.connect();
    await expect(session.engrave({ x: 0, y: 0, width: 16, height: 4 }, new Uint8Array(8).fill(0xff))).rejects.toMatchObject({ code: 'TIMEOUT' });
    const raw = written.filter((b) => !(b[0] === 0xff && b[1] === 0xaa));
    expect(raw.reduce((n, b) => n + b.length, 0)).toBe(8);
    expect(raw.every((b) => b.every((x) => x === 0))).toBe(true); // never the real image
    expect(written.at(-1)![3]).toBe(0x02); // cancel
  });

  it('close() stops a running job before releasing the port', async () => {
    const { sim, session } = setup({ burnMs: 5000 });
    await session.connect();
    await session.engrave({ x: 0, y: 0, width: 8, height: 1 }, new Uint8Array(1));
    await session.close();
    expect(sentCommands(sim).slice(-2)).toEqual(['2:1:2', '5:80:0']);
  });

  it('stop switches an active preview off', async () => {
    const { sim, session } = setup();
    await session.connect();
    await session.previewOn({ x: 0, y: 0, width: 10, height: 10 });
    expect(session.getSnapshot().previewing).toBe(true);
    await session.stop();
    expect(session.getSnapshot().previewing).toBe(false);
    expect(sentCommands(sim).at(-1)).toBe('5:80:0');
  });

  it('traces a square with move commands only and can be stopped', async () => {
    const { sim, session } = setup();
    await session.connect();
    const before = sim.received.length;
    expect(await session.traceSquare(67, { x: 0, y: 0 }, 1)).toBe(true);
    const moves = sim.received.slice(before).map((b) => [...b]);
    expect(moves.every((b) => b[3] === 0x05 && b[6] === 1)).toBe(true); // move only, never preview (2) or a job
    expect(moves.map((b) => [(b[7]! << 8) | b[8]!, (b[9]! << 8) | b[10]!])).toEqual([[0, 0], [67, 0], [67, 67], [0, 67], [0, 0]]);

    const interrupted = session.traceSquare(67, { x: 0, y: 0 }, 50);
    await session.stop();
    expect(await interrupted).toBe(false);
  });

  it('tracks the head position from homing, moves, tracing and device reports', async () => {
    const { sim, session } = setup();
    await session.connect();
    expect(session.getSnapshot().head).toBeNull();
    await session.home();
    expect(session.getSnapshot().head).toEqual({ x: 0, y: 0 });
    await session.moveTo(120, 40);
    expect(session.getSnapshot().head).toEqual({ x: 120, y: 40 });
    await session.traceSquare(10, { x: 0, y: 0 }, 1);
    expect(session.getSnapshot().head).toEqual({ x: 0, y: 0 });
    await session.previewOn({ x: 16, y: 24, width: 8, height: 8 });
    expect(session.getSnapshot().head).toBeNull(); // the device moves it along the frame
    await session.previewOff();
    expect(session.getSnapshot().head).toEqual({ x: 16, y: 24 }); // parked at the frame corner
    await session.stop();
    await session.home();
    await session.engrave({ x: 0, y: 0, width: 8, height: 1 }, new Uint8Array(1));
    expect(session.getSnapshot().head).toBeNull();
    // position reports during a burn are not trusted: their reference frame is unverified
    sim.emit(fromHex('ff aa 0b 0d 01 50 00 10 00 20 55'));
    await new Promise((r) => setTimeout(r, 0));
    expect(session.getSnapshot().head).toBeNull();
  });

  it('starts a job straight after switching a trace off, without a parking move', async () => {
    const { sim, session } = setup();
    await session.connect();
    await session.previewOn({ x: 16, y: 24, width: 8, height: 8 });
    const before = sim.received.length;
    await session.engrave({ x: 0, y: 0, width: 8, height: 1 }, new Uint8Array(1));
    const frames = sim.received.slice(before).filter((b) => b[0] === 0xff && b[1] === 0xaa).map((b) => `${b[3]}:${b[6]}`);
    expect(frames).toEqual(['5:0', '4:80']); // preview off, then start job: no move in between
  });

  it('an emergency stop during a trace does not move the head', async () => {
    const { sim, session } = setup();
    await session.connect();
    await session.previewOn({ x: 16, y: 24, width: 8, height: 8 });
    const before = sim.received.length;
    await session.stop();
    expect(sim.received.slice(before).map((b) => `${b[3]}:${b[6]}`)).toEqual(['2:2', '5:0']);
    await session.previewOff(); // nothing left to park at
    expect(sim.received.slice(before).some((b) => b[3] === 0x05 && b[6] === 1)).toBe(false);
  });

  it('flags a device that stops sending its heartbeat, and recovers', async () => {
    let deliver: (b: Uint8Array) => void = () => {};
    const device = {
      open: (onData: (b: Uint8Array) => void) => (deliver = onData),
      async write(b: Uint8Array) {
        if (b[3] === 0x01) queueMicrotask(() => deliver(CAPTURED.info)); // info says: heartbeat supported
      },
      async close() {},
    };
    const session = new NejeSession(device, { silenceTimeoutMs: 40 });
    sessions.push(session);
    await session.connect();
    expect(session.getSnapshot().responsive).toBe(true);
    await until(session, (s) => !s.responsive, 1000); // board hung: the port stays open, nothing arrives
    expect(session.getSnapshot().link).toBe('connected');
    deliver(CAPTURED.telemetry);
    expect(session.getSnapshot().responsive).toBe(true);
  });

  it('marks the link closed when the cable is pulled', async () => {
    const { sim, session } = setup();
    await session.connect();
    sim.unplug();
    expect(session.getSnapshot()).toMatchObject({ link: 'closed', closeReason: 'DISCONNECTED' });
    await expect(session.pause()).rejects.toMatchObject({ code: 'NOT_READY' });
  });
});
