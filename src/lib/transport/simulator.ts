import { buildFrame, FrameParser, fromHex, type Bytes, type Transport } from '@/lib/protocol';

/** Frames captured from a real NEJE Master 2 Mini (firmware 7). */
export const CAPTURED = {
  info: fromHex('ff aa 26 01 03 1a 01 07 05 ba 06 40 11 2e 12 c0 4b 19 00 08 00 00 00 03 d0 90 59 59 4e 59 59 59 59 59 59 04 00 55'),
  params: fromHex('ff aa 0c 03 02 07 50 0a 00 02 28 55'),
  status: fromHex('ff aa 10 02 01 01 00 00 06 01 a1 05 b0 02 fd 55'),
  telemetry: fromHex('ff aa 0c 0b 03 18 ff ff ff 00 01 55'),
} as const;

export interface SimulatorOptions {
  readonly heartbeatMs?: number;
  /** Simulated burn duration after the upload completes. */
  readonly burnMs?: number;
  /** Reject the next job as busy. */
  readonly busy?: boolean;
}

/** In-memory engraver that speaks the protocol, for development, demos and tests. */
export class SimulatorTransport implements Transport {
  private onData: (chunk: Uint8Array) => void = () => {};
  private onClose: () => void = () => {};
  private readonly parser = new FrameParser();
  private readonly heartbeat: ReturnType<typeof setInterval>;
  private burnTimer: ReturnType<typeof setInterval> | undefined;
  private expectedBytes = 0;
  private paused = false;
  private closed = false;
  /** Everything written to the device, for assertions. */
  readonly received: Uint8Array[] = [];

  constructor(private readonly options: SimulatorOptions = {}) {
    this.heartbeat = setInterval(() => this.reply(CAPTURED.telemetry), options.heartbeatMs ?? 1000);
  }

  open(onData: (chunk: Uint8Array) => void, onClose: () => void): void {
    this.onData = onData;
    this.onClose = onClose;
  }

  async write(data: Bytes): Promise<void> {
    if (this.closed) throw new Error('simulator closed');
    this.received.push(data.slice());
    if (this.expectedBytes > 0) {
      this.expectedBytes -= data.length;
      if (this.expectedBytes <= 0) {
        this.reply(buildFrame(0x04, 1, [4, 1]));
        this.startBurn();
      }
      return;
    }
    for (const frame of this.parser.push(data)) this.handle(frame);
  }

  /** Simulates the cable being pulled. */
  unplug(): void {
    this.dispose();
    this.onClose();
  }

  async close(): Promise<void> {
    this.dispose();
  }

  private dispose(): void {
    this.closed = true;
    clearInterval(this.heartbeat);
    clearInterval(this.burnTimer);
  }

  private reply(bytes: Uint8Array): void {
    if (!this.closed) queueMicrotask(() => this.onData(bytes));
  }

  private handle(f: Uint8Array): void {
    const [cmd, a, b] = [f[3], f[5], f[6]];
    switch (cmd) {
      case 0x01:
        this.reply(CAPTURED.info);
        this.reply(CAPTURED.params);
        this.reply(CAPTURED.status);
        break;
      case 0x03:
        this.reply(buildFrame(0x03, 2, [...f.subarray(5, 10), 0x28]));
        break;
      case 0x04: {
        if (this.options.busy) {
          this.reply(buildFrame(0x04, 1, [2, 0]));
          break;
        }
        this.expectedBytes = ((f[15]! << 24) | (f[16]! << 16) | (f[17]! << 8) | f[18]!) >>> 0;
        this.reply(buildFrame(0x04, 1, [2, 1]));
        break;
      }
      case 0x02:
        if (a !== 1) break;
        if (b === 0) {
          this.paused = true;
          this.reply(buildFrame(0x0c, 1, [3, 0]));
        } else if (b === 1) {
          this.paused = false;
        } else if (b === 2) {
          clearInterval(this.burnTimer);
          this.reply(buildFrame(0x0c, 1, [1, 0]));
        }
        break;
    }
  }

  private startBurn(): void {
    const steps = 10;
    let step = 0;
    this.burnTimer = setInterval(
      () => {
        if (this.paused) return;
        step++;
        this.reply(buildFrame(0x04, 1, [3, (step * 100) / steps]));
        if (step === steps) {
          clearInterval(this.burnTimer);
          this.reply(buildFrame(0x0c, 1, [1, 0]));
        }
      },
      (this.options.burnMs ?? 4000) / steps,
    );
  }
}
