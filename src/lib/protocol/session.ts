import { bitmapLength, commands, paddedWidth, type Bytes, type LaserParams, type Rect } from './frames';
import { decodeMessage, FrameParser, type DeviceInfo, type DeviceMessage, type MachineState, type MessageOf } from './messages';

/** Byte transport to one device. Implemented by Web Serial, the simulator and the test bridge. */
export interface Transport {
  write(data: Bytes): Promise<void>;
  /** Registers the only consumer. `onClose` fires once if the link drops without `close()`. */
  open(onData: (chunk: Uint8Array) => void, onClose: (reason?: unknown) => void): void;
  close(): Promise<void>;
}

export type NejeErrorCode = 'NO_RESPONSE' | 'BUSY' | 'TIMEOUT' | 'ABORTED' | 'DISCONNECTED' | 'NOT_READY' | 'OUT_OF_BOUNDS';

export class NejeError extends Error {
  constructor(
    readonly code: NejeErrorCode,
    message: string = code,
  ) {
    super(message);
    this.name = 'NejeError';
  }
}

export type JobProgress =
  | { readonly stage: 'none' }
  | { readonly stage: 'uploading'; readonly sent: number; readonly total: number }
  | { readonly stage: 'burning'; readonly percent: number }
  | { readonly stage: 'finished' }
  | { readonly stage: 'cancelled' }
  | { readonly stage: 'failed'; readonly code: NejeErrorCode };

export interface SessionSnapshot {
  readonly link: 'connecting' | 'connected' | 'closed';
  readonly info: DeviceInfo | null;
  readonly params: LaserParams | null;
  readonly machine: MachineState;
  readonly temperatureC: number | null;
  readonly batteryPercent: number | null;
  readonly previewing: boolean;
  /**
   * Last commanded head position in device pixels, `null` while unknown. The device never
   * reports where the head is outside a job, so this is tracked from the moves sent; jobs and
   * frame tracing move the head on their own and reset it to unknown until the next `home()`.
   */
  readonly head: Point | null;
  readonly job: JobProgress;
  /** Set when the link closed unexpectedly. */
  readonly closeReason: NejeErrorCode | null;
  /**
   * False when a device that promises a heartbeat has been silent for too long. The USB bridge
   * keeps the port alive even when the engraver's board is off or hung, so silence is the only sign.
   */
  readonly responsive: boolean;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** The laser parameters a user controls; the rest stay at their device values. */
export type LaserParamsPatch = Partial<Pick<LaserParams, 'power' | 'burnTimeMs'>>;

export type TrafficListener = (direction: 'tx' | 'rx', bytes: Uint8Array) => void;

export interface SessionOptions {
  /** Bitmap upload chunk size; the vendor app uses 2 KiB for Master devices. */
  readonly chunkSize?: number;
  readonly identifyTimeoutMs?: number;
  readonly identifyAttempts?: number;
  readonly jobAcceptTimeoutMs?: number;
  /** Silence after which a heartbeat device counts as unresponsive. */
  readonly silenceTimeoutMs?: number;
}

interface Waiter {
  match(m: DeviceMessage): boolean;
  resolve(m: DeviceMessage): void;
}

const INITIAL: SessionSnapshot = {
  link: 'connecting',
  info: null,
  params: null,
  machine: 'idle',
  temperatureC: null,
  batteryPercent: null,
  previewing: false,
  head: null,
  job: { stage: 'none' },
  closeReason: null,
  responsive: true,
};

/** Firmware defaults reported by a factory Master 2 Mini, used until the device reports its own. */
const FALLBACK_PARAMS: LaserParams = { burnTimeMs: 10, power: 100, level: 10, sensitivity: 0, mode: 2 };

/**
 * One connection to an engraver. Owns protocol state and exposes it as an immutable snapshot
 * (compatible with React's `useSyncExternalStore`).
 */
export class NejeSession {
  private readonly parser = new FrameParser();
  private readonly listeners = new Set<() => void>();
  private readonly traffic = new Set<TrafficListener>();
  private waiters: Waiter[] = [];
  private snapshot: SessionSnapshot = INITIAL;
  private upload: { readonly controller: AbortController; readonly done: Promise<void> } | null = null;
  private motion: AbortController | null = null;
  private streaming = false;
  /** Corner of the frame being traced; the head is parked there when tracing stops. */
  private traceOrigin: Point | null = null;
  private readonly chunkSize: number;
  private readonly identifyTimeoutMs: number;
  private readonly identifyAttempts: number;
  private readonly silenceTimeoutMs: number;
  private lastRx = 0;
  private watchdog: ReturnType<typeof setInterval> | undefined;
  private readonly jobAcceptTimeoutMs: number;

