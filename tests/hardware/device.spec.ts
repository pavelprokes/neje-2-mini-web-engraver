/**
 * Runs the real UI against a real engraver. Opt-in:
 *   NEJE_PORT=/dev/cu.wchusbserial3130 npm run test:hardware
 *
 * Playwright cannot pick a Web Serial port, so the page gets a test bridge (see
 * src/lib/transport/testBridge.ts) that relays bytes to the port through Node's `serialport`.
 *
 * Safety: the relay refuses to forward anything that could fire the laser (job start,
 * preview/trace frame, raw bitmap data). Only identification, parameters, pause/resume/cancel
 * and head moves reach the machine.
 */
import { expect, test, type Page } from '@playwright/test';
import { SerialPort } from 'serialport';

const PORT = process.env.NEJE_PORT;
test.skip(!PORT, 'set NEJE_PORT to the engraver serial port to run hardware tests');
test.describe.configure({ mode: 'serial' });

type Sent = number[];

function isAllowed(frame: Sent): boolean {
  if (frame[0] !== 0xff || frame[1] !== 0xaa) return false; // raw data = bitmap
  const cmd = frame[3];
  if (cmd === 0x04) return false; // start job
  if (cmd === 0x05 && frame[6] !== 1 && frame[6] !== 0) return false; // preview/trace on (2)
  return true;
}

async function attachBridge(page: Page, sent: Sent[]) {
  const port = new SerialPort({ path: PORT!, baudRate: 57_600, autoOpen: false });
  await new Promise<void>((resolve, reject) => port.open((e) => (e ? reject(e) : resolve())));
  port.on('data', (chunk: Buffer) => {
    void page.evaluate((bytes) => window.__NEJE_TEST_BRIDGE__?.onData?.(bytes), [...chunk]).catch(() => undefined);
  });
  await page.exposeFunction('__nejeBridgeWrite', async (bytes: number[]) => {
    if (!isAllowed(bytes)) throw new Error(`blocked unsafe frame ${bytes.slice(0, 8).map((b) => b.toString(16)).join(' ')}`);
    sent.push(bytes);
    await new Promise<void>((resolve, reject) => port.write(Buffer.from(bytes), (e) => (e ? reject(e) : port.drain(() => resolve()))));
  });
  await page.exposeFunction('__nejeBridgeClose', async () => undefined);
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, (...a: unknown[]) => Promise<void>>;
    window.__NEJE_TEST_BRIDGE__ = { write: (b) => w.__nejeBridgeWrite!(b), close: () => w.__nejeBridgeClose!() };
  });
  return () => new Promise<void>((resolve) => (port.isOpen ? port.close(() => resolve()) : resolve()));
}

test('identifies, reconnects and runs the motion test on a real engraver', async ({ page }) => {
  test.setTimeout(60_000);
  const sent: Sent[] = [];
  const closePort = await attachBridge(page, sent);
  try {
    await page.goto('/');
    const status = page.getByRole('status', { name: 'Engraver status' });

    // first connection: jingle + motion test run automatically by default
    await page.getByRole('button', { name: 'Connect engraver' }).click();
    await expect(status).toHaveText('Ready', { timeout: 10_000 });
    await expect(page.getByText(/NEJE Master 2 Mini, firmware \d+/)).toBeVisible();
    await expect(page.getByText(/Laser \d+ °C/)).toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole('button', { name: 'Test motion' })).toBeEnabled({ timeout: 10_000 });
    const moves = sent.filter((f) => f[3] === 0x05 && f[6] === 1);
    expect(moves.length).toBeGreaterThan(5); // jingle notes + square (start + 4 corners)
    const last = moves.at(-1)!;
    expect([(last[7]! << 8) | last[8]!, (last[9]! << 8) | last[10]!]).toEqual([0, 0]); // back home

    // disconnect and reconnect, without the automatic test this time
    await page.getByRole('button', { name: 'Disconnect' }).click();
    await expect(status).toHaveText('Not connected');
    await page.getByText('Advanced').click();
    await page.getByLabel('Play a jingle after connecting').uncheck();
    await page.getByLabel('Test motion after connecting').uncheck();
    const before = sent.length;
    await page.getByRole('button', { name: 'Connect engraver' }).click();
    await expect(status).toHaveText('Ready', { timeout: 10_000 });
    expect(sent.slice(before).filter((f) => f[3] === 0x05)).toEqual([]);

    // manual test button
    await page.getByRole('button', { name: 'Test motion' }).click();
    await expect(page.getByRole('button', { name: 'Testing motion…' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Test motion' })).toBeEnabled({ timeout: 10_000 });

    // laser parameters reach the device
    await page.getByLabel('Power').fill('30');
    await expect.poll(() => sent.some((f) => f[3] === 0x03 && f[6] === 30), { timeout: 3_000 }).toBe(true);

    await page.getByRole('button', { name: 'Disconnect' }).click();
    await expect(status).toHaveText('Not connected');
    expect(sent.every(isAllowed)).toBe(true);
  } finally {
    await closePort();
  }
});
