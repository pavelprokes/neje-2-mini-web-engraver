import { DEFAULT_LINE_BAUD, type Bytes, type Transport } from '@/lib/protocol';

export const DEFAULT_BAUD_RATE = DEFAULT_LINE_BAUD;

export const isWebSerialSupported = (): boolean => typeof navigator !== 'undefined' && 'serial' in navigator;

/**
 * Web Serial transport (Chrome, Edge, Opera). Must be created from a user gesture
 * because `requestPort()` shows the browser's port picker.
 */
export class WebSerialTransport implements Transport {
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private closing = false;

  private constructor(
    private readonly port: SerialPort,
    readonly baudRate: number,
  ) {}

  static async request(baudRate = DEFAULT_BAUD_RATE): Promise<WebSerialTransport> {
    const port = await navigator.serial.requestPort();
    await port.open({ baudRate, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none' });
    return new WebSerialTransport(port, baudRate);
  }

  open(onData: (chunk: Uint8Array) => void, onClose: (reason?: unknown) => void): void {
    if (!this.port.readable || !this.port.writable) throw new Error('serial port is not open');
    this.writer = this.port.writable.getWriter();
    void (async () => {
      let lastError: unknown;
      // Framing, parity, overrun and break errors end the current stream but the port stays
      // usable with a fresh `readable`; only a null `readable` means the device is gone.
      while (this.port.readable && !this.closing) {
        const reader = this.port.readable.getReader();
        this.reader = reader;
        try {
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            if (value) onData(value);
          }
        } catch (error) {
          lastError = error;
        } finally {
          reader.releaseLock();
        }
      }
      if (!this.closing) onClose(lastError);
    })();
  }

  async write(data: Bytes): Promise<void> {
    if (!this.writer) throw new Error('serial port is not open');
    await this.writer.write(data);
  }

  async close(): Promise<void> {
    this.closing = true;
    try {
      await this.reader?.cancel();
    } catch {
      // already gone
    }
    this.writer?.releaseLock();
    try {
      await this.port.close();
    } catch {
      // unplugged ports reject close()
    }
  }
}
