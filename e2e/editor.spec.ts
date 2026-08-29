import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const FIXTURE_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <circle cx="50" cy="50" r="46" fill="#ffcc4d"/>
  <circle cx="34" cy="40" r="6" fill="#3b2f2f"/>
  <circle cx="66" cy="40" r="6" fill="#3b2f2f"/>
  <path d="M25 61 Q50 86 75 61" fill="none" stroke="#3b2f2f" stroke-width="8" stroke-linecap="round"/>
</svg>`;

const mockArtwork = async (page: Page) => {
  await page.route('https://cdn.jsdelivr.net/**', async (route) => {
    if (route.request().url().endsWith('/41.svg')) {
      await route.fulfill({ status: 404, body: 'not found' });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'image/svg+xml',
      headers: { 'access-control-allow-origin': '*' },
      body: FIXTURE_SVG,
    });
  });
};

const alphaBounds = async (page: Page) =>
  page.getByLabel(/Preview of/).evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('missing canvas context');
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let left = canvas.width;
    let top = canvas.height;
    let right = -1;
    let bottom = -1;
    for (let y = 0; y < canvas.height; y += 1) {
      for (let x = 0; x < canvas.width; x += 1) {
        if (pixels[(y * canvas.width + x) * 4 + 3] === 0) continue;
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x);
        bottom = Math.max(bottom, y);
      }
    }
    return { left, top, right, bottom, size: canvas.width };
  });

const previewPixel = async (page: Page, x: number, y: number) =>
  page.getByLabel(/Preview of/).evaluate((element, point) => {
    const canvas = element as HTMLCanvasElement;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('missing canvas context');
    return [...context.getImageData(point.x, point.y, 1, 1).data];
  }, { x, y });

const downloadedPng = async (page: Page) => {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download PNG' }).click();
  const download = await pending;
  const path = await download.path();
  if (!path) throw new Error('download has no local path');
  const data = (await readFile(path)).toString('base64');
  return page.evaluate(async (base64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('missing canvas context');
    context.drawImage(image, 0, 0);
    return {
      width: image.width,
      height: image.height,
      center: [...context.getImageData(image.width / 2, image.height / 2, 1, 1).data],
    };
  }, data);
};

test.beforeEach(async ({ page }) => {
  await mockArtwork(page);
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Copy PNG' })).toBeEnabled();
});

test(
  'renders a stable default preview',
  { tag: '@visual' },
  async ({ page }) => {
    await expect(page.getByLabel('Preview of 😀')).toHaveScreenshot('default-preview.png');
  },
);

test('maximum transforms and effects remain inside every export', async ({ page }) => {
  await page.getByRole('spinbutton', { name: 'Rotate', exact: true }).fill('137');
  await page.getByText('Advanced transforms').click();
  await page.getByLabel('Lock proportions').uncheck();
  await page.getByRole('spinbutton', { name: 'Scale X', exact: true }).fill('3');
  await page.getByRole('spinbutton', { name: 'Scale Y', exact: true }).fill('3');
  await page.getByRole('spinbutton', { name: 'Skew X', exact: true }).fill('60');
  await page.getByRole('spinbutton', { name: 'Skew Y', exact: true }).fill('-60');
  await page.getByRole('spinbutton', { name: 'Blur', exact: true }).fill('8');
  await page.getByLabel('Outline', { exact: true }).check();
  await page.getByRole('spinbutton', { name: 'Outline width', exact: true }).fill('8');

  const normalizedBounds = [];
  for (const size of ['48', '128', '256']) {
    await page.getByLabel('Export size').selectOption(size);
    await expect(page.getByRole('button', { name: 'Copy PNG' })).toBeEnabled();
    const bounds = await alphaBounds(page);
    expect(bounds.left).toBeGreaterThanOrEqual(0);
    expect(bounds.top).toBeGreaterThanOrEqual(0);
    expect(bounds.right).toBeLessThan(bounds.size);
    expect(bounds.bottom).toBeLessThan(bounds.size);
    normalizedBounds.push({
      left: bounds.left / bounds.size,
      top: bounds.top / bounds.size,
      right: bounds.right / bounds.size,
      bottom: bounds.bottom / bounds.size,
    });
  }

  expect(normalizedBounds[0]?.left).toBeCloseTo(normalizedBounds[2]?.left ?? 0, 1);
  expect(normalizedBounds[0]?.right).toBeCloseTo(normalizedBounds[2]?.right ?? 0, 1);
});

test('supports direct movement, keyboard nudging, undo, and redo', async ({ page }) => {
  const selection = page.locator('.selection-box');
  const bounds = await selection.boundingBox();
  expect(bounds).not.toBeNull();
  await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds!.x + bounds!.width / 2 + 40, bounds!.y + bounds!.height / 2);
  await page.mouse.up();
  expect(Number(await page.getByRole('spinbutton', { name: 'Position X', exact: true }).inputValue()))
    .toBeGreaterThan(0);

  await page.getByLabel(/Interactive emoji canvas/).focus();
  await page.keyboard.press('ArrowDown');
  expect(Number(await page.getByRole('spinbutton', { name: 'Position Y', exact: true }).inputValue()))
    .toBe(1);

  await page.getByRole('button', { name: /Undo/ }).click();
  expect(Number(await page.getByRole('spinbutton', { name: 'Position Y', exact: true }).inputValue()))
    .toBe(0);
  await page.getByRole('button', { name: /Redo/ }).click();
  expect(Number(await page.getByRole('spinbutton', { name: 'Position Y', exact: true }).inputValue()))
    .toBe(1);
});

test('paints, masks, orders, exports, and removes layers non-destructively', async ({ page }) => {
  await page.getByRole('button', { name: /Brush/ }).click();
  const canvas = page.getByLabel(/Interactive emoji canvas/);
  const bounds = await canvas.boundingBox();
  expect(bounds).not.toBeNull();
  const y = bounds!.y + bounds!.height / 2;
  await page.mouse.move(bounds!.x + bounds!.width * 0.35, y);
  await page.mouse.down();
  await page.mouse.move(bounds!.x + bounds!.width * 0.65, y, { steps: 8 });
  await page.mouse.up();

  const paintLayer = page.locator('.layer-select').filter({ hasText: 'Paint' });
  await expect(paintLayer).toContainText('1 stroke');
  await expect(page.getByRole('button', { name: 'Copy PNG' })).toBeEnabled();
  expect(await previewPixel(page, 256, 256)).toEqual([255, 79, 154, 255]);

  await page.getByRole('button', { name: /Undo/ }).click();
  await expect(paintLayer).toHaveCount(0);
  await page.getByRole('button', { name: /Redo/ }).click();
  await expect(paintLayer).toBeVisible();

  await page.getByRole('button', { name: 'Hide “Paint 1”' }).click();
  await expect(page.getByRole('button', { name: 'Copy PNG' })).toBeEnabled();
  expect((await previewPixel(page, 256, 256))[0]).toBe(255);
  expect((await previewPixel(page, 256, 256))[1]).toBeGreaterThan(150);
  await page.getByRole('button', { name: 'Show “Paint 1”' }).click();

  await paintLayer.click();
  await page.getByRole('button', { name: 'Move “Paint 1” backward' }).click();
  await expect(page.getByRole('button', { name: 'Copy PNG' })).toBeEnabled();
  expect((await previewPixel(page, 256, 256))[1]).toBeGreaterThan(150);
  await page.getByRole('button', { name: 'Move “Paint 1” forward' }).click();

  await page.getByRole('button', { name: /Eraser/ }).click();
  await page.getByLabel('Brush size').fill('0.08');
  await page.mouse.move(bounds!.x + bounds!.width * 0.35, y);
  await page.mouse.down();
  await page.mouse.move(bounds!.x + bounds!.width * 0.65, y, { steps: 8 });
  await page.mouse.up();
  await expect(paintLayer).toContainText('1 stroke');
  await expect(page.getByRole('button', { name: 'Copy PNG' })).toBeEnabled();
  expect((await previewPixel(page, 256, 256))[1]).toBeGreaterThan(150);

  const png = await downloadedPng(page);
  expect(png).toMatchObject({ width: 128, height: 128 });
  expect(png.center[1]).toBeGreaterThan(150);

  await page.getByRole('button', { name: 'Restore', exact: true }).click();
  await page.mouse.move(bounds!.x + bounds!.width * 0.48, y);
  await page.mouse.down();
  await page.mouse.move(bounds!.x + bounds!.width * 0.52, y, { steps: 4 });
  await page.mouse.up();
  await expect(page.getByRole('button', { name: 'Copy PNG' })).toBeEnabled();
  expect((await previewPixel(page, 256, 256))[1]).toBe(79);
  await page.getByRole('button', { name: /Undo/ }).click();
  await expect(page.getByRole('button', { name: 'Copy PNG' })).toBeEnabled();
  expect((await previewPixel(page, 256, 256))[1]).toBeGreaterThan(150);
  await page.getByRole('button', { name: /Redo/ }).click();
  await expect(page.getByRole('button', { name: 'Copy PNG' })).toBeEnabled();
  expect((await previewPixel(page, 256, 256))[1]).toBe(79);
  expect((await downloadedPng(page)).center[1]).toBe(79);

  await page.getByRole('button', { name: 'Delete “Paint 1”' }).click();
  await expect(paintLayer).toHaveCount(0);
  await page.getByRole('button', { name: /Undo/ }).click();
  await expect(paintLayer).toBeVisible();
});

test('renames, duplicates, fades, and transforms a complete paint layer', async ({ page }) => {
  await page.getByRole('button', { name: /Brush/ }).click();
  const viewport = page.getByLabel(/Interactive emoji canvas/);
  const bounds = await viewport.boundingBox();
  expect(bounds).not.toBeNull();
  const y = bounds!.y + bounds!.height / 2;
  await page.mouse.move(bounds!.x + bounds!.width * 0.35, y);
  await page.mouse.down();
  await page.mouse.move(bounds!.x + bounds!.width * 0.65, y, { steps: 8 });
  await page.mouse.up();

  await page.getByLabel('Name', { exact: true }).fill('Ink');
  await page.getByLabel('Name', { exact: true }).press('Enter');
  await page.getByRole('button', { name: 'Duplicate “Ink”' }).click();
  await expect(page.locator('.layer-select').filter({ hasText: 'Ink copy' })).toBeVisible();
  await page.getByRole('button', { name: 'Hide “Ink”' }).click();

  const opacity = page.getByRole('slider', { name: 'Layer opacity' });
  await opacity.fill('0');
  await expect(page.getByRole('button', { name: 'Copy PNG' })).toBeEnabled();
  expect((await previewPixel(page, 256, 256))[1]).toBeGreaterThan(150);
  await opacity.fill('1');
  await expect(page.getByRole('button', { name: 'Copy PNG' })).toBeEnabled();
  expect((await previewPixel(page, 256, 256))[1]).toBe(79);

  await page.getByRole('button', { name: /Select/ }).click();
  const selection = page.locator('.selection-box');
  const selectionBounds = await selection.boundingBox();
  expect(selectionBounds).not.toBeNull();
  await page.mouse.move(
    selectionBounds!.x + selectionBounds!.width / 2,
    selectionBounds!.y + selectionBounds!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    selectionBounds!.x + selectionBounds!.width / 2 + 180,
    selectionBounds!.y + selectionBounds!.height / 2,
  );
  await page.mouse.up();
  await expect(page.getByRole('button', { name: 'Copy PNG' })).toBeEnabled();
  expect((await previewPixel(page, 256, 256))[1]).toBeGreaterThan(150);
  await page.getByRole('button', { name: /Undo/ }).click();
  await expect(page.getByRole('button', { name: 'Copy PNG' })).toBeEnabled();
  expect((await previewPixel(page, 256, 256))[1]).toBe(79);
});

test('creates structured layers, multi-selects, aligns, group-transforms, and flood-fills', async ({ page }) => {
  await page.getByRole('button', { name: 'Add rectangle' }).click();
  await page.getByRole('button', { name: 'Add ellipse' }).click();
  await page.getByRole('button', { name: 'Add line' }).click();
  await page.getByRole('button', { name: 'Add text' }).click();
  await page.getByLabel('Text', { exact: true }).fill('Hello');
  await expect(page.getByLabel('Text', { exact: true })).toHaveValue('Hello');
  await expect(page.locator('.layer-select').filter({ hasText: 'Rectangle' })).toBeVisible();
  await expect(page.locator('.layer-select').filter({ hasText: 'Ellipse' })).toBeVisible();
  await expect(page.locator('.layer-select').filter({ hasText: 'Line' })).toBeVisible();

  const viewport = page.getByLabel(/Interactive emoji canvas/);
  await viewport.scrollIntoViewIfNeeded();
  let viewportBounds = await viewport.boundingBox();
  expect(viewportBounds).not.toBeNull();
  await page.mouse.move(viewportBounds!.x + 5, viewportBounds!.y + 5);
  await page.mouse.down();
  await page.mouse.move(viewportBounds!.x + viewportBounds!.width - 5,
    viewportBounds!.y + viewportBounds!.height - 5, { steps: 4 });
  await page.mouse.up();
  await expect(page.locator('.layer-item.selected')).toHaveCount(5);

  await page.locator('.layer-select').filter({ hasText: 'Text' }).click();
  const rectangle = page.locator('.layer-select').filter({ hasText: 'Rectangle' });
  await rectangle.click({ modifiers: ['Shift'] });
  await expect(page.locator('.layer-item.selected')).toHaveCount(2);
  await page.getByRole('button', { name: 'Align left' }).click();

  const selection = page.locator('.selection-box');
  const selectionBounds = await selection.boundingBox();
  expect(selectionBounds).not.toBeNull();
  await page.mouse.move(selectionBounds!.x + selectionBounds!.width / 2,
    selectionBounds!.y + selectionBounds!.height / 2);
  await page.mouse.down();
  await page.mouse.move(selectionBounds!.x + selectionBounds!.width / 2 + 30,
    selectionBounds!.y + selectionBounds!.height / 2);
  await page.mouse.up();
  await expect(page.getByRole('button', { name: /Undo/ })).toBeEnabled();

  for (const name of ['Line', 'Ellipse', 'Emoji']) {
    await page.locator('.layer-select').filter({ hasText: name }).click({ modifiers: ['Shift'] });
  }
  await expect(page.locator('.layer-item.selected')).toHaveCount(5);

  viewportBounds = await viewport.boundingBox();
  expect(viewportBounds).not.toBeNull();
  await page.getByRole('button', { name: 'Fill', exact: true }).click();
  await viewport.click({ position: {
    x: viewportBounds!.width * 0.05,
    y: viewportBounds!.height * 0.05,
  } });
  await expect(page.locator('.layer-select').filter({ hasText: 'Fill' })).toContainText('fill runs');
  await expect(page.getByRole('button', { name: 'Copy PNG' })).toBeEnabled();
  expect(await previewPixel(page, 25, 25)).toEqual([255, 79, 154, 255]);
});

test('zooms and pans the transient viewport without changing export', async ({ page }) => {
  const preview = await downloadedPng(page);
  const canvas = page.getByLabel(/Preview of/);
  const internalSize = await canvas.evaluate((element) => ({
    width: (element as HTMLCanvasElement).width,
    dpr: window.devicePixelRatio,
  }));
  expect(internalSize.width).toBe(Math.min(1024, Math.max(512, Math.round(512 * internalSize.dpr))));

  await page.getByRole('button', { name: 'Zoom in' }).click();
  await expect(page.getByLabel('Canvas zoom')).toHaveText('125%');
  await page.getByRole('button', { name: /Pan/ }).click();
  const viewport = page.getByLabel(/Interactive emoji canvas/);
  const bounds = await viewport.boundingBox();
  expect(bounds).not.toBeNull();
  await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds!.x + bounds!.width / 2 + 40, bounds!.y + bounds!.height / 2 + 25);
  await page.mouse.up();
  await expect(page.locator('.canvas-world')).toHaveAttribute('style', /translate\((?!0%)/);

  await page.getByRole('button', { name: 'Fit' }).click();
  await expect(page.getByLabel('Canvas zoom')).toHaveText('100%');
  await expect(page.locator('.canvas-world')).toHaveAttribute('style', /translate\(0%, 0%\) scale\(1\)/);
  expect(await downloadedPng(page)).toEqual(preview);
});

test('rejects a grapheme without artwork before changing the design', async ({ page }) => {
  await page.getByLabel('Paste another emoji').fill('A');
  await page.getByRole('button', { name: 'Use', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('No Twemoji');
  await expect(page.getByLabel('Preview of 😀')).toBeVisible();
});

test('confirms clipboard copy without naming a destination app', async ({ page }) => {
  await page.evaluate(() => {
    class TestClipboardItem {
      static supports(type: string) { return type === 'image/png'; }
      constructor(_items: Record<string, Blob>) {}
    }
    Object.defineProperty(window, 'ClipboardItem', { configurable: true, value: TestClipboardItem });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { write: async () => undefined },
    });
  });
  await page.getByRole('button', { name: 'Copy PNG' }).click();
  const notice = page.locator('.notice[role="status"]');
  await expect(notice).toHaveText(/PNG copied to your clipboard/);
  await expect(notice).not.toContainText('Discord');
});

test('persists, reapplies, and removes a favorite recipe', async ({ page }) => {
  await page.getByRole('spinbutton', { name: 'Rotate', exact: true }).fill('22');
  await page.getByRole('button', { name: '☆ Save this tweak' }).click();
  await page.getByLabel('Favorite name').fill('tilty');
  await page.locator('.favorite-form').getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('button', { name: 'tilty', exact: true })).toBeVisible();

  await page.reload();
  await expect(page.getByRole('button', { name: 'Copy PNG' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'tilty', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Reset edits' }).click();
  await expect(page.getByRole('spinbutton', { name: 'Rotate', exact: true })).toHaveValue('0');
  await page.getByRole('button', { name: 'tilty', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: 'Rotate', exact: true })).toHaveValue('22');

  await page.getByRole('button', { name: 'Remove “tilty”' }).click();
  await expect(page.getByRole('button', { name: 'tilty', exact: true })).toHaveCount(0);
});

test('autosaves named documents, exports and imports JSON, and exposes workspace shortcuts', async ({ page }) => {
  await page.getByLabel('Document name').fill('Sticker study');
  await page.getByRole('button', { name: 'Add rectangle' }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByLabel('Open document').locator('option')).toContainText(['Open…', 'Sticker study']);
  await expect(page.getByRole('status').filter({ hasText: 'Draft saved' })).toBeVisible();

  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export JSON' }).click();
  const download = await pending;
  const path = await download.path();
  expect(path).not.toBeNull();
  const exported = JSON.parse(await readFile(path!, 'utf8')) as { name: string; design: { layers: unknown[] } };
  expect(exported.name).toBe('Sticker study');
  expect(exported.design.layers).toHaveLength(2);

  await page.getByRole('button', { name: 'New', exact: true }).click();
  await expect(page.locator('.layer-select').filter({ hasText: 'Rectangle' })).toHaveCount(0);
  await page.getByLabel('Import design JSON').setInputFiles({
    name: 'sticker-study.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(exported)),
  });
  await expect(page.locator('.layer-select').filter({ hasText: 'Rectangle' })).toBeVisible();

  await page.getByLabel(/Interactive emoji canvas/).focus();
  await page.keyboard.press('ControlOrMeta+B');
  await expect(page.getByRole('button', { name: 'Brush', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('ControlOrMeta+A');
  await expect(page.locator('.layer-item.selected')).toHaveCount(2);
  await page.keyboard.press('ControlOrMeta+D');
  await expect(page.locator('.layer-item.selected')).toHaveCount(2);
  await expect(page.getByRole('status').filter({ hasText: 'Saving draft' })).toBeVisible();
  await page.keyboard.press('ControlOrMeta+G');
  await expect(page.locator('.notice')).toContainText('Grouped 2 layers');

  await page.getByText('Grid', { exact: true }).click();
  await page.getByLabel('Show grid').check();
  await page.getByLabel('Grid divisions').selectOption('16');
  await expect(page.locator('.grid-overlay line')).toHaveCount(30);

  await expect(page.getByRole('status').filter({ hasText: 'Draft saved' })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Document name')).toHaveValue('Sticker study');
  await expect(page.locator('.layer-select').filter({ hasText: 'copy' })).toHaveCount(2);
});

test('has no horizontal overflow and prioritizes preview on a narrow screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const layout = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
    previewTop: document.querySelector('.preview-region')?.getBoundingClientRect().top,
    pickerTop: document.querySelector('.picker-region')?.getBoundingClientRect().top,
  }));
  expect(layout.scrollWidth).toBe(layout.viewportWidth);
  expect(layout.previewTop).toBeLessThan(layout.pickerTop ?? 0);
});
