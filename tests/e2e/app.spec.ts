import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const fixture = (name: string) => new URL(`../fixtures/${name}`, import.meta.url).pathname;
const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

async function expectAccessible(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

async function connectSimulator(page: Page) {
  await page.getByRole('button', { name: 'Try the simulator' }).click();
  await expect(page.getByRole('status', { name: 'Engraver status' })).toHaveText('Ready');
}

const openTab = (page: Page, name: string) => page.getByRole('tab', { name, exact: true }).click();

async function loadImage(page: Page, name = 'photo.png') {
  await openTab(page, 'Image');
  await page.locator('input[type=file][accept^="image"]').setInputFiles(fixture(name));
  await expect(page.getByText(new RegExp(name.replace('.', '\\.')))).toBeVisible();
}

const progress = (page: Page) => page.getByRole('progressbar', { name: 'Engraving' });
const uploadBar = (page: Page) => page.getByRole('progressbar', { name: 'Sending to engraver' });
const outcome = (page: Page) => page.locator('.phases');

const errors: string[] = [];
test.beforeEach(async ({ page }) => {
  errors.length = 0;
  // the connect routine (homing + motion test) is covered by its own test below
  await page.addInitScript(() => {
    if (sessionStorage.getItem('e2e-routine') === 'on') return;
    localStorage.setItem('neje.motionTestOnConnect.v1', 'false');
  });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto('/');
});
test.afterEach(() => expect(errors).toEqual([]));

test.describe('accessibility (WCAG 2.2 AA, axe)', () => {
  for (const colorScheme of ['light', 'dark'] as const) {
    test(`initial page, ${colorScheme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme });
      await expectAccessible(page);
    });

    test(`connected with image and confirmation dialog, ${colorScheme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme });
      await connectSimulator(page);
      await loadImage(page);
      await openTab(page, 'Machine');
      await page.getByText('Advanced').click();
      await page.getByLabel('Show serial traffic').check();
      await page.getByRole('button', { name: 'Go home' }).click();
      await page.getByRole('button', { name: 'Show dimensions' }).click();
      await page.getByRole('button', { name: 'Move head by clicking' }).click();
      await expectAccessible(page);
      await page.getByRole('button', { name: 'Start engraving…' }).click();
      await expect(page.getByRole('dialog', { name: 'Start engraving?' })).toBeVisible();
      await expectAccessible(page);
    });
  }

  test('works with the keyboard alone', async ({ page }) => {
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeFocused();
    const simulator = page.getByRole('button', { name: 'Try the simulator' });
    await simulator.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('status', { name: 'Engraver status' })).toHaveText('Ready');
    await loadImage(page);

    await openTab(page, 'Position');
    const x = page.getByLabel('X from left (mm)');
    await expect(x).toHaveValue('0');
    await page.getByRole('group', { name: 'Work area preview' }).focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Shift+ArrowDown');
    await expect(x).toHaveValue('1');
    await expect(page.getByLabel('Y from top (mm)')).toHaveValue('10');

    // dialog traps focus and closes with Escape
    await page.getByRole('button', { name: 'Start engraving…' }).focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Start engraving?' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel('I am wearing laser safety goggles')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });
});

test.describe('languages', () => {
  test.use({ locale: 'cs-CZ' });

  test('follows the browser language and can be switched', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Obrázek' })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'cs');
    await page.getByLabel('Jazyk').selectOption('de');
    await expect(page.getByRole('heading', { name: 'Bild' })).toBeVisible();
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'de');
    await page.getByLabel('Sprache').selectOption('auto');
    await expect(page.locator('html')).toHaveAttribute('lang', 'cs');
  });
});

test('defaults to English for unsupported languages', async ({ browser }) => {
  const context = await browser.newContext({ locale: 'ja-JP' });
  const page = await context.newPage();
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Image', exact: true })).toBeVisible();
  await context.close();
});

