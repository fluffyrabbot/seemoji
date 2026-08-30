import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const TWEMOJI_MANIFEST = JSON.parse(await readFile(
  new URL('../public/packs/twemoji/15.1.0/manifest.json', import.meta.url),
  'utf8',
)) as { readonly assetRoot: string; readonly glyphs: readonly string[] };
const NOTO_MANIFEST = JSON.parse(await readFile(
  new URL('../public/packs/noto/2.042.0/manifest.json', import.meta.url),
  'utf8',
)) as { readonly assetRoot: string; readonly glyphs: readonly string[] };
const FLUENT_MANIFEST = JSON.parse(await readFile(
  new URL('../public/packs/fluent/1.0.0/color/manifest.json', import.meta.url),
  'utf8',
)) as { readonly assetRoot: string; readonly glyphs: readonly string[] };
const FLUENT_COLOR_MANIFEST = JSON.parse(await readFile(
  new URL('../public/packs/fluent/1.1.0/color/manifest.json', import.meta.url), 'utf8',
)) as { readonly assetRoot: string; readonly glyphs: readonly string[] };
const FLUENT_FLAT_MANIFEST = JSON.parse(await readFile(
  new URL('../public/packs/fluent/1.1.0/flat/manifest.json', import.meta.url), 'utf8',
)) as { readonly assetRoot: string; readonly glyphs: readonly string[] };
const FLUENT_HIGH_CONTRAST_MANIFEST = JSON.parse(await readFile(
  new URL('../public/packs/fluent/1.1.0/high-contrast/manifest.json', import.meta.url), 'utf8',
)) as { readonly assetRoot: string; readonly glyphs: readonly string[] };
const OPENMOJI_MANIFEST = JSON.parse(await readFile(
  new URL('../public/packs/openmoji/17.0.0/color/manifest.json', import.meta.url),
  'utf8',
)) as { readonly assetRoot: string; readonly glyphs: readonly string[] };
const FXEMOJI_MANIFEST = JSON.parse(await readFile(
  new URL('../public/packs/fxemoji/1.7.9/manifest.json', import.meta.url), 'utf8',
)) as { readonly assetRoot: string; readonly glyphs: readonly string[] };
const EMOJITWO_MANIFEST = JSON.parse(await readFile(
  new URL('../public/packs/emojitwo/2.2.7/manifest.json', import.meta.url), 'utf8',
)) as { readonly assetRoot: string; readonly glyphs: readonly string[] };
const BLOBMOJI_MANIFEST = JSON.parse(await readFile(
  new URL('../public/packs/blobmoji/1.0.0/manifest.json', import.meta.url), 'utf8',
)) as { readonly assetRoot: string; readonly glyphs: readonly string[] };
const SERENITY_MANIFEST = JSON.parse(await readFile(
  new URL('../public/packs/serenity/1.0.0/manifest.json', import.meta.url), 'utf8',
)) as { readonly assetRoot: string; readonly glyphs: readonly string[] };
const ASSET_ROOTS = [
  TWEMOJI_MANIFEST.assetRoot,
  NOTO_MANIFEST.assetRoot,
  FLUENT_MANIFEST.assetRoot,
  FLUENT_COLOR_MANIFEST.assetRoot,
  FLUENT_FLAT_MANIFEST.assetRoot,
  FLUENT_HIGH_CONTRAST_MANIFEST.assetRoot,
  OPENMOJI_MANIFEST.assetRoot,
  FXEMOJI_MANIFEST.assetRoot,
  EMOJITWO_MANIFEST.assetRoot,
  BLOBMOJI_MANIFEST.assetRoot,
  SERENITY_MANIFEST.assetRoot,
] as const;
const SMILE_ASSET_URL = `${TWEMOJI_MANIFEST.assetRoot}svg/1f604.svg`;

const FIXTURE_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <circle cx="50" cy="50" r="46" fill="#ffcc4d"/>
  <circle cx="34" cy="40" r="6" fill="#3b2f2f"/>
  <circle cx="66" cy="40" r="6" fill="#3b2f2f"/>
  <path d="M25 61 Q50 86 75 61" fill="none" stroke="#3b2f2f" stroke-width="8" stroke-linecap="round"/>