  constructor(
    private readonly transport: Transport,
    options: SessionOptions = {},
  ) {
    this.chunkSize = options.chunkSize ?? 2048;
    this.identifyTimeoutMs = options.identifyTimeoutMs ?? 1500;
    this.identifyAttempts = options.identifyAttempts ?? 3;
    this.jobAcceptTimeoutMs = options.jobAcceptTimeoutMs ?? 5000;
    this.silenceTimeoutMs = options.silenceTimeoutMs ?? 4000;
    transport.open(
      (chunk) => this.receive(chunk),
      () => this.linkLost(),
    );
  }

  // ---- store -------------------------------------------------------------------------------

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getSnapshot = (): SessionSnapshot => this.snapshot;

  onTraffic(listener: TrafficListener): () => void {
    this.traffic.add(listener);
    return () => this.traffic.delete(listener);
  }

  private update(patch: Partial<SessionSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const l of this.listeners) l();
  }

  // ---- receiving ---------------------------------------------------------------------------

  private receive(chunk: Uint8Array): void {
    this.lastRx = Date.now();
    if (!this.snapshot.responsive) this.update({ responsive: true });
    for (const l of this.traffic) l('rx', chunk);
    for (const frame of this.parser.push(chunk)) this.handle(decodeMessage(frame));
  }

  private handle(m: DeviceMessage): void {
    switch (m.type) {
      case 'info':
        this.update({ info: m.info });
        break;
      case 'params':
        this.update({ params: m.params });
        break;
      case 'status':
        this.update({ machine: m.state });
        break;
      case 'telemetry':
        this.update({ temperatureC: m.temperatureC, batteryPercent: m.batteryPercent });
        break;
      case 'progress':
        // late progress reports after a stop must not revive the job
        if (this.snapshot.job.stage !== 'cancelled') this.update({ job: { stage: 'burning', percent: m.percent }, machine: 'working' });
        break;
      case 'event':
        if (m.event === 'finished') {
          // only a job that was actually running can finish; a cancel on an idle machine also says "finished"
          const { stage } = this.snapshot.job;
          this.update({ machine: 'idle', job: stage === 'uploading' || stage === 'burning' ? { stage: 'finished' } : this.snapshot.job });
        }
        if (m.event === 'paused' || m.event === 'lowBattery') this.update({ machine: 'paused' });
        break;
    }
    const pending = this.waiters;
    this.waiters = [];
    for (const w of pending) {
      if (w.match(m)) w.resolve(m);
      else this.waiters.push(w);
    }
  }

  private startWatchdog(): void {
    clearInterval(this.watchdog);
    this.watchdog = setInterval(
      () => {
        // the device may stay quiet while it swallows bitmap data
        const silent = Date.now() - this.lastRx > this.silenceTimeoutMs && !this.streaming;
        if (silent && this.snapshot.responsive) this.update({ responsive: false });
      },
      Math.max(50, this.silenceTimeoutMs / 4),
    );
  }

  private linkLost(): void {
    clearInterval(this.watchdog);
    if (this.snapshot.link === 'closed') return;
    this.upload?.controller.abort();
    this.motion?.abort();
    this.traceOrigin = null;
    this.update({ link: 'closed', closeReason: 'DISCONNECTED', previewing: false });
    // release the port so a reconnect can open it again
    void this.transport.close().catch(() => undefined);
  }

