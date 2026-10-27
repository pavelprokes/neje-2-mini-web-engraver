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
import { expect, test } from '@playwright/test';
import { attachBridge, isAllowed, type Sent } from './bridge';

const PORT = process.env.NEJE_PORT;
test.skip(!PORT, 'set NEJE_PORT to the engraver serial port to run hardware tests');
test.describe.configure({ mode: 'serial' });

test('identifies, homes, reconnects and runs the motion test on a real engraver', async ({ page }) => {
  test.setTimeout(60_000);
  const sent: Sent[] = [];
  const { close: closePort } = await attachBridge(page, PORT!, { sent });
  try {
    await page.goto('/');
    const status = page.getByRole('status', { name: 'Engraver status' });

    // first connection: homing + motion test run automatically by default
    await page.getByRole('button', { name: 'Connect engraver' }).click();
    await expect(status).toHaveText('Ready', { timeout: 10_000 });
    await expect(page.getByText(/NEJE Master 2 Mini, firmware \d+/)).toBeVisible();
    await expect(page.getByText(/Laser \d+ °C/)).toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole('button', { name: 'Test motion' })).toBeEnabled({ timeout: 10_000 });
    await expect(page.getByText('Head at X 0 mm, Y 0 mm')).toBeVisible();
    const moves = sent.filter((f) => f[3] === 0x05 && f[6] === 1);
    expect(moves.length).toBe(6); // home + square (start + 4 corners)
    const last = moves.at(-1)!;
    expect([(last[7]! << 8) | last[8]!, (last[9]! << 8) | last[10]!]).toEqual([0, 0]); // back home

    // disconnect and reconnect, without the automatic test this time
    await page.getByRole('button', { name: 'Disconnect' }).click();
    await expect(status).toHaveText('Not connected');
    await page.getByText('Advanced').click();
    await page.getByLabel('Go home and test motion after connecting').uncheck();
    const before = sent.length;
    await page.getByRole('button', { name: 'Connect engraver' }).click();
    await expect(status).toHaveText('Ready', { timeout: 10_000 });
    expect(sent.slice(before).filter((f) => f[3] === 0x05)).toEqual([]);
    await expect(page.getByText('Head position unknown. Use “Go home” to set it.')).toBeVisible();
    await page.getByRole('button', { name: 'Go home' }).click();
    await expect(page.getByText('Head at X 0 mm, Y 0 mm')).toBeVisible();

    // manual test button
    await page.getByRole('button', { name: 'Test motion' }).click();
    await expect(page.getByRole('button', { name: 'Testing motion…' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Test motion' })).toBeEnabled({ timeout: 10_000 });

    // laser parameters reach the device; the engraver stores them, so put the original back
    const original = await page.getByLabel('Power').inputValue();
    const probe = original === '30' ? '31' : '30';
    await page.getByLabel('Power').fill(probe);
    await expect.poll(() => sent.some((f) => f[3] === 0x03 && f[6] === Number(probe)), { timeout: 3_000 }).toBe(true);
    await page.getByLabel('Power').fill(original);
    await expect.poll(() => sent.at(-1)?.[3] === 0x03 && sent.at(-1)?.[6] === Number(original), { timeout: 3_000 }).toBe(true);

    await page.getByRole('button', { name: 'Disconnect' }).click();
    await expect(status).toHaveText('Not connected');
    expect(sent.every(isAllowed)).toBe(true);
  } finally {
    await closePort();
  }
});
