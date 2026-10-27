/**
 * Playwright ↔ serial relay for hardware tests. Browsers do not let automation pick a Web Serial
 * port, so the page gets a test bridge (src/lib/transport/testBridge.ts) whose bytes are relayed
 * to the real port through Node's `serialport`.
 *
 * By default the relay refuses anything that could fire the laser: job start, frame tracing and
 * raw bitmap data. `allowBurn` lifts that for the explicitly opted-in burn test.
 */
import type { Page } from '@playwright/test';
import { SerialPort } from 'serialport';

export type Sent = number[];

export interface Received {
  /** ms since the bridge was attached */
  readonly t: number;
  readonly bytes: number[];
}

export function isAllowed(frame: Sent): boolean {
  if (frame[0] !== 0xff || frame[1] !== 0xaa) return false; // raw data = bitmap
  const cmd = frame[3];
  if (cmd === 0x04) return false; // start job
  if (cmd === 0x05 && frame[6] !== 1 && frame[6] !== 0) return false; // trace on (2)
  return true;
}

export async function attachBridge(
  page: Page,
  path: string,
  { sent, received, allowBurn = false }: { sent: Sent[]; received?: Received[]; allowBurn?: boolean },
) {
  const t0 = Date.now();
  const port = new SerialPort({ path, baudRate: 57_600, autoOpen: false });
  await new Promise<void>((resolve, reject) => port.open((e) => (e ? reject(e) : resolve())));
  port.on('data', (chunk: Buffer) => {
    received?.push({ t: Date.now() - t0, bytes: [...chunk] });
    void page.evaluate((bytes) => window.__NEJE_TEST_BRIDGE__?.onData?.(bytes), [...chunk]).catch(() => undefined);
  });
  await page.exposeFunction('__nejeBridgeWrite', async (bytes: number[]) => {
    if (!allowBurn && !isAllowed(bytes)) throw new Error(`blocked unsafe frame ${bytes.slice(0, 8).map((b) => b.toString(16)).join(' ')}`);
    sent.push(bytes);
    await new Promise<void>((resolve, reject) => port.write(Buffer.from(bytes), (e) => (e ? reject(e) : port.drain(() => resolve()))));
  });
  await page.exposeFunction('__nejeBridgeClose', async () => undefined);
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, (...a: unknown[]) => Promise<void>>;
    window.__NEJE_TEST_BRIDGE__ = { write: (b) => w.__nejeBridgeWrite!(b), close: () => w.__nejeBridgeClose!() };
  });
  return {
    t0,
    close: () => new Promise<void>((resolve) => (port.isOpen ? port.close(() => resolve()) : resolve())),
  };
}
