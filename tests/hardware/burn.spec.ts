/**
 * Real calibration burn through the full UI, recording all device traffic. Double opt-in:
 *   NEJE_PORT=/dev/cu.wchusbserial3130 NEJE_ALLOW_BURN=1 npm run test:hardware -- burn
 * Burns tests/fixtures/calibration.svg at 5 × 5 mm, X/Y from NEJE_BURN_X_MM / NEJE_BURN_Y_MM
 * (default 10 mm), power NEJE_BURN_POWER (80 %) and NEJE_BURN_TIME_MS (8 ms). The traffic log is
 * written to test-results/burn-capture.json.
 *
 * Laser safety: only run with eye protection, material in place and someone at the machine.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { attachBridge, type Received, type Sent } from './bridge';

const PORT = process.env.NEJE_PORT;
test.skip(!PORT || process.env.NEJE_ALLOW_BURN !== '1', 'needs NEJE_PORT and NEJE_ALLOW_BURN=1');

test('calibration burn, traffic captured', async ({ page }) => {
  test.setTimeout(10 * 60_000);
  const sent: Sent[] = [];
  const received: Received[] = [];
  const bridge = await attachBridge(page, PORT!, { sent, received, allowBurn: true });
  const marks: { t: number; event: string }[] = [];
  const mark = (event: string) => marks.push({ t: Date.now() - bridge.t0, event });
  try {
    await page.addInitScript(() => localStorage.setItem('neje.motionTestOnConnect.v1', 'false'));
    await page.goto('/');
    await page.getByRole('button', { name: 'Connect engraver' }).click();
    await expect(page.getByRole('status', { name: 'Engraver status' })).toHaveText('Ready', { timeout: 10_000 });

    await page.locator('input[type=file]').setInputFiles(new URL('../fixtures/calibration.svg', import.meta.url).pathname);
    await page.getByLabel('Dithering').selectOption('threshold');
    // explicit parameters: never inherit whatever an earlier test left on the machine
    await page.getByLabel('Power').fill(process.env.NEJE_BURN_POWER ?? '80');
    await page.getByLabel('Burn time per dot').fill(process.env.NEJE_BURN_TIME_MS ?? '8');
    await page.getByLabel('Width (mm)').fill('5');
    await page.getByLabel('X from left (mm)').fill(process.env.NEJE_BURN_X_MM ?? '10');
    await page.getByLabel('Y from top (mm)').fill(process.env.NEJE_BURN_Y_MM ?? '10');
    await page.getByText('Advanced').click();
    await page.getByLabel('Show serial traffic').check();

    await page.getByRole('button', { name: 'Start engraving…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Start engraving?' });
    await dialog.getByLabel('I am wearing laser safety goggles').check();
    await dialog.getByLabel('The material is in place and nothing flammable is nearby').check();
    mark('start clicked');
    await dialog.getByRole('button', { name: 'Start', exact: true }).click();

    await expect(page.getByRole('progressbar', { name: 'Sending to engraver' })).toHaveAttribute('aria-valuetext', 'Done', { timeout: 60_000 });
    mark('upload confirmed by device');
    await expect(page.getByRole('status', { name: 'Engraver status' })).toHaveText('Ready', { timeout: 8 * 60_000 });
    mark('machine idle again');
  } finally {
    await mkdir('test-results', { recursive: true });
    const hex = (b: number[]) => b.map((x) => x.toString(16).padStart(2, '0')).join(' ');
    await writeFile(
      'test-results/burn-capture.json',
      JSON.stringify(
        {
          marks,
          sent: sent.filter((f) => f[0] === 0xff && f[1] === 0xaa).map(hex),
          sentDataBytes: sent.filter((f) => !(f[0] === 0xff && f[1] === 0xaa)).reduce((n, f) => n + f.length, 0),
          received: received.map((r) => ({ t: r.t, hex: hex(r.bytes) })),
        },
        null,
        1,
      ),
    );
    await bridge.close();
  }
});