  /** Resolves with the next matching message. Register before sending the request it answers. */
  waitFor<T extends DeviceMessage['type']>(type: T, timeoutMs: number, where: (m: MessageOf<T>) => boolean = () => true): Promise<MessageOf<T>> {
    return new Promise((resolve, reject) => {
      const waiter: Waiter = {
        match: (m) => m.type === type && where(m as MessageOf<T>),
        resolve: (m) => {
          clearTimeout(timer);
          resolve(m as MessageOf<T>);
        },
      };
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w !== waiter);
        reject(new NejeError('TIMEOUT', `no "${type}" message within ${timeoutMs} ms`));
      }, timeoutMs);
      this.waiters.push(waiter);
    });
  }

  // ---- sending -----------------------------------------------------------------------------

  /**
   * Sends a command frame. Refused while bitmap data is streaming: the device would read the
   * frame as pixels (its FF/AA/55 bytes would burn stray dots).
   */
  private async send(frame: Bytes): Promise<void> {
    if (this.snapshot.link === 'closed') throw new NejeError('DISCONNECTED');
    if (this.streaming) throw new NejeError('BUSY', 'bitmap data is streaming');
    for (const l of this.traffic) l('tx', frame);
    await this.transport.write(frame);
  }

  private requireReady(): DeviceInfo {
    const { link, info } = this.snapshot;
    if (link !== 'connected' || !info) throw new NejeError('NOT_READY');
    return info;
  }

  /** Job and preview frames carry the byte-padded width, so that is what must fit. */
  private assertInside(r: Rect, padded = true): void {
    const info = this.requireReady();
    const width = padded ? paddedWidth(r.width) : r.width;
    const ok = r.x >= 0 && r.y >= 0 && r.width > 0 && r.height > 0 && r.x + width <= info.width && r.y + r.height <= info.height;
    if (!ok) throw new NejeError('OUT_OF_BOUNDS', `rect ${JSON.stringify(r)} is outside ${info.width}×${info.height}`);
  }

  private get busy(): boolean {
    return this.upload !== null || this.motion !== null || this.snapshot.machine !== 'idle';
  }

  /** Identifies the device. Retries because the board may still be booting after the port opened. */
  async connect(): Promise<DeviceInfo> {
    for (let attempt = 0; attempt < this.identifyAttempts; attempt++) {
      const reply = this.waitFor('info', this.identifyTimeoutMs).catch(() => null);
      await this.send(commands.identify());
      const message = await reply;
      if (message) {
        this.update({ link: 'connected' });
        if (message.info.features.heartbeat) this.startWatchdog();
        return message.info;
      }
    }
    throw new NejeError('NO_RESPONSE');
  }

  /** Changes laser parameters, keeping the ones not given at their current device values. */
  async setLaserParams(patch: LaserParamsPatch): Promise<void> {
    this.requireReady();
    const params = { ...(this.snapshot.params ?? FALLBACK_PARAMS), ...patch };
    await this.send(commands.setLaserParams(params));
    this.update({ params });
  }

  async previewOn(rect: Rect): Promise<void> {
    this.assertInside(rect);
    if (this.upload || this.snapshot.machine !== 'idle') throw new NejeError('BUSY');
    await this.send(commands.previewOn(rect));
    this.traceOrigin = { x: rect.x, y: rect.y };
    this.update({ previewing: true, head: null });
  }

  /**
   * Switches tracing off. By default the head is then parked at the frame corner, because
   * tracing leaves it somewhere on the frame and the app wants to know where it is.
   */
  async previewOff({ park = true }: { readonly park?: boolean } = {}): Promise<void> {
    this.requireReady();
    // flip first, so a preview refresh racing with this call sees the preview as off
    this.update({ previewing: false });
    const origin = this.traceOrigin;
    this.traceOrigin = null;
    await this.send(commands.previewOff());
    if (park && origin) await this.moveTo(origin.x, origin.y);
  }

  async moveTo(x: number, y: number): Promise<void> {
    this.assertInside({ x, y, width: 1, height: 1 }, false);
    await this.send(commands.moveTo(x, y));
    this.update({ head: { x, y } });
  }

  /**
   * Moves the head to the machine origin (0, 0) so its position is known. The Master 2 family has
   * no limit switches: the origin is wherever the head was when the engraver was switched on.
   */
  async home(): Promise<void> {
    if (this.busy) throw new NejeError('BUSY');
    await this.moveTo(0, 0);
  }

  /**
   * Runs head moves with fixed delays, laser off. The protocol has no "move finished"
   * acknowledgement, so timing is open loop. Resolves `false` if interrupted by `stop()`.
   */
  private async runMoves(steps: readonly { readonly x: number; readonly y: number; readonly delayMs: number }[]): Promise<boolean> {
    this.requireReady();
    if (this.busy) throw new NejeError('BUSY');
    const controller = new AbortController();
    this.motion = controller;
    try {
      for (const step of steps) {
        if (step.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, step.delayMs));
        if (controller.signal.aborted) return false;
        await this.moveTo(step.x, step.y);
      }
      return true;
    } finally {
      if (this.motion === controller) this.motion = null;
    }
  }

  /** Motion self-test: traces a square that starts and ends at `origin` (home by default). */
  traceSquare(sizePx: number, origin: Point = { x: 0, y: 0 }, legMs = 800): Promise<boolean> {
    const info = this.requireReady();
    const size = Math.max(1, Math.min(sizePx, info.width - origin.x - 1, info.height - origin.y - 1));
    const { x, y } = origin;
    return this.runMoves([
      { x, y, delayMs: 0 },
      { x: x + size, y, delayMs: legMs },
      { x: x + size, y: y + size, delayMs: legMs },
      { x, y: y + size, delayMs: legMs },
      { x, y, delayMs: legMs },
    ]);
  }

  async pause(): Promise<void> {
    this.requireReady();
    await this.send(commands.pause());
  }

  async resume(): Promise<void> {
    this.requireReady();
    await this.send(commands.resume());
    this.update({ machine: 'working' });
  }

  /**
   * Sends parameters and uploads a job; the device burns as the data arrives. Resolves when the
   * upload is done, the burn itself is tracked through the snapshot. `stop()` at any point
   * before the job is announced prevents it from starting at all.
   */
  async engrave(rect: Rect, bitmap: Bytes, params?: LaserParamsPatch): Promise<void> {
    this.assertInside(rect);
    if (bitmap.length !== bitmapLength(rect.width, rect.height)) throw new RangeError('bitmap size does not match the job rectangle');
    if (this.busy) throw new NejeError('BUSY');

    const controller = new AbortController();
    // `this.upload` is set before the first await inside `runJob` yields, so stop() always sees it
    const done = this.runJob(rect, bitmap, params, controller.signal);
    this.upload = { controller, done };
    try {
      await done;
    } catch (error) {
      const code = error instanceof NejeError ? error.code : 'DISCONNECTED';
      if (code !== 'ABORTED') this.update({ job: { stage: 'failed', code } });
      throw error;
    } finally {
      this.upload = null;
    }
  }

  private async runJob(rect: Rect, bitmap: Bytes, params: LaserParamsPatch | undefined, signal: AbortSignal): Promise<void> {
    const abortIfStopped = () => {
      if (signal.aborted) throw new NejeError('ABORTED');
    };
    if (params) await this.setLaserParams(params);
    abortIfStopped();
    // no parking move here: the job is announced straight after, as the vendor app does
    if (this.snapshot.previewing) await this.previewOff({ park: false });
    abortIfStopped();

    const accepted = this.waitFor('jobAccepted', this.jobAcceptTimeoutMs);
    this.update({ head: null });
    await this.send(commands.startJob(rect));
    let reply: MessageOf<'jobAccepted'>;
    try {
      reply = await accepted;
    } catch (error) {
      // A late acceptance would leave the device waiting for data and reading the next commands
      // as pixels. Zeros are harmless either way: blank dots in data mode, ignored otherwise.
      await this.writeData(new Uint8Array(bitmap.length), signal, true);
      await this.send(commands.cancel()).catch(() => undefined);
      throw error;
    }
    if (!reply.accepted) throw new NejeError('BUSY');
    if (!signal.aborted) this.update({ machine: 'working', job: { stage: 'uploading', sent: 0, total: bitmap.length } });
    // Once accepted, the device consumes exactly `bitmap.length` bytes, so a stop cannot cut the
    // stream short: the rest is padded with zeros (no burn) and cancel follows in stop().
    const complete = await this.writeData(bitmap, signal);
    if (!complete) throw new NejeError('ABORTED');
    if (this.snapshot.job.stage === 'uploading') this.update({ job: { stage: 'burning', percent: 0 } });
  }

  /** Streams raw data in chunks; after an abort the remainder is zero-filled. Returns false if aborted. */
  private async writeData(data: Bytes, signal: AbortSignal, silent = false): Promise<boolean> {
    this.streaming = true;
    let aborted = false;
    try {
      for (let sent = 0; sent < data.length; ) {
        aborted ||= signal.aborted;
        const size = Math.min(this.chunkSize, data.length - sent);
        await this.transport.write(aborted ? new Uint8Array(size) : data.subarray(sent, sent + size));
        sent += size;
        // re-check: stop() may have run while this chunk was being written
        if (!silent && !aborted && !signal.aborted) this.update({ job: { stage: 'uploading', sent, total: data.length } });
      }
    } finally {
      this.streaming = false;
    }
    return !aborted;
  }

  /**
   * Emergency stop. Aborts motion and uploads, then always sends cancel and preview-off,
   * whatever the snapshot believes, so a missed event can never leave the laser on.
   */
  async stop(): Promise<void> {
    if (this.snapshot.link !== 'connected') return;
    this.motion?.abort();
    const { job, machine } = this.snapshot;
    const upload = this.upload;
    if (upload || job.stage === 'uploading' || job.stage === 'burning' || machine !== 'idle') this.update({ job: { stage: 'cancelled' } });
    upload?.controller.abort();
    await upload?.done.catch(() => undefined);
    this.update({ previewing: false });
    this.traceOrigin = null;
    await this.send(commands.cancel());
    await this.send(commands.previewOff());
  }

  /** Closes the link. A running job or preview is stopped first (best effort, bounded). */
  async close(): Promise<void> {
    if (this.snapshot.link === 'closed') return;
    const { job, machine, previewing } = this.snapshot;
    if (this.upload || this.motion || previewing || machine !== 'idle' || job.stage === 'uploading' || job.stage === 'burning') {
      await Promise.race([this.stop().catch(() => undefined), new Promise((resolve) => setTimeout(resolve, 3000))]);
    }
    this.upload?.controller.abort();
    clearInterval(this.watchdog);
    this.update({ link: 'closed', previewing: false });
    await this.transport.close();
  }
}