</svg>`;
const FIXTURE_PNG = await readFile(new URL(
  './editor.spec.ts-snapshots/default-preview.png',
  import.meta.url,
));

const mockArtwork = async (page: Page) => {
  await page.route('https://cdn.jsdelivr.net/**', (route) => route.abort('blockedbyclient'));
  for (const assetRoot of ASSET_ROOTS) {
    await page.route(`${assetRoot}**`, async (route) => {
      const png = assetRoot === SERENITY_MANIFEST.assetRoot;
      await route.fulfill({
        status: 200,
        contentType: png ? 'image/png' : 'image/svg+xml',
        headers: { 'access-control-allow-origin': '*' },
        body: png ? FIXTURE_PNG : FIXTURE_SVG,
      });
    });
  }
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
    const sampleX = Math.min(canvas.width - 1, Math.round(point.x * canvas.width / 512));
    const sampleY = Math.min(canvas.height - 1, Math.round(point.y * canvas.height / 512));
    return [...context.getImageData(sampleX, sampleY, 1, 1).data];
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

const openProjectMenu = async (page: Page) => {
  const menu = page.locator('.workspace-menu');
  if (await menu.getAttribute('open') === null) {
    await menu.locator('summary').click();
  }
};

const runProjectAction = async (page: Page, name: string) => {
  await openProjectMenu(page);
  await page.getByRole('button', { name }).click();
};

test.beforeEach(async ({ page }) => {
  await mockArtwork(page);
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Copy PNG' })).toBeEnabled({ timeout: 15_000 });
});

test(
  'renders a stable default preview',
  { tag: '@visual' },
  async ({ page }) => {
    await expect(page.getByLabel('Preview of 😀')).toHaveScreenshot('default-preview.png');
  },
);

test('does not apply delayed emoji validation to a different active project', async ({ page }) => {
  let reportValidationStarted!: () => void;
  let releaseValidation!: () => void;
  const validationStarted = new Promise<void>((resolve) => { reportValidationStarted = resolve; });
  const validationGate = new Promise<void>((resolve) => { releaseValidation = resolve; });
  await page.route(SMILE_ASSET_URL, async (route) => {
    reportValidationStarted();
    await validationGate;
    await route.fulfill({
      status: 200,
      contentType: 'image/svg+xml',
      headers: { 'access-control-allow-origin': '*' },
      body: FIXTURE_SVG,
    });
  });

  await page.getByRole('button', { name: 'Use 😄' }).click();
  await validationStarted;
  await page.getByRole('button', { name: 'New' }).click();
  await expect(page.getByLabel('Open project').locator('option')).toHaveCount(3);
  await expect(page.getByLabel(/Preview of 😀/)).toBeVisible();

  releaseValidation();
  await expect(page.getByRole('button', { name: 'Use 😄' })).toBeEnabled();
  await expect(page.getByLabel(/Preview of 😀/)).toBeVisible();
});

test('does not apply delayed emoji validation over a same-project remote design', async ({
  page,
  context,
}) => {
  let reportValidationStarted!: () => void;
  let releaseValidation!: () => void;
  const validationStarted = new Promise<void>((resolve) => { reportValidationStarted = resolve; });
  const validationGate = new Promise<void>((resolve) => { releaseValidation = resolve; });
  await page.route(SMILE_ASSET_URL, async (route) => {
    reportValidationStarted();
    await validationGate;
    await route.fulfill({
      status: 200,
      contentType: 'image/svg+xml',
      headers: { 'access-control-allow-origin': '*' },
      body: FIXTURE_SVG,
    });
  });

  const second = await context.newPage();
  await mockArtwork(second);
  await second.goto('/');
  await expect(second.getByRole('button', { name: 'Copy PNG' })).toBeEnabled();
  await openProjectMenu(second);

  await page.getByRole('button', { name: 'Use 😄' }).click();
  await validationStarted;
  await page.getByRole('button', { name: 'Eraser' }).click();
  const stage = page.getByLabel(/Interactive emoji canvas/);
  const bounds = await stage.boundingBox();
  expect(bounds).not.toBeNull();
  await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2);
  await page.mouse.down();

  // Firefox shares pointer input across pages. Synthetic activation models an
  // independent remote actor without completing the first tab's held gesture.
  await second.getByRole('button', { name: 'Use 😁' }).dispatchEvent('click');
  await expect(second.getByLabel(/Preview of 😁/)).toBeVisible();
  await second.getByRole('button', { name: 'Save now' }).dispatchEvent('click');
  await expect(page.getByLabel(/Preview of 😁/)).toBeVisible();
  await page.mouse.up();

  releaseValidation();
  await expect(page.getByRole('button', { name: 'Use 😄' })).toBeEnabled();
  await expect(page.getByLabel(/Preview of 😁/)).toBeVisible();
  const pendingDownload = page.waitForEvent('download');
  await runProjectAction(page, 'Export editable project');
  const exportPath = await (await pendingDownload).path();
  expect(exportPath).not.toBeNull();
  const exported = JSON.parse(await readFile(exportPath!, 'utf8')) as {
    readonly design: {
      readonly layers: readonly {
        readonly source?: { readonly grapheme: string };
        readonly mask: readonly unknown[];
      }[];
    };
  };
  expect(exported.design.layers[0]?.source?.grapheme).toBe('😁');
  expect(exported.design.layers[0]?.mask).toEqual([]);
  await second.close();
});

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
  const restoredCenter = (await downloadedPng(page)).center;
  expect(restoredCenter[1]).toBeGreaterThanOrEqual(75);
  expect(restoredCenter[1]).toBeLessThanOrEqual(85);

  await page.getByRole('button', { name: 'Delete “Paint 1”' }).click();
  await expect(paintLayer).toHaveCount(0);
  await page.getByRole('button', { name: /Undo/ }).click();
  await expect(paintLayer).toBeVisible();
});

test('keeps erase and restore masks attached through affine transforms', async ({ page }) => {
  const viewport = page.getByLabel(/Interactive emoji canvas/);
  await page.getByRole('spinbutton', { name: 'Position X', exact: true }).fill('10');
  await page.getByRole('spinbutton', { name: 'Rotate', exact: true }).fill('90');
  await page.getByRole('spinbutton', { name: 'Size', exact: true }).fill('0.8');
  await page.getByRole('button', { name: /Eraser/ }).click();
  await page.getByLabel('Brush size').fill('0.08');
  const bounds = await viewport.boundingBox();
  expect(bounds).not.toBeNull();
  await page.mouse.move(bounds!.x + bounds!.width * 0.68, bounds!.y + bounds!.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(
    bounds!.x + bounds!.width * 0.76,
    bounds!.y + bounds!.height * 0.5,
    { steps: 8 },
  );
  await page.mouse.up();
  await expect(page.getByRole('button', { name: 'Copy PNG' })).toBeEnabled();
  expect((await previewPixel(page, 0.72 * 512, 0.5 * 512))[3]).toBeLessThan(10);

  await page.getByRole('spinbutton', { name: 'Position X', exact: true }).fill('-10');
  await page.getByRole('spinbutton', { name: 'Rotate', exact: true }).fill('-90');
  await page.getByRole('spinbutton', { name: 'Size', exact: true }).fill('1.1');
  await expect(page.getByRole('button', { name: 'Copy PNG' })).toBeEnabled();
  expect((await previewPixel(page, 0.235 * 512, 0.5 * 512))[3]).toBeLessThan(10);

  await page.getByRole('button', { name: 'Restore', exact: true }).click();
  await page.getByLabel('Brush size').fill('0.024');
  await page.mouse.move(bounds!.x + bounds!.width * 0.232, bounds!.y + bounds!.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(
    bounds!.x + bounds!.width * 0.238,
    bounds!.y + bounds!.height * 0.5,
    { steps: 4 },
  );
  await page.mouse.up();
  await expect(page.getByRole('button', { name: 'Copy PNG' })).toBeEnabled();
  expect((await previewPixel(page, 0.235 * 512, 0.5 * 512))[3]).toBeGreaterThan(200);

  await page.getByRole('spinbutton', { name: 'Position X', exact: true }).fill('20');
  await page.getByRole('spinbutton', { name: 'Rotate', exact: true }).fill('0');
  await page.getByRole('spinbutton', { name: 'Size', exact: true }).fill('0.6');
  await expect(page.getByRole('button', { name: 'Copy PNG' })).toBeEnabled();
  expect((await previewPixel(page, 0.7 * 512, 0.41 * 512))[3]).toBeGreaterThan(200);
  expect((await previewPixel(page, 0.7 * 512, 0.38 * 512))[3]).toBeLessThan(10);
});

test('clips outlined and blurred emoji effects with the final transformed mask', async ({ page }) => {
  await page.getByRole('spinbutton', { name: 'Position X', exact: true }).fill('10');
  await page.getByRole('spinbutton', { name: 'Position Y', exact: true }).fill('-5');
  await page.getByRole('spinbutton', { name: 'Rotate', exact: true }).fill('35');
  await page.getByRole('spinbutton', { name: 'Size', exact: true }).fill('0.9');
  await page.getByRole('spinbutton', { name: 'Blur', exact: true }).fill('4');
  await page.getByLabel('Outline', { exact: true }).check();
  await page.getByRole('spinbutton', { name: 'Outline width', exact: true }).fill('4');

  const viewport = page.getByLabel(/Interactive emoji canvas/);
  await page.getByRole('button', { name: /Eraser/ }).click();
  await page.getByLabel('Brush size').fill('0.05');
  const bounds = await viewport.boundingBox();
  expect(bounds).not.toBeNull();
  await page.mouse.move(bounds!.x + bounds!.width * 0.59, bounds!.y + bounds!.height * 0.45);
  await page.mouse.down();
  await page.mouse.move(
    bounds!.x + bounds!.width * 0.61,
    bounds!.y + bounds!.height * 0.45,
    { steps: 4 },
  );
  await page.mouse.up();
  await expect(page.getByRole('button', { name: 'Copy PNG' })).toBeEnabled();
  expect((await previewPixel(page, 0.6 * 512, 0.45 * 512))[3]).toBeLessThan(10);
  expect((await previewPixel(page, 0.67 * 512, 0.45 * 512))[3]).toBeGreaterThan(200);

  await page.getByRole('spinbutton', { name: 'Position X', exact: true }).fill('-15');
  await page.getByRole('spinbutton', { name: 'Position Y', exact: true }).fill('10');
  await page.getByRole('spinbutton', { name: 'Rotate', exact: true }).fill('-70');
  await page.getByRole('spinbutton', { name: 'Size', exact: true }).fill('1.1');
  await expect(page.getByRole('button', { name: 'Copy PNG' })).toBeEnabled();
  expect((await previewPixel(page, 0.35 * 512, 0.6 * 512))[3]).toBeLessThan(10);
  expect((await previewPixel(page, 0.42 * 512, 0.6 * 512))[3]).toBeGreaterThan(200);
});

test('maps masks through the full affine transform of non-emoji layers', async ({ page }) => {
  const design = {
    version: 2,
    canvas: { background: 'transparent' },
    layers: [
      {
        id: 'emoji-1', kind: 'emoji', name: 'Emoji', visible: true, opacity: 1,
        source: { pack: 'twemoji', packVersion: '15.1.0', codepoint: '1f600', grapheme: '😀' },
        transform: { x: 0, y: 0, rotate: 0, scaleX: 1, scaleY: 1,
          skewX: 0, skewY: 0, flipH: false, flipV: false },
        appearance: { hue: 0, saturation: 1, brightness: 1, blur: 0, outline: null },
        mask: [],
      },
      {
        id: 'shape-1', kind: 'shape', name: 'Affine shape', visible: true, opacity: 1,
        transform: { x: 0.1, y: -0.05, rotate: 60, scaleX: 1.2, scaleY: 0.7,
          skewX: 15, skewY: -10, flipH: true, flipV: false },
        mask: [], shape: 'rectangle', bounds: { x: 0.2, y: 0.2, width: 0.6, height: 0.6 },
        fill: '#ff4f9a', stroke: null,
      },
    ],
  };
  await openProjectMenu(page);
  await page.getByLabel('Import editable project').setInputFiles({
    name: 'affine-shape.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(design)),
  });
  await expect(page.locator('.layer-select').filter({ hasText: 'Affine shape' })).toBeVisible();
  await page.getByRole('button', { name: 'Hide “Emoji”' }).click();

  const viewport = page.getByLabel(/Interactive emoji canvas/);
  await page.getByRole('button', { name: /Eraser/ }).click();
  await page.getByLabel('Brush size').fill('0.05');
  const bounds = await viewport.boundingBox();
  expect(bounds).not.toBeNull();
  await page.mouse.move(bounds!.x + bounds!.width * 0.691865, bounds!.y + bounds!.height * 0.284363);
  await page.mouse.down();
  await page.mouse.move(
    bounds!.x + bounds!.width * 0.61354,
    bounds!.y + bounds!.height * 0.377707,
    { steps: 8 },
  );
  await page.mouse.up();
  await expect(page.getByRole('button', { name: 'Copy PNG' })).toBeEnabled();
  expect((await previewPixel(page, 0.652703 * 512, 0.331035 * 512))[3]).toBeLessThan(10);

  await page.getByRole('button', { name: /Select/ }).click();
  await viewport.focus();
  await page.keyboard.press('Shift+ArrowRight');
  await expect(page.getByRole('button', { name: 'Copy PNG' })).toBeEnabled();
  expect((await previewPixel(page, 0.702703 * 512, 0.331035 * 512))[3]).toBeLessThan(10);

  await page.getByRole('button', { name: 'Restore', exact: true }).click();
  await page.getByLabel('Brush size').fill('0.012');
  const restoreBounds = await viewport.boundingBox();
  expect(restoreBounds).not.toBeNull();
  await page.mouse.move(
    restoreBounds!.x + restoreBounds!.width * 0.70035,
    restoreBounds!.y + restoreBounds!.height * 0.328235,
  );
  await page.mouse.down();
  await page.mouse.move(
    restoreBounds!.x + restoreBounds!.width * 0.705052,
    restoreBounds!.y + restoreBounds!.height * 0.333835,
    { steps: 4 },
  );
  await page.mouse.up();
  await expect(page.getByRole('button', { name: 'Copy PNG' })).toBeEnabled();
  expect((await previewPixel(page, 0.702703 * 512, 0.331035 * 512))[3]).toBeGreaterThan(200);

  await page.getByRole('button', { name: /Select/ }).click();
  await viewport.focus();
  await page.keyboard.press('Shift+ArrowDown');
  await expect(page.getByRole('button', { name: 'Copy PNG' })).toBeEnabled();
  expect((await previewPixel(page, 0.702703 * 512, 0.381035 * 512))[3]).toBeGreaterThan(200);
  expect((await previewPixel(page, 0.734032 * 512, 0.343697 * 512))[3]).toBeLessThan(10);
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
  await expect(page.locator('.canvas-world')).toHaveAttribute(
    'style',
    /translate\(0%(?:, 0%)?\) scale\(1\)/,
  );
  expect(await downloadedPng(page)).toEqual(preview);
});

test('rejects a grapheme without artwork before changing the design', async ({ page }) => {
  const assetRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/41.svg')) assetRequests.push(request.url());
  });
  await page.getByLabel('Paste another emoji').fill('A');
  await page.getByRole('button', { name: 'Use', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('No Twemoji');
  await expect(page.getByLabel('Preview of 😀')).toBeVisible();
  expect(assetRequests).toEqual([]);
});

test('switches among canonical pack artwork with explicit styled identity', async ({ page }) => {
  const library = page.getByLabel('Emoji library', { exact: true });
  const selectPack = async (pack: string, name: string) => {
    await library.selectOption(pack);
    await expect(page.locator('.app-footer')).toContainText(name);
    await expect(library).toBeEnabled();
  };
  const shareAlikeNotice = page.getByText(
    'This PNG is a CC BY-SA 4.0 derivative. Share-alike applies if you distribute it.',
    { exact: true },
  );
  await expect(shareAlikeNotice).toHaveCount(0);

  await selectPack('noto', 'Noto Emoji');
  await expect(page.locator('.emoji-grid img').first()).toHaveAttribute(
    'src',
    new RegExp(`^${NOTO_MANIFEST.assetRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
  );

  await selectPack('fluent', 'Microsoft Fluent Emoji');
  await expect(page.getByLabel('Emoji library version')).toHaveValue('1.1.0');
  await expect(page.getByLabel('Emoji library style')).toHaveValue('color');
  await expect(page.getByLabel('Emoji library style').locator('option')).toHaveCount(3);
  await expect(page.locator('.emoji-grid img').first()).toHaveAttribute(
    'src',
    new RegExp(`^${FLUENT_COLOR_MANIFEST.assetRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
  );
  await page.getByLabel('Emoji library style').selectOption('flat');
  await expect(page.getByLabel('Emoji library style')).toBeEnabled();
  await expect(page.locator('.emoji-grid img').first()).toHaveAttribute(
    'src',
    new RegExp(`^${FLUENT_FLAT_MANIFEST.assetRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
  );
  const pendingDownload = page.waitForEvent('download');
  await runProjectAction(page, 'Export editable project');
  const path = await (await pendingDownload).path();
  expect(path).not.toBeNull();
  const exported = JSON.parse(await readFile(path!, 'utf8')) as {
    readonly design: { readonly layers: ReadonlyArray<{ readonly source?: {
      readonly pack: string;
      readonly packVersion: string;
      readonly style?: string;
    } }> } };
  expect(exported.design.layers.find(({ source }) => source)?.source).toMatchObject({
    pack: 'fluent',
    packVersion: '1.1.0',
    style: 'flat',
  });
  await page.getByLabel('Emoji library style').selectOption('high-contrast');
  await expect(page.getByLabel('Emoji library style')).toBeEnabled();
  await expect(page.locator('.emoji-grid img').first()).toHaveAttribute(
    'src',
    new RegExp(`^${FLUENT_HIGH_CONTRAST_MANIFEST.assetRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
  );
  await page.getByLabel('Emoji library version').selectOption('1.0.0');
  await expect(library).toBeEnabled();
  await expect(page.getByLabel('Emoji library style')).toHaveCount(0);
  await expect(page.locator('.emoji-grid img').first()).toHaveAttribute(
    'src',
    new RegExp(`^${FLUENT_MANIFEST.assetRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
  );
  await page.getByLabel('Emoji library version').selectOption('1.1.0');
  await expect(library).toBeEnabled();
  await expect(page.getByLabel('Emoji library style')).toHaveValue('color');

  await selectPack('openmoji', 'OpenMoji');
  await expect(shareAlikeNotice).toBeVisible();
  await expect(page.locator('.emoji-grid img').first()).toHaveAttribute(
    'src',
    new RegExp(`^${OPENMOJI_MANIFEST.assetRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
  );
  expect(await downloadedPng(page)).toMatchObject({ width: 128, height: 128 });
  await expect(shareAlikeNotice).toBeVisible();

  for (const [pack, name] of [
    ['fxemoji', 'FxEmoji'],
    ['emojitwo', 'EmojiTwo'],
    ['blobmoji', 'Blobmoji'],
  ] as const) {
    await selectPack(pack, name);
    await expect(shareAlikeNotice).toHaveCount(0);
  }

  await selectPack('serenity', 'SerenityOS');
  await expect(shareAlikeNotice).toHaveCount(0);
  await expect(page.locator('.emoji-grid img').first()).toHaveAttribute(
    'src',
    new RegExp(`^${SERENITY_MANIFEST.assetRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
    { timeout: 15_000 },
  );
  expect(await downloadedPng(page)).toMatchObject({ width: 128, height: 128 });

  await page.getByRole('button', { name: 'All packs & licenses' }).click();
  const licenses = page.getByRole('dialog', { name: 'Emoji packs & licenses' });
  await expect(licenses).toBeVisible();
  for (const name of [
    'Twemoji', 'Noto Emoji', 'Fluent Emoji', 'OpenMoji',
    'FxEmoji', 'EmojiTwo', 'Blobmoji', 'SerenityOS Emoji',
  ]) {
    await expect(licenses).toContainText(name);
  }
  await expect(licenses).toContainText('CC-BY-SA-4.0 · share-alike');
  await licenses.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(licenses).not.toBeVisible();
});

test('serializes an immediate skin-tone pick behind a Fluent style change', async ({ page }) => {
  const library = page.getByLabel('Emoji library', { exact: true });
  await library.selectOption('fluent');
  await expect(page.locator('.emoji-grid img').first()).toHaveAttribute(
    'src',
    new RegExp(`^${FLUENT_COLOR_MANIFEST.assetRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
  );
  await expect(library).toBeEnabled();

  let releaseFlatValidation!: () => void;
  const flatValidation = new Promise<void>((resolve) => { releaseFlatValidation = resolve; });
  await page.route('**/packs/fluent/1.1.0/flat/manifest.json', async (route) => {
    await flatValidation;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(FLUENT_FLAT_MANIFEST),
    });
  });

  const style = page.getByLabel('Emoji library style');
  const input = page.getByLabel('Paste another emoji');
  await style.selectOption('flat');
  await expect(input).toBeDisabled();
  releaseFlatValidation();
  await input.fill('👍🏻');
  await page.getByRole('button', { name: 'Use', exact: true }).click();
  await expect(page.getByLabel('Preview of 👍🏻')).toBeVisible();

  const pendingDownload = page.waitForEvent('download');
  await runProjectAction(page, 'Export editable project');
  const path = await (await pendingDownload).path();
  expect(path).not.toBeNull();
  const exported = JSON.parse(await readFile(path!, 'utf8')) as {
    readonly design: { readonly layers: ReadonlyArray<{ readonly source?: {
      readonly grapheme: string;
      readonly pack: string;
      readonly packVersion: string;
      readonly style?: string;
    } }> };
  };
  expect(exported.design.layers.find(({ source }) => source)?.source).toMatchObject({
    grapheme: '👍🏻',
    pack: 'fluent',
    packVersion: '1.1.0',
    style: 'flat',
  });
});

test('keeps the design unchanged when a selected pack omits the active glyph', async ({ page }) => {
  await page.route('**/packs/noto/2.042.0/manifest.json', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ ...NOTO_MANIFEST, glyphs: NOTO_MANIFEST.glyphs.filter(
      (codepoint) => codepoint !== '1f600',
    ) }),
  }));
  await page.getByLabel('Emoji library', { exact: true }).selectOption('noto');
  await expect(page.getByRole('alert')).toContainText('No Noto Emoji 2.042.0 artwork exists for 😀');
  await expect(page.getByLabel('Preview of 😀')).toBeVisible();
  await expect(page.locator('.app-footer')).toContainText('Twemoji');
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

test('persists starred projects and creates explicit template copies', async ({ page }) => {
  await page.getByLabel('Project name').fill('tilty');
  await page.getByRole('spinbutton', { name: 'Rotate', exact: true }).fill('22');
  await runProjectAction(page, '☆ Add to templates');
  await expect(page.getByRole('button', { name: 'tilty', exact: true })).toBeVisible();

  await page.reload();
  await expect(page.getByRole('button', { name: 'Copy PNG' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'tilty', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: 'Rotate', exact: true })).toHaveValue('0');
  await page.getByRole('button', { name: 'tilty', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: 'Rotate', exact: true })).toHaveValue('22');

  await page.getByRole('button', { name: 'Use “tilty” as a template' }).click();
  await expect(page.getByLabel('Project name')).toHaveValue('tilty copy');
  await expect(page.getByRole('spinbutton', { name: 'Rotate', exact: true })).toHaveValue('22');
  await page.getByRole('button', { name: 'tilty', exact: true }).click();
  await runProjectAction(page, '★ Remove from templates');
  await expect(page.getByRole('button', { name: 'tilty', exact: true })).toHaveCount(0);
});

test('captures accepted edits synchronously when pagehide follows in the same task', async ({ page }) => {
  await page.evaluate(async () => {
    const name = document.querySelector<HTMLInputElement>('input[aria-label="Project name"]');
    const rotate = [...document.querySelectorAll<HTMLInputElement>('input[type="number"]')]
      .find((input) => input.labels
        ? [...input.labels].some((label) => label.textContent?.trim() === 'Rotate')
        : false);
    if (!name || !rotate) throw new Error('missing synchronous durability controls');
    name.value = 'Immediate durability';
    name.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    rotate.value = '43';
    rotate.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    await Promise.resolve();
    const status = document.querySelector('[role="status"].persistence-status');
    if (status?.textContent !== 'Saving locally…') {
      throw new Error(`edit did not synchronously enter the persistence journal: ${status?.textContent}`);
    }
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
  });
  await expect(page.getByText('Saved locally', { exact: true })).toBeVisible();
  await page.reload({ waitUntil: 'domcontentloaded' });

  await expect(page.getByRole('button', { name: 'Copy PNG' })).toBeEnabled();
  await expect(page.getByLabel('Project name')).toHaveValue('Immediate durability');
  await expect(page.getByRole('spinbutton', { name: 'Rotate', exact: true })).toHaveValue('43');
});

test('autosaves projects, exports and imports JSON, and exposes workspace shortcuts', async ({ page }) => {
  await page.getByLabel('Project name').fill('Sticker study');
  await page.getByRole('button', { name: 'Add rectangle' }).click();
  await runProjectAction(page, 'Save now');
  await expect(page.getByLabel('Open project').locator('option')).toContainText(['Open…', 'Sticker study']);
  await expect(page.getByText('Saved locally', { exact: true })).toBeVisible();

  const pending = page.waitForEvent('download');
  await openProjectMenu(page);
  await page.getByRole('button', { name: 'Export editable project' }).click();
  const download = await pending;
  const path = await download.path();
  expect(path).not.toBeNull();
  const exported = JSON.parse(await readFile(path!, 'utf8')) as { name: string; design: { layers: unknown[] } };
  expect(exported.name).toBe('Sticker study');
  expect(exported.design.layers).toHaveLength(2);

  await page.getByRole('button', { name: 'New', exact: true }).click();
  await expect(page.locator('.layer-select').filter({ hasText: 'Rectangle' })).toHaveCount(0);
  await page.getByLabel('Import editable project').setInputFiles({
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
  await expect(page.getByRole('status').filter({ hasText: 'Saving locally' })).toBeVisible();
  await page.keyboard.press('ControlOrMeta+G');
  await expect(page.locator('.notice')).toContainText('Grouped 2 layers');

  await page.getByText('Grid', { exact: true }).click();
  await page.getByLabel('Show grid').check();
  await page.getByLabel('Grid divisions').selectOption('16');
  await expect(page.locator('.grid-overlay line')).toHaveCount(30);

  await expect(page.getByText('Saved locally', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Project name')).toHaveValue('Sticker study');
  await expect(page.locator('.layer-select').filter({ hasText: 'copy' })).toHaveCount(2);
});

test('migrates a version 1 project database and records schema ownership', async ({ page }) => {
  await page.getByLabel('Project name').fill('Legacy migration fixture');
  await runProjectAction(page, 'Save now');
  await page.evaluate(async () => {
    const open = (version?: number) => new Promise<IDBDatabase>((resolve, reject) => {
      const request = version === undefined ? indexedDB.open('seemoji') : indexedDB.open('seemoji', version);
      request.addEventListener('success', () => resolve(request.result), { once: true });
      request.addEventListener('error', () => reject(request.error), { once: true });
    });
    const database = await open();
    const transaction = database.transaction(['projects', 'workspace']);
    const completed = new Promise<void>((resolve, reject) => {
      transaction.addEventListener('complete', () => resolve(), { once: true });
      transaction.addEventListener('error', () => reject(transaction.error), { once: true });
    });
    const projectsRequest = transaction.objectStore('projects').getAll();
    const activeRequest = transaction.objectStore('workspace').get('activeProjectId');
    const result = <T,>(request: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
      request.addEventListener('success', () => resolve(request.result), { once: true });
      request.addEventListener('error', () => reject(request.error), { once: true });
    });
    const [projects, active] = await Promise.all([
      result(projectsRequest),
      result(activeRequest),
      completed,
    ]) as [unknown[], { key: string; value: string }, void];
    database.close();
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase('seemoji');
      request.addEventListener('success', () => resolve(), { once: true });
      request.addEventListener('error', () => reject(request.error), { once: true });
    });
    const legacy = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('seemoji', 1);
      request.addEventListener('upgradeneeded', () => {
        const projectStore = request.result.createObjectStore('projects', { keyPath: 'id' });
        for (const project of projects) projectStore.put(project);
        request.result.createObjectStore('workspace', { keyPath: 'key' }).put(active);
      }, { once: true });
      request.addEventListener('success', () => resolve(request.result), { once: true });
      request.addEventListener('error', () => reject(request.error), { once: true });
    });
    legacy.close();
  });

  await page.reload();
  await expect(page.getByLabel('Project name')).toHaveValue('Legacy migration fixture');
  await expect(page.getByRole('button', { name: 'Copy PNG' })).toBeEnabled();
  await expect(page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('seemoji');
      request.addEventListener('success', () => resolve(request.result), { once: true });
      request.addEventListener('error', () => reject(request.error), { once: true });
    });
    const request = database.transaction('workspace').objectStore('workspace').get('schema');
    const metadata = await new Promise<unknown>((resolve, reject) => {
      request.addEventListener('success', () => resolve(request.result), { once: true });
      request.addEventListener('error', () => reject(request.error), { once: true });
    });
    const version = database.version;
    database.close();
    return { version, metadata };
  })).resolves.toEqual({
    version: 2,
    metadata: { key: 'schema', databaseVersion: 2, projectSchemaVersion: 2 },
  });
});

test('exports and atomically imports a workspace archive with corrupt-record details', async ({ page }) => {
  await page.getByLabel('Project name').fill('Archive source');
  await runProjectAction(page, 'Save now');
  await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('seemoji');
      request.addEventListener('success', () => resolve(request.result), { once: true });
      request.addEventListener('error', () => reject(request.error), { once: true });
    });
    const transaction = database.transaction('projects', 'readwrite');
    transaction.objectStore('projects').put({ id: 'broken-recovery-record', schemaVersion: 2 });
    await new Promise<void>((resolve, reject) => {
      transaction.addEventListener('complete', () => resolve(), { once: true });
      transaction.addEventListener('error', () => reject(transaction.error), { once: true });
    });
    database.close();
  });
  await page.reload();
  await expect(page.getByRole('button', { name: 'Copy PNG' })).toBeEnabled();
  await expect(page.getByText('Recovery attention needed')).toBeVisible();
  await expect(page.getByText('broken-recovery-record', { exact: true })).toBeVisible();

  const download = page.waitForEvent('download');
  await openProjectMenu(page);
  await page.getByRole('button', { name: 'Back up all projects' }).click();
  const archiveDownload = await download;
  const archivePath = await archiveDownload.path();
  expect(archivePath).not.toBeNull();
  const archive = JSON.parse(await readFile(archivePath!, 'utf8')) as {
    readonly format: string;
    readonly projects: readonly unknown[];
    readonly omissions: readonly { readonly recordId: string | null }[];
  };
  expect(archive.format).toBe('seemoji-workspace');
  expect(archive.projects).toHaveLength(1);
  expect(archive.omissions).toEqual([
    expect.objectContaining({ recordId: 'broken-recovery-record' }),
  ]);

  const rawDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export isolated record' }).click();
  const rawPath = await (await rawDownload).path();
  expect(rawPath).not.toBeNull();
  const quarantined = JSON.parse(await readFile(rawPath!, 'utf8')) as {
    readonly format: string;
    readonly recordId: string | null;
    readonly contentHash: string;
    readonly byteSize: number;
    readonly encodedRecord: unknown;
  };
  expect(quarantined).toMatchObject({
    format: 'seemoji-quarantined-project',
    recordId: 'broken-recovery-record',
    contentHash: expect.stringMatching(/^fnv1a32:[0-9a-f]{8}$/u),
    byteSize: expect.any(Number),
    encodedRecord: { id: 'broken-recovery-record', schemaVersion: 2 },
  });

  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Permanently purge' }).click();
  await expect(page.locator('.notice')).toContainText('Permanently purged isolated record');
  await expect(page.getByText('Recovery attention needed')).toHaveCount(0);
  await page.reload();
  await expect(page.getByText('Recovery attention needed')).toHaveCount(0);

  await page.getByLabel('Restore workspace backup').setInputFiles({
    name: 'workspace.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(archive)),
  });
  await expect(page.locator('.notice')).toContainText('Imported 1 projects with new identities');
  await expect(page.getByLabel('Open project').locator('option')).toHaveCount(3);
  await page.reload();
  await expect(page.getByLabel('Project name')).toHaveValue('Archive source');
  await expect(page.getByLabel('Open project').locator('option')).toHaveCount(3);
});

test('coordinates two tabs and preserves simultaneous edits as a conflict copy', async ({ page, context }) => {
  const second = await context.newPage();
  await mockArtwork(second);
  await second.goto('/');
  await expect(second.getByRole('button', { name: 'Copy PNG' })).toBeEnabled();

  await page.getByLabel('Project name').fill('Broadcast project');
  await runProjectAction(page, 'Save now');
  await expect(second.getByLabel('Project name')).toHaveValue('Broadcast project');

  await Promise.all([
    page.getByLabel('Project name').fill('Alpha concurrent'),
    second.getByLabel('Project name').fill('Beta concurrent'),
  ]);
  await Promise.all([openProjectMenu(page), openProjectMenu(second)]);
  await Promise.all([
    page.getByRole('button', { name: 'Save now' }).click(),
    second.getByRole('button', { name: 'Save now' }).click(),
  ]);

  await expect.poll(async () => {
    const names = await page.getByLabel('Open project').locator('option').allTextContents();
    return names.filter((name) => name !== 'Open…').length;
  }).toBe(2);
  const names = (await page.getByLabel('Open project').locator('option').allTextContents())
    .filter((name) => name !== 'Open…');
  expect(names.some((name) => name.endsWith(' (conflict copy)'))).toBe(true);
  expect(names.map((name) => name.replace(/ \(conflict copy\)$/u, '')).sort()).toEqual([
    'Alpha concurrent',
    'Beta concurrent',
  ]);

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Resolve concurrent edits' })).toBeVisible();
  await expect(page.getByText('Original', { exact: true })).toBeVisible();
  await expect(page.getByText('Conflict edit', { exact: true })).toBeVisible();
  await expect(second.getByRole('heading', { name: 'Resolve concurrent edits' })).toBeVisible();

  await page.getByRole('button', { name: 'Keep both' }).click();
  await expect(page.getByRole('heading', { name: 'Resolve concurrent edits' })).toHaveCount(0);
  const resolvedNames = (await page.getByLabel('Open project').locator('option').allTextContents())
    .filter((name) => name !== 'Open…');
  expect(resolvedNames).not.toContainEqual(expect.stringContaining('(conflict copy)'));
  expect(resolvedNames).toHaveLength(2);
  await second.close();
});

test('cancels an in-progress canvas gesture when another tab switches projects', async ({
  page,
  context,
}) => {
  await page.getByLabel('Project name').fill('Gesture source');
  await runProjectAction(page, 'Save now');
  await page.getByRole('button', { name: 'New' }).click();
  await page.getByLabel('Project name').fill('Gesture destination');
  await runProjectAction(page, 'Save now');
  await page.getByLabel('Open project').selectOption({ label: 'Gesture source' });
  await expect(page.getByLabel('Project name')).toHaveValue('Gesture source');

  const second = await context.newPage();
  await mockArtwork(second);
  await second.goto('/');
  await expect(second.getByLabel('Project name')).toHaveValue('Gesture source');

  await page.getByRole('button', { name: 'Eraser' }).click();
  const stage = page.getByLabel(/Interactive emoji canvas/);
  const bounds = await stage.boundingBox();
  expect(bounds).not.toBeNull();
  await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2);
  await page.mouse.down();

  await second.getByLabel('Open project').selectOption({ label: 'Gesture destination' });
  await expect(page.getByLabel('Project name')).toHaveValue('Gesture destination');
  await page.mouse.up();

  const pendingDownload = page.waitForEvent('download');
  await runProjectAction(page, 'Export editable project');
  const exportPath = await (await pendingDownload).path();
  expect(exportPath).not.toBeNull();
  const exported = JSON.parse(await readFile(exportPath!, 'utf8')) as {
    readonly name: string;
    readonly design: { readonly layers: readonly { readonly mask: readonly unknown[] }[] };
  };
  expect(exported.name).toBe('Gesture destination');
  expect(exported.design.layers[0]?.mask).toEqual([]);
  await second.close();
});

test('does not flood-fill pixels from a stale preview after a remote project switch', async ({
  page,
  context,
}) => {
  await page.getByLabel('Project name').fill('Fill source');
  await runProjectAction(page, 'Save now');
  await page.getByRole('button', { name: 'New' }).click();
  await page.getByLabel('Project name').fill('Fill destination');
  await page.getByRole('button', { name: 'Use 😄' }).click();
  await expect(page.getByLabel(/Preview of 😄/)).toBeVisible();
  await runProjectAction(page, 'Save now');
  await page.getByLabel('Open project').selectOption({ label: 'Fill source' });
  await expect(page.getByLabel('Project name')).toHaveValue('Fill source');
  await page.reload();
  await expect(page.getByLabel(/Preview of 😀/)).toBeVisible();

  let reportRenderStarted!: () => void;
  let releaseRender!: () => void;
  const renderStarted = new Promise<void>((resolve) => { reportRenderStarted = resolve; });
  const renderGate = new Promise<void>((resolve) => { releaseRender = resolve; });
  await page.route(SMILE_ASSET_URL, async (route) => {
    reportRenderStarted();
    await renderGate;
    await route.fulfill({
      status: 200,
      contentType: 'image/svg+xml',
      headers: { 'access-control-allow-origin': '*' },
      body: FIXTURE_SVG,
    });
  });

  const second = await context.newPage();
  await mockArtwork(second);
  await second.goto('/');
  await expect(second.getByLabel('Project name')).toHaveValue('Fill source');
  await second.getByLabel('Open project').selectOption({ label: 'Fill destination' });
  await renderStarted;
  await expect(page.getByLabel('Project name')).toHaveValue('Fill destination');

  await page.getByRole('button', { name: 'Fill', exact: true }).click();
  await page.getByLabel(/Interactive emoji canvas/).click();
  await expect(page.locator('.notice')).toContainText('finish rendering before filling');

  releaseRender();
  await expect(page.getByRole('button', { name: 'Copy PNG' })).toBeEnabled();
  const pendingDownload = page.waitForEvent('download');
  await runProjectAction(page, 'Export editable project');
  const exportPath = await (await pendingDownload).path();
  expect(exportPath).not.toBeNull();
  const exported = JSON.parse(await readFile(exportPath!, 'utf8')) as {
    readonly name: string;
    readonly design: { readonly layers: readonly unknown[] };
  };
  expect(exported.name).toBe('Fill destination');
  expect(exported.design.layers).toHaveLength(1);
  await second.close();
});

test('coordinates tabs through storage invalidation when BroadcastChannel is unavailable', async ({
  page,
  context,
}) => {
  await context.addInitScript(() => {
    Object.defineProperty(globalThis, 'BroadcastChannel', {
      configurable: true,
      value: undefined,
    });
  });
  await page.reload();
  await expect(page.getByRole('button', { name: 'Copy PNG' })).toBeEnabled();

  const second = await context.newPage();
  await mockArtwork(second);
  await second.goto('/');
  await expect(second.getByRole('button', { name: 'Copy PNG' })).toBeEnabled();
  expect(await page.evaluate(() => typeof BroadcastChannel)).toBe('undefined');
  expect(await second.evaluate(() => typeof BroadcastChannel)).toBe('undefined');

  await page.getByLabel('Project name').fill('Storage fallback project');
  await runProjectAction(page, 'Save now');
  await expect(second.getByLabel('Project name')).toHaveValue('Storage fallback project');
  await second.close();
});

test('prioritizes the preview and keeps every editor panel one tap away on a narrow screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const layout = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
    previewTop: document.querySelector('.preview-region')?.getBoundingClientRect().top,
    pickerTop: document.querySelector('.picker-region')?.getBoundingClientRect().top,
  }));
  expect(layout.scrollWidth).toBe(layout.viewportWidth);
  expect(layout.previewTop).toBeLessThan(layout.pickerTop ?? 0);

  const tabs = page.getByRole('radiogroup', { name: 'Editing panels' });
  await expect(tabs).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Emoji' })).toBeChecked();
  await tabs.getByText('Layers', { exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Layers' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Pick an emoji' })).toBeHidden();
  await tabs.getByText('Adjust', { exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Adjust' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Layers' })).toBeHidden();
  const panelGap = await page.evaluate(() => {
    const tabsRect = document.querySelector('.editor-panel-tabs')!.getBoundingClientRect();
    const controlsRect = document.querySelector('.controls-region')!.getBoundingClientRect();
    return Math.round(controlsRect.top - tabsRect.bottom);
  });
  expect(panelGap).toBeLessThanOrEqual(40);
});