test.describe('engraving with the simulator', () => {
  test('full job: confirm safety, upload, burn, history', async ({ page }) => {
    await connectSimulator(page);
    await expect(page.getByText('NEJE Master 2 Mini, firmware 7')).toBeVisible();
    await loadImage(page);
    await page.getByRole('button', { name: 'Start engraving…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Start engraving?' });
    const start = dialog.getByRole('button', { name: 'Start', exact: true });
    await expect(start).toBeDisabled();
    await dialog.getByLabel('I am wearing laser safety goggles').check();
    await expect(start).toBeDisabled();
    await dialog.getByLabel('The material is in place and nothing flammable is nearby').check();
    await start.click();
    await expect(uploadBar(page)).toHaveAttribute('aria-valuetext', 'Done'); // phase 1 complete…
    await expect(progress(page)).toHaveAttribute('aria-valuetext', /^Engraving \d+ %$/); // …phase 2 running
    await expect(outcome(page)).toContainText(/expected to finish around/);
    await expect(page.getByRole('status', { name: 'Engraver status' })).toHaveText('Engraving');
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeFocused();
    await expect(page.getByRole('button', { name: 'Disconnect' })).toBeDisabled();
    await openTab(page, 'Laser');
    await expect(page.getByLabel('Power')).toBeDisabled();
    await expect(progress(page)).toHaveAttribute('aria-valuetext', 'Done', { timeout: 15_000 });
    await expect(outcome(page)).toContainText(/Finished at .+, took \d+:\d\d/);
    await openTab(page, 'History');
    await expect(page.getByRole('button', { name: 'Open photo.png with its settings' })).toBeVisible();
  });

  test('stop button and Esc cancel a running job', async ({ page }) => {
    await connectSimulator(page);
    await loadImage(page);
    const stops = [
      () => page.getByRole('button', { name: 'Stop', exact: true }).click(), // header
      () => page.getByRole('button', { name: 'Stop engraving' }).click(), // red button next to Trace frame
      () => page.keyboard.press('Escape'),
    ];
    for (const stop of stops) {
      await page.getByRole('button', { name: 'Start engraving…' }).click();
      const dialog = page.getByRole('dialog');
      await dialog.getByLabel('I am wearing laser safety goggles').check();
      await dialog.getByLabel('The material is in place and nothing flammable is nearby').check();
      await dialog.getByRole('button', { name: 'Start', exact: true }).click();
      await expect(progress(page)).toHaveAttribute('aria-valuetext', /^Engraving \d+ %$/);
      await stop();
      await expect(outcome(page)).toContainText('Stopped');
      await expect(page.getByRole('status', { name: 'Engraver status' })).toHaveText('Ready');
    }
  });

  test('swapping the image keeps every setting; history restores both', async ({ page }) => {
    await loadImage(page);
    await page.getByLabel('Width (mm)').fill('30');
    await openTab(page, 'Laser');
    await page.getByLabel('Power').fill('55');
    await openTab(page, 'Position');
    await page.getByRole('button', { name: 'Center' }).click();
    await expect(page.getByLabel('X from left (mm)')).toHaveValue('40'); // (110 − 30) / 2
    const x = await page.getByLabel('X from left (mm)').inputValue();
    await openTab(page, 'History');
    await page.getByRole('button', { name: 'Save to history' }).click();
    await expect(page.getByRole('button', { name: 'Open photo.png with its settings' })).toBeVisible();

    await loadImage(page, 'logo.svg');
    await expect(page.getByText('logo.svg, vector')).toBeVisible();
    await expect(page.getByLabel('Width (mm)')).toHaveValue('30');
    await expect(page.getByLabel('Height (mm)')).toHaveValue('15');
    await openTab(page, 'Laser');
    await expect(page.getByLabel('Power')).toHaveValue('55');

    await page.getByLabel('Power').fill('20');
    await openTab(page, 'Image');
    await page.getByLabel('Width (mm)').fill('12');
    await openTab(page, 'History');
    await page.getByRole('button', { name: 'Open photo.png with its settings' }).click();
    await openTab(page, 'Image');
    await expect(page.getByText('photo.png, 300 × 150 px')).toBeVisible();
    await expect(page.getByLabel('Width (mm)')).toHaveValue('30');
    await openTab(page, 'Laser');
    await expect(page.getByLabel('Power')).toHaveValue('55');
    await openTab(page, 'Position');
    await expect(page.getByLabel('X from left (mm)')).toHaveValue(x);
  });

  test('trace frame outlines only what will burn, margins trimmed', async ({ page }) => {
    await connectSimulator(page);
    await loadImage(page, 'logo.svg'); // shapes leave a 5 % blank margin on every side
    await openTab(page, 'Machine');
    await page.getByText('Advanced').click();
    await page.getByLabel('Show serial traffic').check();
    const trace = page.getByRole('button', { name: 'Trace frame' });
    await trace.click();
    await expect(page.getByRole('button', { name: 'Stop tracing' })).toHaveAttribute('aria-pressed', 'true');

    const log = await page.getByRole('region', { name: 'Serial traffic in hexadecimal' }).textContent();
    const frame = log!.split('\n').find((l) => l.startsWith('→ ff aa 10 05 01 50 02'))!;
    const b = frame.slice(2).split(' ').map((h) => Number.parseInt(h, 16));
    const [x, y, w, h] = [7, 9, 11, 13].map((i) => (b[i]! << 8) | b[i + 1]!);
    const image = { w: Math.round(40 / 0.075), h: Math.round(20 / 0.075) }; // 40 × 20 mm at 75 µm
    expect(x).toBeGreaterThan(0);
    expect(y).toBeGreaterThan(0);
    expect(w).toBeLessThan(image.w);
    expect(h).toBeLessThan(image.h);
    expect(w).toBeGreaterThan(image.w * 0.85);

    await page.getByRole('button', { name: 'Stop tracing' }).click();
    await expect(trace).toHaveAttribute('aria-pressed', 'false');
  });

  test('click to move the head, with a keyboard alternative', async ({ page }) => {
    const toggle = page.getByRole('button', { name: 'Move head by clicking' });
    await expect(toggle).toBeDisabled(); // needs a connection
    await connectSimulator(page);
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    const canvas = page.locator('.work-area canvas');
    const box = (await canvas.boundingBox())!;
    await canvas.click({ position: { x: box.width / 2, y: box.height / 4 } }); // 55 mm, 30 mm
    await expect(page.getByText('Head at X 55 mm, Y 30 mm')).toBeVisible();
    await page.getByRole('group', { name: 'Work area preview' }).focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Shift+ArrowDown');
    await expect(page.getByText('Head at X 56 mm, Y 40 mm')).toBeVisible();

    // only the primary button moves the head
    await canvas.click({ button: 'right', position: { x: 10, y: 10 } });
    await expect(page.getByText('Head at X 56 mm, Y 40 mm')).toBeVisible();

    // a trace switches the mode off, and it stays off afterwards
    await loadImage(page);
    await page.getByRole('button', { name: 'Trace frame' }).click();
    await expect(toggle).toBeDisabled();
    await page.getByRole('button', { name: 'Stop tracing' }).click();
    await expect(toggle).toBeEnabled();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  });

  test('dimensions show image and head distances, also as text', async ({ page }) => {
    await connectSimulator(page);
    await page.getByRole('button', { name: 'Go home' }).click();
    await loadImage(page); // 2:1 image → 40 × 20 mm
    await openTab(page, 'Position');
    await page.getByLabel('X from left (mm)').fill('10');
    await page.getByLabel('Y from top (mm)').fill('5');
    const toggle = page.getByRole('button', { name: 'Show dimensions' });
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');

    const table = page.getByRole('region', { name: 'Dimensions' });
    const value = (group: string, label: string) =>
      table.locator('div', { has: page.getByText(group, { exact: true }) }).locator('dl > div', { has: page.getByText(label, { exact: true }) }).locator('dd');
    await expect(value('Image', 'Size')).toHaveText('40 × 20 mm');
    await expect(value('Image', 'From left edge')).toHaveText('10 mm');
    await expect(value('Image', 'From right edge')).toHaveText('60 mm'); // 110 − 10 − 40
    await expect(value('Image', 'From bottom edge')).toHaveText('95 mm'); // 120 − 5 − 20
    await expect(value('Head', 'From left edge')).toHaveText('0 mm');
    await expect(value('Head', 'From right edge')).toHaveText('110 mm');
    await expect(value('Head to image corner', 'Horizontal (X)')).toHaveText('-10 mm');
    await expect(value('Head to image corner', 'Vertical (Y)')).toHaveText('-5 mm');

    await page.getByRole('button', { name: 'Move head to image' }).click();
    await expect(value('Head to image corner', 'Horizontal (X)')).toHaveText('0 mm');
    await toggle.click();
    await expect(table).toBeHidden();
  });

  test('user presets are saved and applied', async ({ page }) => {
    await openTab(page, 'Laser');
    await page.getByLabel('Power').fill('42');
    await page.getByLabel('New preset name').fill('Walnut 3 mm');
    await page.getByRole('button', { name: 'Save preset' }).click();
    await page.reload();
    await page.getByLabel('Material preset').selectOption({ label: 'Light wood (starting point)' });
    await expect(page.getByLabel('Power')).toHaveValue('100');
    await page.getByLabel('Material preset').selectOption({ label: 'Walnut 3 mm' });
    await expect(page.getByLabel('Power')).toHaveValue('42');
  });

  test('connecting homes the head and tests motion, blocking a start meanwhile', async ({ page }) => {
    await page.evaluate(() => {
      sessionStorage.setItem('e2e-routine', 'on');
      localStorage.removeItem('neje.motionTestOnConnect.v1');
    });
    await page.reload();
    await loadImage(page);
    await connectSimulator(page);
    await openTab(page, 'Position');
    await expect(page.getByRole('button', { name: 'Testing motion…' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Start engraving…' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Start engraving…' })).toBeEnabled({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Test motion', exact: true })).toBeEnabled();
    await expect(page.getByText('Head at X 0 mm, Y 0 mm')).toBeVisible();
  });

  test('head position is unknown until homed, then follows moves', async ({ page }) => {
    await connectSimulator(page);
    await expect(page.getByText('Head position unknown. Use “Go home” to set it.')).toBeVisible();
    await page.getByRole('button', { name: 'Go home' }).click();
    await expect(page.getByText('Head at X 0 mm, Y 0 mm')).toBeVisible();
    await loadImage(page);
    await openTab(page, 'Position');
    await page.getByLabel('X from left (mm)').fill('20');
    await page.getByRole('button', { name: 'Move head to image' }).click();
    await expect(page.getByText('Head at X 20 mm, Y 0 mm')).toBeVisible();
  });

  test('unplugging the engraver is reported', async ({ page }) => {
    await connectSimulator(page);
    await page.getByRole('button', { name: 'Disconnect' }).click();
    await expect(page.getByRole('status', { name: 'Engraver status' })).toHaveText('Not connected');
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeDisabled();
  });
});

test('unreadable files show an accessible error', async ({ page }) => {
  await page.locator('input[type=file][accept^="image"]').setInputFiles(fixture('broken.heic'));
  await expect(page.getByRole('alert').filter({ hasText: 'broken.heic' })).toContainText('“broken.heic” cannot be opened');
});

test('keeps working offline after the first visit', async ({ page, context }) => {
  await page.evaluate(() => navigator.serviceWorker.ready);
  // the worker caches assets it saw on the first load; give it a moment to finish
  await expect.poll(() => page.evaluate(async () => (await caches.keys()).length)).toBeGreaterThan(0);
  await page.reload();
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'NEJE Web Engraver' })).toBeVisible();
  await connectSimulator(page);
  await context.setOffline(false);
});

test.describe('layout, tabs and new tools', () => {
  test('engraving controls come first; tabs follow the WAI-ARIA pattern and are remembered', async ({ page }) => {
    const engrave = page.getByRole('heading', { name: 'Engrave', exact: true });
    const tablist = page.getByRole('tablist', { name: 'Sections' });
    const order = await page.evaluate(
      ([a, b]) => a!.compareDocumentPosition(b!) & Node.DOCUMENT_POSITION_FOLLOWING,
      [await engrave.elementHandle(), await tablist.elementHandle()] as const,
    );
    expect(order).toBeTruthy(); // the engrave panel is above the tabs

    const image = page.getByRole('tab', { name: 'Image', exact: true });
    await expect(image).toHaveAttribute('aria-selected', 'true');
    await image.focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: 'Text', exact: true })).toBeFocused();
    await expect(page.getByRole('tabpanel', { name: 'Text' })).toBeVisible();
    await page.keyboard.press('End');
    await expect(page.getByRole('tab', { name: 'Help', exact: true })).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ArrowRight'); // wraps around
    await expect(image).toHaveAttribute('aria-selected', 'true');
    await openTab(page, 'History');
    await page.reload();
    await expect(page.getByRole('tab', { name: 'History', exact: true })).toHaveAttribute('aria-selected', 'true');
  });

  test('the start dialog can skip saving to history (saving is the default)', async ({ page }) => {
    await connectSimulator(page);
    await loadImage(page);
    for (const save of [false, true]) {
      await page.getByRole('button', { name: 'Start engraving…' }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog.getByLabel('Save to history')).toBeChecked();
      if (!save) await dialog.getByLabel('Save to history').uncheck();
      await dialog.getByLabel('I am wearing laser safety goggles').check();
      await dialog.getByLabel('The material is in place and nothing flammable is nearby').check();
      await dialog.getByRole('button', { name: 'Start', exact: true }).click();
      await page.getByRole('button', { name: 'Stop', exact: true }).click();
      await expect(outcome(page)).toContainText('Stopped');
    }
    await openTab(page, 'History');
    await expect(page.getByRole('button', { name: /^Open photo\.png/ })).toHaveCount(1);
  });

  test('history exports to a file and imports back', async ({ page }) => {
    await loadImage(page);
    await openTab(page, 'History');
    await page.getByRole('button', { name: 'Save to history' }).click();
    await expect(page.getByRole('button', { name: 'Open photo.png with its settings' })).toBeVisible();

    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export history' }).click();
    const file = await (await download).path();
    expect((await download).suggestedFilename()).toMatch(/^neje-history-\d{4}-\d{2}-\d{2}\.json$/);

    const clear = page.getByRole('button', { name: 'Delete all' });
    await clear.click();
    await expect(page.getByRole('button', { name: 'Really delete all?' })).toBeVisible();
    await page.getByRole('button', { name: 'Really delete all?' }).click();
    await expect(page.getByText('Every started job is saved here together with its settings.')).toBeVisible();

    await page.locator('input[type=file][accept*="json"]').setInputFiles(file);
    await expect(page.getByRole('button', { name: 'Open photo.png with its settings' })).toBeVisible();
    await page.locator('input[type=file][accept*="json"]').setInputFiles({ name: 'evil.json', mimeType: 'application/json', buffer: Buffer.from('{"format":"x"}') });
    await expect(page.getByRole('alert').filter({ hasText: 'could not be imported' })).toBeVisible();
  });

  test('typed text becomes a vector motif', async ({ page }) => {
    await openTab(page, 'Text');
    const use = page.getByRole('button', { name: 'Use text as motif' });
    await expect(use).toBeDisabled();
    await page.getByLabel('Text to engrave').fill('Eliška & Michal\n25. 4. 2026');
    await page.getByLabel('Font').selectOption({ label: 'Serif' });
    await page.getByLabel('Bold').check();
    await use.click();
    await openTab(page, 'Image');
    await expect(page.getByText('text.svg, vector')).toBeVisible();
    await expect(page.getByText(/Estimated time about/)).toBeVisible();
  });

  test('test patterns insert at their calibrated size without dithering', async ({ page }) => {
    await page.getByRole('button', { name: 'Focus and resolution' }).click();
    await expect(page.getByText('focus-test.svg, vector')).toBeVisible();
    await expect(page.getByLabel('Width (mm)')).toHaveValue('20');
    await expect(page.getByLabel('Height (mm)')).toHaveValue('12');
    await expect(page.getByLabel('Dithering')).toHaveValue('threshold');
  });

  test('a size typed right after inserting a pattern wins, and the field shows the real value', async ({ page }) => {
    await page.getByRole('button', { name: 'Focus and resolution' }).click();
    const width = page.getByLabel('Width (mm)');
    await width.fill('60'); // before the pattern has finished loading
    await width.blur();
    await expect(width).toHaveValue('60');
    await expect(page.getByLabel('Height (mm)')).toHaveValue('35.9'); // 800 px × 160 / 267 = 479 px
  });

  test('machine settings come from the device and are sent back', async ({ page }) => {
    await openTab(page, 'Machine');
    await expect(page.getByText('Connect the engraver to change its settings.')).toBeVisible();
    await connectSimulator(page);
    await page.getByText('Advanced').click();
    await page.getByLabel('Show serial traffic').check();
    const speed = page.getByLabel('Speed mode (experimental)');
    await expect(speed).toHaveValue('2'); // what the Master 2 Mini reports
    await expect(speed.locator('option')).toHaveText(['Slow (better quality)', 'Fast', 'As set on the machine (2)']);
    await page.getByLabel('Motion detection').selectOption({ label: 'Medium' });
    const log = page.getByRole('region', { name: 'Serial traffic in hexadecimal' });
    await expect(log).toContainText('→ ff aa 0b 03 01 07 50 0a 02 02 55'); // sensitivity 2, rest unchanged
    await speed.selectOption('0');
    await expect(log).toContainText('→ ff aa 0b 03 01 07 50 0a 02 00 55'); // mode 0 = slow
  });

  test('help explains connection and quality problems', async ({ page }) => {
    await openTab(page, 'Help');
    await expect(page.getByRole('heading', { name: 'The engraver does not connect' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'NEJE Master 2 Mini manual' })).toHaveAttribute('href', /neje\.wiki/);
  });

  for (const colorScheme of ['light', 'dark'] as const) {
    test(`every tab passes axe, ${colorScheme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme });
      await connectSimulator(page);
      await loadImage(page);
      for (const name of ['Image', 'Text', 'Position', 'Laser', 'History', 'Machine', 'Help']) {
        await openTab(page, name);
        await expectAccessible(page);
      }
    });
  }
});
