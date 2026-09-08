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
  if (!await menu.isVisible()) await page.getByRole('button', { name: 'Projects', exact: true }).click();
  if (await menu.getAttribute('open') === null) {
    await menu.locator('summary').click();
  }
};

const runProjectAction = async (page: Page, name: string) => {
  await openProjectMenu(page);
  await page.getByRole('button', { name }).click();
};

const emojiSearch = (page: Page) => page.getByRole('searchbox', { name: 'Search emoji by name or paste an emoji' });
const emojiChoice = (page: Page, emoji: string) => page.locator('.emoji-grid button').filter({
  has: page.locator(`img`),
}).and(page.getByRole('button', { name: new RegExp(`${emoji}$`, 'u') }));

const findEmoji = async (page: Page, emoji: string) => {
  await page.getByRole('button', { name: 'Change emoji', exact: true }).click();
  await emojiSearch(page).fill(emoji);
  await expect(emojiChoice(page, emoji)).toBeEnabled();
};

const pickEmoji = async (page: Page, emoji: string) => {
  await findEmoji(page, emoji);
  await emojiChoice(page, emoji).click();
};

const openDetails = async (page: Page, selector: string) => {
  const details = page.locator(selector);
  if (await details.getAttribute('open') === null) await details.locator(':scope > summary').click();
};
const moreControls = (page: Page) => openDetails(page, '.more-controls');
const artworkPacks = (page: Page) => openDetails(page, '.picker-pack-details');
const chooseTool = async (page: Page, tool: string) => {
  const tools = page.getByLabel('Canvas tools', { exact: true });
  if (!await tools.isVisible()) await page.getByRole('button', { name: 'Draw & erase', exact: true }).click();
  await tools.getByRole('button', { name: tool, exact: true }).click();
};

const exportProject = async (page: Page) => {
  const pending = page.waitForEvent('download');
  await runProjectAction(page, 'Export editable project');
  const path = await (await pending).path();
  if (!path) throw new Error('editable project download has no local path');
  return JSON.parse(await readFile(path, 'utf8')) as {
    readonly name: string;
    readonly design: { readonly version: number; readonly groups: readonly {
      readonly id: string; readonly name: string; readonly layerIds: readonly string[];
    }[]; readonly layers: readonly {
      readonly id: string;
      readonly kind: string;
      readonly name: string;
      readonly text?: string;
      readonly source?: { readonly grapheme: string };
      readonly appearance?: {
        readonly hue: number; readonly saturation: number; readonly brightness: number;
        readonly blur: number; readonly outline: { readonly width: number; readonly color: string } | null;
      };
      readonly transform: {
        readonly x: number; readonly y: number; readonly rotate: number;
        readonly scaleX: number; readonly scaleY: number; readonly skewX: number; readonly skewY: number;
        readonly flipH: boolean; readonly flipV: boolean;
      };
    }[] };
  };
};

const mockClipboard = async (page: Page) => {
  await page.evaluate(() => {
    class TestClipboardItem {
      static supports(type: string) { return type === 'image/png'; }
      constructor(_items: Record<string, Blob>) {}
    }
    Object.defineProperty(window, 'ClipboardItem', { configurable: true, value: TestClipboardItem });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true, value: { write: async () => undefined },
    });
  });
};

test.beforeEach(async ({ page }) => {
  await mockArtwork(page);
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Copy PNG' })).toBeEnabled({ timeout: 15_000 });
});

test('keeps the A/A export-bar assignment stable across page views', async ({ page }) => {
  const exportBar = page.locator('.export-bar');
  await expect(exportBar).toHaveAttribute('data-experiment-variant', /^control-[ab]$/);
  const firstVariant = await exportBar.getAttribute('data-experiment-variant');
  const storedVariant = await page.evaluate(() => {
    const encoded = localStorage.getItem('seemoji:experiments:v1');
    if (!encoded) return null;
    const state = JSON.parse(encoded) as {
      readonly assignments?: readonly {
        readonly experimentKey?: string;
        readonly variant?: string;
      }[];
    };
    return state.assignments?.find(({ experimentKey }) =>
      experimentKey === 'export-bar-aa')?.variant ?? null;
  });
  expect(storedVariant).toBe(firstVariant);

  await page.reload();
  await expect(page.getByRole('button', { name: 'Copy PNG' })).toBeEnabled({ timeout: 15_000 });
  await expect(exportBar).toHaveAttribute('data-experiment-variant', firstVariant!);

  for (const forcedVariant of ['control-a', 'control-b'] as const) {
    await page.evaluate((variant) => {
      const key = 'seemoji:experiments:v1';
      const encoded = localStorage.getItem(key);
      if (!encoded) throw new Error('experiment state is missing');
      const state = JSON.parse(encoded) as {
        readonly version: number;
        readonly installationId: string;
        readonly assignments: readonly {
          readonly experimentKey: string;
          readonly experimentVersion: number;
          readonly variant: string;
        }[];
      };
      localStorage.setItem(key, JSON.stringify({
        ...state,
        assignments: [{
          experimentKey: 'export-bar-aa',
          experimentVersion: 1,
          variant,
        }],
      }));
    }, forcedVariant);
    await page.reload();
    await expect(page.getByRole('button', { name: 'Copy PNG' })).toBeEnabled({ timeout: 15_000 });
    await expect(exportBar).toHaveAttribute('data-experiment-variant', forcedVariant);
  }
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

  await pickEmoji(page, '😄');
  await validationStarted;
  await page.getByRole('button', { name: 'New' }).click();
  await expect(page.getByLabel('Open project').locator('option')).toHaveCount(3);
  await expect(page.getByLabel(/Preview of 😀/)).toBeVisible();

  releaseValidation();
  await expect(emojiChoice(page, '😄')).toBeEnabled();
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
  await findEmoji(second, '😁');
  await openProjectMenu(second);

  await pickEmoji(page, '😄');
  await validationStarted;
  await chooseTool(page, 'Eraser');
  const stage = page.getByLabel(/Interactive emoji canvas/);
  const bounds = await stage.boundingBox();
  expect(bounds).not.toBeNull();
  await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2);
  await page.mouse.down();

  // Firefox shares pointer input across pages. Synthetic activation models an
  // independent remote actor without completing the first tab's held gesture.
  await emojiChoice(second, '😁').dispatchEvent('click');
  await expect(second.getByLabel(/Preview of 😁/)).toBeVisible();
  await second.getByRole('button', { name: 'Save now' }).dispatchEvent('click');
  await expect(page.getByLabel(/Preview of 😁/)).toBeVisible();
  await page.mouse.up();

  releaseValidation();
  await expect(emojiChoice(page, '😄')).toBeEnabled();
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

test('Rotate 180° turns the selected object without changing appearance or mirror settings', async ({ page }) => {
  await moreControls(page);
  const rotation = page.getByRole('spinbutton', { name: 'Rotate', exact: true });
  const saturation = page.getByRole('spinbutton', { name: 'Saturation', exact: true });
  const flip = page.getByRole('button', { name: 'Rotate 180°', exact: true });
  await expect(page.getByRole('button', { name: 'Vivid', exact: true })).toHaveCount(0);
  await saturation.fill('1.25');
  await page.getByText('Advanced transforms').click();
  await page.getByLabel('Mirror vertically', { exact: true }).check();
  await rotation.fill('37');
  await flip.click();
  await expect(rotation).toHaveValue('-143');
  await expect(saturation).toHaveValue('1.25');
  await expect(page.getByLabel('Mirror vertically', { exact: true })).toBeChecked();
  await expect(page.getByRole('button', { name: 'Mirror', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: 'Undo', exact: false }).click();
  await expect(rotation).toHaveValue('37');
  await page.getByRole('button', { name: 'Redo', exact: false }).click();
  await expect(rotation).toHaveValue('-143');
  await flip.click();
  await expect(rotation).toHaveValue('37');

  for (const [initial, opposite] of [[0, 180], [180, 0], [-180, 0], [-37, 143]]) {
    await rotation.fill(String(initial));
    await flip.click();
    await expect(rotation).toHaveValue(String(opposite));
  }
  await expect(page.getByRole('button', { name: 'Copy PNG' })).toBeEnabled();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await flip.click();
  await expect(rotation).toHaveValue('-37');
});

test('maximum transforms and effects clip consistently at the explicit export boundary', async ({ page }) => {
  await moreControls(page);
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
  await moreControls(page);
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
  await chooseTool(page, 'Brush');
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

  await chooseTool(page, 'Eraser');
  await page.getByLabel('Brush size').fill('0.08');
  await canvas.scrollIntoViewIfNeeded();
  const eraseBounds = (await canvas.boundingBox())!;
  await page.mouse.move(eraseBounds.x + eraseBounds.width * 0.35, eraseBounds.y + eraseBounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(eraseBounds.x + eraseBounds.width * 0.65, eraseBounds.y + eraseBounds.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect(paintLayer).toContainText('1 stroke');
  await expect(page.getByRole('button', { name: 'Copy PNG' })).toBeEnabled();
  expect((await previewPixel(page, 256, 256))[1]).toBeGreaterThan(150);

  const png = await downloadedPng(page);
  expect(png).toMatchObject({ width: 128, height: 128 });
  expect(png.center[1]).toBeGreaterThan(150);

  await chooseTool(page, 'Restore');
  await canvas.scrollIntoViewIfNeeded();
  const restoreBounds = (await canvas.boundingBox())!;
  await page.mouse.move(restoreBounds.x + restoreBounds.width * 0.48, restoreBounds.y + restoreBounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(restoreBounds.x + restoreBounds.width * 0.52, restoreBounds.y + restoreBounds.height / 2, { steps: 4 });
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
  await moreControls(page);
  const viewport = page.getByLabel(/Interactive emoji canvas/);
  await page.getByRole('spinbutton', { name: 'Position X', exact: true }).fill('10');
  await page.getByRole('spinbutton', { name: 'Rotate', exact: true }).fill('90');
  await page.getByRole('spinbutton', { name: 'Size', exact: true }).fill('0.8');
  await chooseTool(page, 'Eraser');
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

  await chooseTool(page, 'Restore');
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
  await moreControls(page);
  await page.getByRole('spinbutton', { name: 'Position X', exact: true }).fill('10');
  await page.getByRole('spinbutton', { name: 'Position Y', exact: true }).fill('-5');
  await page.getByRole('spinbutton', { name: 'Rotate', exact: true }).fill('35');
  await page.getByRole('spinbutton', { name: 'Size', exact: true }).fill('0.9');
  await page.getByRole('spinbutton', { name: 'Blur', exact: true }).fill('4');
  await page.getByLabel('Outline', { exact: true }).check();
  await page.getByRole('spinbutton', { name: 'Outline width', exact: true }).fill('4');

  const viewport = page.getByLabel(/Interactive emoji canvas/);
  await chooseTool(page, 'Eraser');
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
  await chooseTool(page, 'Eraser');
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

  await chooseTool(page, 'Select');
  await viewport.focus();
  await page.keyboard.press('Shift+ArrowRight');
  await expect(page.getByRole('button', { name: 'Copy PNG' })).toBeEnabled();
  expect((await previewPixel(page, 0.702703 * 512, 0.331035 * 512))[3]).toBeLessThan(10);

  await chooseTool(page, 'Restore');
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

  await chooseTool(page, 'Select');
  await viewport.focus();
  await page.keyboard.press('Shift+ArrowDown');
  await expect(page.getByRole('button', { name: 'Copy PNG' })).toBeEnabled();
  expect((await previewPixel(page, 0.702703 * 512, 0.381035 * 512))[3]).toBeGreaterThan(200);
  expect((await previewPixel(page, 0.734032 * 512, 0.343697 * 512))[3]).toBeLessThan(10);
});

test('renames, duplicates, fades, and transforms a complete paint layer', async ({ page }) => {
  await chooseTool(page, 'Brush');
  const viewport = page.getByLabel(/Interactive emoji canvas/);
  const bounds = await viewport.boundingBox();
  expect(bounds).not.toBeNull();
  const y = bounds!.y + bounds!.height / 2;
  await page.mouse.move(bounds!.x + bounds!.width * 0.35, y);
  await page.mouse.down();
  await page.mouse.move(bounds!.x + bounds!.width * 0.65, y, { steps: 8 });
  await page.mouse.up();

  await moreControls(page);
  await page.getByLabel('Name', { exact: true }).fill('Ink');
  await page.getByLabel('Name', { exact: true }).press('Enter');
  await page.getByRole('button', { name: 'Duplicate “Ink”' }).click();
  await expect(page.locator('.layer-select').filter({ hasText: 'Ink copy' })).toBeVisible();
  await page.getByRole('button', { name: 'Hide “Ink”' }).click();

  await moreControls(page);
  const opacity = page.getByRole('slider', { name: 'Opacity slider', exact: true });
  await opacity.fill('0');
  await expect(page.getByRole('button', { name: 'Copy PNG' })).toBeEnabled();
  expect((await previewPixel(page, 256, 256))[1]).toBeGreaterThan(150);
  await opacity.fill('1');
  await expect(page.getByRole('button', { name: 'Copy PNG' })).toBeEnabled();
  expect((await previewPixel(page, 256, 256))[1]).toBe(79);

  await chooseTool(page, 'Select');
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
  await page.locator('.canvas-quick-actions').getByRole('button', { name: 'Add text', exact: true }).click();
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
  await chooseTool(page, 'Fill');
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
  await chooseTool(page, 'Pan');
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

test('rejects unrecognized search text without requesting non-emoji artwork', async ({ page }) => {
  const assetRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/41.svg')) assetRequests.push(request.url());
  });
  await emojiSearch(page).fill('ABCDEFGHIJKLMNOPQRSTUVWXYZ');
  await expect(page.locator('.picker-search button[type="submit"]')).toBeDisabled();
  await expect(page.locator('.picker-status')).toContainText('No emoji match');
  await expect(page.getByLabel('Preview of 😀')).toBeVisible();
  expect(assetRequests).toEqual([]);
});

test('switches among canonical pack artwork with explicit styled identity', async ({ page }) => {
  await artworkPacks(page);
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
  await artworkPacks(page);
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
  const input = page.getByRole('searchbox', { name: 'Search emoji by name or paste an emoji' });
  await style.selectOption('flat');
  await expect(input).toBeDisabled();
  releaseFlatValidation();
  await input.fill('👍🏻');
  await page.locator('.picker-search button[type="submit"]').click();
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
  await artworkPacks(page);
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
  await mockClipboard(page);
  await page.getByRole('button', { name: 'Copy PNG' }).click();
  const notice = page.locator('.notice[role="status"]');
  await expect(notice).toHaveText(/PNG copied to your clipboard/);
  await expect(notice).not.toContainText('Discord');
});

test('persists favorite projects and makes explicit copies', async ({ page }) => {
  await page.getByLabel('Project name').fill('tilty');
  await page.getByRole('spinbutton', { name: 'Rotate', exact: true }).fill('22');
  await runProjectAction(page, '☆ Add favorite');
  await expect(page.getByRole('button', { name: 'tilty', exact: true })).toBeVisible();

  await page.reload();
  await expect(page.getByRole('button', { name: 'Copy PNG' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'tilty', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: 'Rotate', exact: true })).toHaveValue('0');
  await page.getByRole('button', { name: 'tilty', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: 'Rotate', exact: true })).toHaveValue('22');

  await page.getByRole('button', { name: 'Make a copy of “tilty”' }).click();
  await expect(page.getByLabel('Project name')).toHaveValue('tilty copy');
  await expect(page.getByRole('spinbutton', { name: 'Rotate', exact: true })).toHaveValue('22');
  await page.getByRole('button', { name: 'tilty', exact: true }).click();
  await runProjectAction(page, '★ Remove favorite');
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
  await page.keyboard.press('b');
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
  await expect(page.getByLabel('Resolve concurrent edits').getByText('Original', { exact: true })).toBeVisible();
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

  await chooseTool(page, 'Eraser');
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
  await pickEmoji(page, '😄');
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

  await chooseTool(page, 'Fill');
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

for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 568 }]) {
  test(`keeps the canvas and Copy PNG visible while editing at ${viewport.width} × ${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const tabs = page.getByLabel('Editing panels', { exact: true });
    const canvas = page.getByLabel(/Interactive emoji canvas/);
    const copy = page.getByRole('button', { name: 'Copy PNG', exact: true });
    const assertPinnedPreview = async () => {
      await expect(canvas).toBeInViewport({ ratio: 1 });
      await expect(copy).toBeInViewport({ ratio: 1 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(viewport.width);
    };
    await assertPinnedPreview();
    await expect(tabs.getByRole('button', { name: 'Emoji', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await tabs.getByRole('button', { name: 'Objects', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Layers', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Find your emoji' })).toBeHidden();
    await assertPinnedPreview();
    await page.locator('.canvas-quick-actions').getByRole('button', { name: 'Add text', exact: true }).click();
    await expect(tabs.getByRole('button', { name: 'Edit', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.getByLabel('Text', { exact: true }).fill('hello');
    await page.getByRole('spinbutton', { name: 'Rotate', exact: true }).fill('24');
    await assertPinnedPreview();
    await moreControls(page);
    await page.getByRole('spinbutton', { name: 'Position Y', exact: true }).fill('10');
    await assertPinnedPreview();
    const panelGap = await page.evaluate(() => {
      const tabsRect = document.querySelector('.editor-panel-tabs')!.getBoundingClientRect();
      const controlsRect = document.querySelector('.controls-region')!.getBoundingClientRect();
      return Math.round(controlsRect.top - tabsRect.bottom);
    });
    expect(panelGap).toBeLessThanOrEqual(16);
    await page.getByRole('button', { name: 'Change emoji', exact: true }).click();
    await expect(emojiSearch(page)).toBeFocused();
    await assertPinnedPreview();
  });
}

// Primary remix journeys exercise the editor as a cohesive workflow.
test('searches by meaning, applies Squish, and copies the resulting PNG', async ({ page }) => {
  await mockClipboard(page);
  await emojiSearch(page).fill('cool');
  await page.locator('.picker-search button[type="submit"]').click();
  await expect(page.getByLabel('Preview of 😎')).toBeVisible();
  await page.getByRole('button', { name: 'Squish', exact: true }).click();
  const project = await exportProject(page);
  const layer = project.design.layers[0]!;
  expect(layer.source?.grapheme).toBe('😎');
  expect(layer.transform.scaleX / layer.transform.scaleY).toBeCloseTo(1.5);
  await page.getByRole('button', { name: 'Copy PNG', exact: true }).click();
  await expect(page.locator('.notice[role="status"]')).toContainText('PNG copied to your clipboard');
});

test('adds text, rotates only the selected text, and undoes or resets without deleting objects', async ({ page }) => {
  await page.getByRole('spinbutton', { name: 'Rotate', exact: true }).fill('12');
  await page.locator('.canvas-quick-actions').getByRole('button', { name: 'Add text', exact: true }).click();
  await page.getByLabel('Text', { exact: true }).fill('hello');
  await page.getByRole('spinbutton', { name: 'Rotate', exact: true }).fill('35');
  let project = await exportProject(page);
  expect(project.design.layers.find(({ kind }) => kind === 'emoji')?.transform.rotate).toBe(12);
  expect(project.design.layers.find(({ kind }) => kind === 'text')).toMatchObject({ text: 'hello', transform: { rotate: 35 } });
  await page.getByRole('button', { name: /Undo/ }).click();
  await expect(page.getByRole('spinbutton', { name: 'Rotate', exact: true })).toHaveValue('0');
  await page.getByRole('button', { name: /Redo/ }).click();
  await expect(page.getByRole('spinbutton', { name: 'Rotate', exact: true })).toHaveValue('35');
  await page.getByRole('button', { name: 'Reset selected edits', exact: true }).click();
  project = await exportProject(page);
  expect(project.design.layers).toHaveLength(2);
  expect(project.design.layers.find(({ kind }) => kind === 'emoji')?.transform.rotate).toBe(12);
  expect(project.design.layers.find(({ kind }) => kind === 'text')).toMatchObject({ text: 'hello', transform: { rotate: 0 } });
});

test('adds a second emoji and replaces that explicit selection while preserving the original', async ({ page }) => {
  await page.getByRole('button', { name: 'Add emoji', exact: true }).click();
  await pickEmoji(page, '🍕');
  let project = await exportProject(page);
  expect(project.design.layers.map(({ source }) => source?.grapheme)).toEqual(['😀', '🍕']);
  const addedId = project.design.layers[1]!.id;
  await pickEmoji(page, '🐱');
  project = await exportProject(page);
  expect(project.design.layers.map(({ source }) => source?.grapheme)).toEqual(['😀', '🐱']);
  expect(project.design.layers[1]!.id).toBe(addedId);
  await page.locator('.layer-select').filter({ hasText: '😀' }).click();
  await expect(page.getByRole('button', { name: 'Replace selected', exact: true }))
    .toHaveAttribute('aria-pressed', 'true');
  await pickEmoji(page, '👍');
  project = await exportProject(page);
  expect(project.design.layers.map(({ source }) => source?.grapheme)).toEqual(['👍', '🐱']);
});

test('deselects on blank canvas and selects an unselected object with the same gesture that moves it', async ({ page }) => {
  await page.getByRole('spinbutton', { name: 'Size', exact: true }).fill('0.6');
  const before = await exportProject(page);
  const stage = page.getByLabel(/Interactive emoji canvas/);
  await stage.scrollIntoViewIfNeeded();
  const bounds = (await stage.boundingBox())!;
  await stage.click({ position: { x: bounds.width * 0.04, y: bounds.height * 0.04 } });
  await expect(page.locator('.layer-item.selected')).toHaveCount(0);
  await expect(page.locator('.controls-region').getByRole('heading', { name: 'Canvas', exact: true })).toBeVisible();

  // No preparatory click: this first pointerdown both selects and starts moving.
  await page.mouse.move(bounds.x + bounds.width * 0.5, bounds.y + bounds.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * 0.62, bounds.y + bounds.height * 0.57, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator('.layer-item.selected')).toHaveCount(1);
  const after = await exportProject(page);
  expect(after.design.layers).toHaveLength(1);
  expect(after.design.layers[0]!.id).toBe(before.design.layers[0]!.id);
  expect(after.design.layers[0]!.transform.x).toBeGreaterThan(0.08);
  expect(after.design.layers[0]!.transform.y).toBeGreaterThan(0.03);
  await page.getByRole('button', { name: /Undo/ }).click();
  expect((await exportProject(page)).design).toEqual(before.design);
});

test('moves every grouped object on the first drag of an unselected group member', async ({ page }) => {
  await page.getByRole('button', { name: 'Add rectangle', exact: true }).click();
  await moreControls(page);
  await page.getByRole('spinbutton', { name: 'Position X', exact: true }).fill('-12');
  await page.getByRole('button', { name: 'Add ellipse', exact: true }).click();
  await moreControls(page);
  await page.getByRole('spinbutton', { name: 'Position X', exact: true }).fill('12');
  await page.locator('.layer-select').filter({ hasText: 'Rectangle' }).click({ modifiers: ['Shift'] });
  await expect(page.locator('.layer-item.selected')).toHaveCount(2);
  await page.getByRole('button', { name: 'Group', exact: true }).click();
  await expect(page.locator('.notice')).toContainText('Grouped 2 layers');
  const before = await exportProject(page);

  const stage = page.getByLabel(/Interactive emoji canvas/);
  await stage.scrollIntoViewIfNeeded();
  const bounds = (await stage.boundingBox())!;
  await stage.click({ position: { x: bounds.width * 0.04, y: bounds.height * 0.04 } });
  await expect(page.locator('.layer-item.selected')).toHaveCount(0);
  // The left edge belongs only to Rectangle; Ellipse joins through the group.
  await page.mouse.move(bounds.x + bounds.width * 0.3, bounds.y + bounds.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * 0.38, bounds.y + bounds.height * 0.56, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator('.layer-item.selected')).toHaveCount(2);
  const after = await exportProject(page);
  expect(after.design.layers).toHaveLength(3);
  const movement = ['Rectangle', 'Ellipse'].map((name) => {
    const original = before.design.layers.find((layer) => layer.name === name)!;
    const moved = after.design.layers.find((layer) => layer.id === original.id)!;
    return { x: moved.transform.x - original.transform.x, y: moved.transform.y - original.transform.y };
  });
  expect(movement[0]!.x).toBeGreaterThan(0.04);
  expect(movement[0]!.y).toBeGreaterThan(0.02);
  expect(movement[1]!.x).toBeCloseTo(movement[0]!.x, 4);
  expect(movement[1]!.y).toBeCloseTo(movement[0]!.y, 4);
  expect(after.design.layers.find(({ kind }) => kind === 'emoji'))
    .toEqual(before.design.layers.find(({ kind }) => kind === 'emoji'));
  await page.getByRole('button', { name: /Undo/ }).click();
  expect((await exportProject(page)).design).toEqual(before.design);
});

for (const tool of ['Brush', 'Fill'] as const) {
  test(`pinches and pans with two touches in ${tool} without committing artwork`, async ({ page, context, browserName }) => {
    test.skip(browserName !== 'chromium', 'Real simultaneous touch pointers require the Chromium CDP touch input API.');
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    const before = await exportProject(page);
    await chooseTool(page, tool);
    const stage = page.getByLabel(/Interactive emoji canvas/);
    await stage.scrollIntoViewIfNeeded();
    const bounds = (await stage.boundingBox())!;
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 });
    const point = (id: number, x: number, y: number) => ({
      id, x: bounds.x + bounds.width * x, y: bounds.y + bounds.height * y,
      radiusX: 1, radiusY: 1, force: 0.5,
    });
    let touching = false;
    const touch = async (type: 'touchStart' | 'touchMove' | 'touchEnd', touchPoints: ReturnType<typeof point>[]) => {
      await cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
      touching = touchPoints.length > 0;
    };
    try {
      // The first finger may draft a brush stroke, but a fill must wait for release.
      await touch('touchStart', [point(11, 0.4, 0.5)]);
      await expect(page.locator('.layer-item')).toHaveCount(1);
      await touch('touchMove', [point(11, 0.42, 0.5)]);
      if (tool === 'Brush') await expect(page.locator('.draft-overlay')).toBeVisible();
      await touch('touchStart', [point(11, 0.42, 0.5), point(22, 0.65, 0.5)]);
      await expect(page.locator('.draft-overlay')).toHaveCount(0);
      await touch('touchMove', [point(11, 0.25, 0.5), point(22, 0.85, 0.5)]);
      await expect.poll(async () => Number((await page.getByLabel('Canvas zoom').textContent())?.replace('%', '')))
        .toBeGreaterThan(150);
      // CDP touchMove supplies the remaining active contacts; touchEnd releases all.
      await touch('touchMove', [point(11, 0.25, 0.5)]);
      const beforePan = await page.locator('.canvas-world').getAttribute('style');
      await touch('touchMove', [point(11, 0.3, 0.55)]);
      await expect(page.locator('.canvas-world')).not.toHaveAttribute('style', beforePan!);
      await touch('touchEnd', []);
      await expect(page.locator('.layer-item')).toHaveCount(1);
      await expect(page.getByRole('button', { name: /Undo/ })).toBeDisabled();
      await expect(page.getByLabel('Canvas tools', { exact: true }).getByRole('button', { name: tool, exact: true }))
        .toHaveAttribute('aria-pressed', 'true');
      expect((await exportProject(page)).design).toEqual(before.design);

      // Ending navigation must leave the tool usable for the next single touch.
      await page.getByRole('button', { name: 'Fit', exact: true }).click();
      await stage.scrollIntoViewIfNeeded();
      const nextBounds = (await stage.boundingBox())!;
      const nextPoint = { id: 33, x: nextBounds.x + nextBounds.width * 0.5,
        y: nextBounds.y + nextBounds.height * 0.5, radiusX: 1, radiusY: 1, force: 0.5 };
      await touch('touchStart', [nextPoint]);
      await expect(page.locator('.layer-item')).toHaveCount(1);
      await touch('touchEnd', []);
      await expect(page.locator('.layer-item')).toHaveCount(2);
      const afterTap = await exportProject(page);
      expect(afterTap.design.layers[1]!.kind).toBe(tool === 'Brush' ? 'strokes' : 'raster');
      await page.getByRole('button', { name: /Undo/ }).click();
      expect((await exportProject(page)).design).toEqual(before.design);
      expect(pageErrors).toEqual([]);
    } finally {
      if (touching) await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false });
      await cdp.detach();
    }
  });
}

const pngSamples = async (page: Page, points: readonly { x: number; y: number }[]) => {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download PNG' }).click();
  const path = await (await pending).path();
  if (!path) throw new Error('PNG download has no path');
  const base64 = (await readFile(path)).toString('base64');
  return page.evaluate(async ({ base64, points }) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d')!;
    context.drawImage(image, 0, 0);
    return points.map(({ x, y }) => [...context.getImageData(
      Math.floor(x * canvas.width), Math.floor(y * canvas.height), 1, 1,
    ).data]);
  }, { base64, points });
};

test('enlarges emoji without implicit fitting and crops at the canvas edge', async ({ page }) => {
  const initial = await alphaBounds(page);
  await page.getByRole('spinbutton', { name: 'Size', exact: true }).fill('1.5');
  await expect(page.getByRole('button', { name: 'Copy PNG' })).toBeEnabled();
  const enlarged = await alphaBounds(page);
  expect((enlarged.right - enlarged.left) / (initial.right - initial.left)).toBeCloseTo(1.5, 1);
  await page.getByRole('spinbutton', { name: 'Size', exact: true }).fill('2');
  await expect(page.getByRole('button', { name: 'Copy PNG' })).toBeEnabled();
  expect((await previewPixel(page, 2, 256))[3]).toBe(255);
  expect((await previewPixel(page, 510, 256))[3]).toBe(255);
  for (const size of ['48', '128', '256']) {
    await page.getByLabel('Export size').selectOption(size);
    await expect(page.getByRole('button', { name: 'Copy PNG' })).toBeEnabled();
    const samples = await pngSamples(page, [{ x: 0.01, y: 0.5 }, { x: 0.99, y: 0.5 }]);
    expect(samples.map((pixel) => pixel[3])).toEqual([255, 255]);
  }
});

test('mirrored group rotation matches inspector, canvas handles, and exported pixels', async ({ page }) => {
  const transform = { x: 0, y: 0, rotate: 0, scaleX: 1, scaleY: 1,
    skewX: 0, skewY: 0, flipH: false, flipV: false };
  const shape = { kind: 'shape', visible: true, opacity: 1, mask: [], shape: 'rectangle',
    bounds: { x: 0.45, y: 0.35, width: 0.2, height: 0.1 }, stroke: null };
  // Importing a v2 document also exercises migration into the durable group format.
  const design = { version: 2, canvas: { background: 'transparent' }, layers: [
    { id: 'emoji-1', kind: 'emoji', name: 'Emoji', visible: false, opacity: 1, mask: [], transform,
      source: { pack: 'twemoji', packVersion: '15.1.0', codepoint: '1f600', grapheme: '😀' },
      appearance: { hue: 0, saturation: 1, brightness: 1, blur: 0, outline: null } },
    { ...shape, id: 'red', name: 'Red arm', fill: '#ff0000', transform: { ...transform, x: -0.2 } },
    { ...shape, id: 'blue', name: 'Blue arm', fill: '#0000ff', transform: { ...transform, x: 0.2, flipH: true } },
  ] };
  await openProjectMenu(page);
  await page.getByLabel('Import editable project').setInputFiles({ name: 'rotation.json',
    mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(design)) });
  await page.locator('.layer-select').filter({ hasText: 'Red arm' }).click();
  await page.locator('.layer-select').filter({ hasText: 'Blue arm' }).click({ modifiers: ['Shift'] });
  await page.getByRole('button', { name: 'Group', exact: true }).click();
  const baseline = await exportProject(page);
  expect(baseline.design.groups).toHaveLength(1);
  await page.getByRole('spinbutton', { name: 'Rotate', exact: true }).fill('90');
  await page.getByRole('spinbutton', { name: 'Rotate', exact: true }).blur();
  await expect(page.getByRole('button', { name: 'Copy PNG' })).toBeEnabled();
  // Independent quarter-turn geometry about group bounds center (0.5, 0.4):
  // red's center (0.35,0.4) becomes (0.5,0.25), blue's (0.65,0.4) becomes (0.5,0.55).
  const points = [{ x: 0.5, y: 0.25 }, { x: 0.5, y: 0.55 }, { x: 0.35, y: 0.4 }];
  const expected = [[255, 0, 0, 255], [0, 0, 255, 255], [0, 0, 0, 0]];
  for (const [index, point] of points.entries()) {
    expect(await previewPixel(page, point.x * 512, point.y * 512)).toEqual(expected[index]);
  }
  expect(await pngSamples(page, points)).toEqual(expected);
  const inspector = await exportProject(page);
  expect(inspector.design.layers.find(({ id }) => id === 'red')!.transform.rotate).toBe(90);
  expect(inspector.design.layers.find(({ id }) => id === 'blue')!.transform.rotate).toBe(-90);
  await page.getByRole('button', { name: /Undo/ }).click();
  expect((await exportProject(page)).design).toEqual(baseline.design);
  const stage = page.getByLabel(/Interactive emoji canvas/);
  await stage.scrollIntoViewIfNeeded();
  const box = (await stage.boundingBox())!;
  const handle = (await page.locator('.rotate-handle').boundingBox())!;
  const start = { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 };
  const pivot = { x: box.x + box.width * 0.5, y: box.y + box.height * 0.4 };
  // Observe the real input delivered by the browser. Linux WebKit rounds mouse
  // coordinates to CSS pixels; at this handle radius that can exceed half a degree.
  await stage.evaluate((element) => {
    for (const type of ['pointerdown', 'pointermove']) element.addEventListener(type, (event) => {
      const pointer = event as PointerEvent;
      if (!pointer.buttons) return;
      const bounds = element.getBoundingClientRect();
      element.setAttribute(`data-test-${type}`, JSON.stringify({
        x: (pointer.clientX - bounds.left) / bounds.width,
        y: (pointer.clientY - bounds.top) / bounds.height,
      }));
    }, { capture: true });
  });
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(pivot.x - (start.y - pivot.y) * box.width / box.height,
    pivot.y + (start.x - pivot.x) * box.height / box.width, { steps: 8 });
  await page.mouse.up();
  const delivered = await stage.evaluate((element) => ['pointerdown', 'pointermove'].map((type) =>
    JSON.parse(element.getAttribute(`data-test-${type}`)!) as { x: number; y: number }));
  const deliveredAngle = (Math.atan2(delivered[1]!.y - 0.4, delivered[1]!.x - 0.5)
    - Math.atan2(delivered[0]!.y - 0.4, delivered[0]!.x - 0.5)) * 180 / Math.PI;
  expect(Math.abs(deliveredAngle - 90)).toBeLessThan(2);
  await expect(page.getByRole('button', { name: 'Copy PNG' })).toBeEnabled();
  expect(await pngSamples(page, points)).toEqual(expected);
  const dragged = await exportProject(page);
  for (const layer of inspector.design.layers.filter(({ kind }) => kind === 'shape')) {
    const actual = dragged.design.layers.find(({ id }) => id === layer.id)!.transform;
    expect(actual.x).toBeCloseTo(layer.transform.x, 2);
    expect(actual.y).toBeCloseTo(layer.transform.y, 2);
    expect(actual.rotate).toBeCloseTo(layer.transform.flipH ? -deliveredAngle : deliveredAngle, 4);
  }
});

test('saves a reusable style across reload and applies it only to the selected emoji', async ({ page }) => {
  await page.getByRole('button', { name: 'Tilt', exact: true }).click();
  await page.getByRole('button', { name: 'Sticker', exact: true }).click();
  await page.getByRole('button', { name: 'Mirror', exact: true }).click();
  await moreControls(page);
  await page.getByRole('spinbutton', { name: 'Position X', exact: true }).fill('-12');
  await openDetails(page, '.saved-styles-details');
  await page.getByRole('textbox', { name: 'Style name', exact: true }).fill('Party sticker');
  await page.getByRole('button', { name: 'Save style', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Apply Party sticker', exact: true })).toBeVisible();
  const original = (await exportProject(page)).design.layers[0]!;
  await page.reload();
  await expect(page.getByRole('button', { name: 'Copy PNG' })).toBeEnabled();
  await openDetails(page, '.saved-styles-details');
  await expect(page.getByRole('button', { name: 'Apply Party sticker', exact: true })).toBeVisible();
  await findEmoji(page, '😎');
  await page.getByRole('button', { name: 'Add emoji', exact: true }).click();
  await emojiChoice(page, '😎').click();
  await moreControls(page);
  await page.getByRole('spinbutton', { name: 'Position X', exact: true }).fill('18');
  await page.getByRole('spinbutton', { name: 'Position Y', exact: true }).fill('9');
  await page.getByRole('spinbutton', { name: 'Position Y', exact: true }).blur();
  const before = await exportProject(page);
  const target = before.design.layers.find(({ id }) => id !== original.id)!;
  await openDetails(page, '.saved-styles-details');
  await page.getByRole('button', { name: 'Apply Party sticker', exact: true }).click();
  const after = await exportProject(page);
  expect(after.design.layers.find(({ id }) => id === original.id)).toEqual(original);
  expect(after.design.layers.find(({ id }) => id === target.id)).toEqual({
    ...target, transform: { ...original.transform, x: target.transform.x, y: target.transform.y },
    appearance: original.appearance,
  });
  await page.getByRole('button', { name: /Undo/ }).click();
  expect((await exportProject(page)).design).toEqual(before.design);
  await openDetails(page, '.saved-styles-details');
  await page.getByRole('button', { name: 'Delete Party sticker', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Apply Party sticker', exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Copy PNG' })).toBeEnabled();
  await openDetails(page, '.saved-styles-details');
  await expect(page.getByRole('button', { name: 'Apply Party sticker', exact: true })).toHaveCount(0);
});

test('keeps named groups through history, reload, duplication, and project import', async ({ page }) => {
  await page.getByRole('button', { name: 'Add rectangle', exact: true }).click();
  await page.getByRole('button', { name: 'Add ellipse', exact: true }).click();
  await page.locator('.layer-select').filter({ hasText: 'Rectangle' }).click({ modifiers: ['Shift'] });
  await page.getByRole('button', { name: 'Group', exact: true }).click();
  await page.getByRole('textbox', { name: /Rename group/ }).fill('Badge');
  await page.getByRole('textbox', { name: /Rename group/ }).press('Enter');
  const named = await exportProject(page);
  expect(named.design.version).toBe(3);
  expect(named.design.groups).toHaveLength(1);
  expect(named.design.groups[0]!.name).toBe('Badge');
  await page.getByRole('button', { name: /Undo/ }).click();
  expect((await exportProject(page)).design.groups[0]!.name).not.toBe('Badge');
  await page.getByRole('button', { name: /Redo/ }).click();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Copy PNG' })).toBeEnabled();
  await expect(page.getByRole('textbox', { name: 'Rename group “Badge”', exact: true })).toHaveValue('Badge');
  await expect(page.locator('.layer-item.selected')).toHaveCount(2);
  await page.getByLabel(/Interactive emoji canvas/).click({ modifiers: ['Shift'] });
  await expect(page.locator('.layer-item.selected')).toHaveCount(0);
  await page.locator('.layer-select').filter({ hasText: 'Rectangle' }).click();
  await expect(page.locator('.layer-item.selected')).toHaveCount(2);
  await page.getByRole('button', { name: 'Duplicate selection', exact: true }).click();
  const duplicated = await exportProject(page);
  expect(duplicated.design.groups).toHaveLength(2);
  expect(new Set(duplicated.design.groups.flatMap(({ layerIds }) => layerIds)).size).toBe(4);
  await page.getByRole('button', { name: /Undo/ }).click();
  expect((await exportProject(page)).design.groups).toEqual(named.design.groups);
  await openProjectMenu(page);
  await page.getByLabel('Import editable project').setInputFiles({ name: 'grouped.json',
    mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(named)) });
  await expect(page.getByRole('textbox', { name: 'Rename group “Badge”', exact: true })).toBeVisible();
  expect((await exportProject(page)).design.groups).toEqual(named.design.groups);
  await page.getByRole('button', { name: 'Ungroup “Badge”', exact: true }).click();
  expect((await exportProject(page)).design.groups).toEqual([]);
  await page.getByRole('button', { name: /Undo/ }).click();
  expect((await exportProject(page)).design.groups).toEqual(named.design.groups);
});

const createBadgeGroup = async (page: Page) => {
  await page.getByRole('button', { name: 'Add rectangle', exact: true }).click();
  await moreControls(page);
  await page.getByRole('spinbutton', { name: 'Position X', exact: true }).fill('-15');
  await page.getByRole('button', { name: 'Add ellipse', exact: true }).click();
  await moreControls(page);
  await page.getByRole('spinbutton', { name: 'Position X', exact: true }).fill('15');
  await page.locator('.layer-select').filter({ hasText: 'Rectangle' }).click({ modifiers: ['Shift'] });
  await page.getByRole('button', { name: 'Group', exact: true }).click();
  await page.getByRole('textbox', { name: /Rename group/ }).fill('Badge');
  await page.getByRole('textbox', { name: /Rename group/ }).press('Enter');
};

test('edits one group member with undo and preserves group identity through reload', async ({ page }) => {
  await createBadgeGroup(page);
  const before = await exportProject(page);
  await page.getByRole('button', { name: 'Edit group “Badge”', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Done editing group', exact: true })).toBeVisible();
  await page.locator('.layer-select').filter({ hasText: 'Ellipse' }).click();
  await expect(page.locator('.layer-item.selected')).toHaveCount(1);
  await page.getByRole('spinbutton', { name: 'Rotate', exact: true }).fill('37');
  await page.getByRole('spinbutton', { name: 'Rotate', exact: true }).blur();
  const edited = await exportProject(page);
  expect(edited.design.groups).toEqual(before.design.groups);
  expect(edited.design.layers.find(({ name }) => name === 'Ellipse')!.transform.rotate).toBe(37);
  for (const layer of before.design.layers.filter(({ name }) => name !== 'Ellipse')) {
    expect(edited.design.layers.find(({ id }) => id === layer.id)).toEqual(layer);
  }
  await page.getByRole('button', { name: /Undo/ }).click();
  expect((await exportProject(page)).design).toEqual(before.design);
  await expect(page.getByRole('button', { name: 'Done editing group', exact: true })).toBeVisible();
  await expect(page.locator('.layer-item.selected')).toHaveCount(1);
  await page.getByRole('button', { name: /Redo/ }).click();
  expect((await exportProject(page)).design).toEqual(edited.design);
  await page.getByRole('button', { name: 'Move “Ellipse” backward', exact: true }).click();
  const reordered = await exportProject(page);
  expect(reordered.design.groups).toEqual(before.design.groups);
  expect(reordered.design.layers.map(({ name }) => name)).toEqual(['Emoji', 'Ellipse', 'Rectangle']);
  await page.getByRole('button', { name: 'Done editing group', exact: true }).click();
  await expect(page.locator('.layer-item.selected')).toHaveCount(2);
  await page.getByRole('button', { name: 'Edit group “Badge”', exact: true }).click();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Copy PNG' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Done editing group', exact: true })).toHaveCount(0);
  await expect(page.locator('.layer-item.selected')).toHaveCount(2);
  expect((await exportProject(page)).design).toEqual(reordered.design);
});

test('scopes canvas and keyboard selection while editing a group and recovers deleted membership', async ({ page }) => {
  await createBadgeGroup(page);
  const before = await exportProject(page);
  const stage = page.getByLabel(/Interactive emoji canvas/);
  await page.getByRole('button', { name: 'Edit group “Badge”', exact: true }).click();
  const box = (await stage.boundingBox())!;
  await stage.click({ position: { x: box.width * 0.82, y: box.height * 0.5 } });
  await expect(page.locator('.layer-item.selected')).toHaveCount(1);
  await expect(page.locator('.layer-item.selected .layer-select')).toContainText('Ellipse');
  await stage.click({ position: { x: box.width * 0.18, y: box.height * 0.5 }, modifiers: ['Shift'] });
  await expect(page.locator('.layer-item.selected')).toHaveCount(2);
  await stage.click({ position: { x: box.width * 0.82, y: box.height * 0.5 }, modifiers: ['Shift'] });
  await expect(page.locator('.layer-item.selected')).toHaveCount(1);
  await expect(page.locator('.layer-item.selected .layer-select')).toContainText('Rectangle');
  await stage.click({ position: { x: box.width * 0.03, y: box.height * 0.03 } });
  await expect(page.locator('.layer-item.selected')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Done editing group', exact: true })).toBeVisible();
  await stage.focus();
  await page.keyboard.press('ControlOrMeta+a');
  await expect(page.locator('.layer-item.selected')).toHaveCount(2);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Done editing group', exact: true })).toHaveCount(0);
  await expect(page.locator('.layer-item.selected')).toHaveCount(2);
  await page.keyboard.press('Escape');
  await expect(page.locator('.layer-item.selected')).toHaveCount(0);
  await page.getByRole('button', { name: 'Edit group “Badge”', exact: true }).click();
  await page.locator('.layer-select').filter({ hasText: 'Emoji' }).click();
  await expect(page.getByRole('button', { name: 'Done editing group', exact: true })).toHaveCount(0);
  await expect(page.locator('.layer-item.selected')).toHaveCount(1);
  await page.getByRole('button', { name: 'Edit group “Badge”', exact: true }).click();
  await page.locator('.layer-select').filter({ hasText: 'Ellipse' }).click();
  await stage.focus();
  await page.keyboard.press('Delete');
  expect((await exportProject(page)).design.groups).toEqual([]);
  await expect(page.getByRole('button', { name: 'Done editing group', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: /Undo/ }).click();
  expect((await exportProject(page)).design).toEqual(before.design);
  await page.locator('.layer-select').filter({ hasText: 'Ellipse' }).click();
  await expect(page.locator('.layer-item.selected')).toHaveCount(2);
});

interface TestStyleBackup {
  readonly format: string;
  readonly version: number;
  readonly exportedAt: number;
  readonly styles: readonly {
    readonly id: string; readonly name: string;
    readonly transform: Record<string, number | boolean>;
    readonly appearance: Record<string, unknown>;
  }[];
  readonly omissions: readonly { readonly id: string | null; readonly error: string }[];
}
const saveNamedStyle = async (page: Page, name: string) => {
  await openDetails(page, '.saved-styles-details');
  await page.getByRole('textbox', { name: 'Style name', exact: true }).fill(name);
  await page.getByRole('button', { name: 'Save style', exact: true }).click();
  await expect(page.getByRole('button', { name: `Apply ${name}`, exact: true })).toBeVisible();
};
const exportStyles = async (page: Page): Promise<TestStyleBackup> => {
  await openDetails(page, '.saved-styles-details');
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export styles', exact: true }).click();
  const path = await (await pending).path();
  if (!path) throw new Error('Style backup download has no path');
  return JSON.parse(await readFile(path, 'utf8')) as TestStyleBackup;
};
const chooseStyleBackup = async (page: Page, backup: unknown) => {
  await page.getByLabel('Import styles', { exact: true }).setInputFiles({
    name: 'styles.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)),
  });
};

test('backs up and restores styles without an emoji selection and previews duplicate names', async ({ page }) => {
  await page.getByRole('button', { name: 'Tilt', exact: true }).click();
  await page.getByRole('button', { name: 'Sticker', exact: true }).click();
  await saveNamedStyle(page, 'Badge');
  const stage = page.getByLabel(/Interactive emoji canvas/);
  await stage.focus();
  await page.keyboard.press('Escape');
  await expect(page.locator('.layer-item.selected')).toHaveCount(0);
  const original = await exportStyles(page);
  expect(original).toMatchObject({ format: 'seemoji-styles', version: 1, omissions: [] });
  expect(original.styles.map(({ name }) => name)).toEqual(['Badge']);
  await expect(page.getByRole('textbox', { name: 'Style name', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Delete Badge', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Apply Badge', exact: true })).toHaveCount(0);
  await chooseStyleBackup(page, original);
  await expect(page.getByRole('region', { name: 'Import preview', exact: true })).toContainText('Badge');
  await expect(page.getByRole('button', { name: 'Apply Badge', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Confirm import', exact: true }).click();
  const restored = await exportStyles(page);
  expect(restored.styles).toHaveLength(1);
  expect(restored.styles[0]!.id).not.toBe(original.styles[0]!.id);
  expect(restored.styles[0]!.transform).toEqual(original.styles[0]!.transform);
  expect(restored.styles[0]!.appearance).toEqual(original.styles[0]!.appearance);
  await chooseStyleBackup(page, original);
  await expect(page.getByRole('region', { name: 'Import preview', exact: true })).toContainText('Badge (2)');
  await page.getByRole('button', { name: 'Cancel import', exact: true }).click();
  expect((await exportStyles(page)).styles).toHaveLength(1);
  await chooseStyleBackup(page, original);
  await page.getByRole('button', { name: 'Confirm import', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Apply Badge (2)', exact: true })).toBeVisible();
  const mixed = { ...original, styles: [...original.styles,
    { ...original.styles[0]!, id: 'incoming-new-look', name: 'New look' }] };
  await chooseStyleBackup(page, mixed);
  await page.getByRole('combobox', { name: 'Duplicate names', exact: true }).selectOption({ label: 'Skip matching names' });
  await expect(page.getByRole('region', { name: 'Import preview', exact: true })).toContainText('New look');
  await page.getByRole('button', { name: 'Confirm import', exact: true }).click();
  const merged = await exportStyles(page);
  expect(merged.styles.map(({ name }) => name).sort()).toEqual(['Badge', 'Badge (2)', 'New look']);
  expect(new Set(merged.styles.map(({ id }) => id)).size).toBe(3);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Copy PNG' })).toBeEnabled();
  expect((await exportStyles(page)).styles).toEqual(merged.styles);
});

test('invalid style backups clear the previous import preview and never partially import', async ({ page }) => {
  await saveNamedStyle(page, 'Original');
  const backup = await exportStyles(page);
  const incoming = { ...backup, styles: [{ ...backup.styles[0]!, id: 'valid-incoming', name: 'Incoming' }] };
  await chooseStyleBackup(page, incoming);
  await expect(page.getByRole('button', { name: 'Confirm import', exact: true })).toBeEnabled();
  await chooseStyleBackup(page, { ...incoming, styles: [...incoming.styles,
    { ...incoming.styles[0]!, id: 'broken-incoming', name: 'Broken', transform: { ...incoming.styles[0]!.transform, scaleX: 0 } }] });
  await expect(page.getByRole('alert').filter({ hasText: /scaleX|range/i })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirm import', exact: true })).toHaveCount(0);
  expect((await exportStyles(page)).styles).toEqual(backup.styles);
  await page.getByLabel('Import styles', { exact: true }).setInputFiles({
    name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{not-json'),
  });
  await expect(page.getByRole('alert').filter({ hasText: /JSON/i })).toBeVisible();
  expect((await exportStyles(page)).styles).toEqual(backup.styles);
  await chooseStyleBackup(page, incoming);
  await page.getByRole('button', { name: 'Confirm import', exact: true }).click();
  expect((await exportStyles(page)).styles.map(({ name }) => name).sort()).toEqual(['Incoming', 'Original']);
});

test('requires a new style import preview after another tab changes the library', async ({ page, context }) => {
  await saveNamedStyle(page, 'Badge');
  const backup = await exportStyles(page);
  await chooseStyleBackup(page, backup);
  await expect(page.getByRole('button', { name: 'Confirm import', exact: true })).toBeEnabled();
  const second = await context.newPage();
  await mockArtwork(second);
  await second.goto('/');
  await expect(second.getByRole('button', { name: 'Copy PNG' })).toBeEnabled();
  await saveNamedStyle(second, 'From another tab');
  await page.getByRole('button', { name: 'Confirm import', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: /changed|preview/i }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Apply Badge (2)', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Refresh import preview', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Confirm import', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Confirm import', exact: true }).click();
  const restored = await exportStyles(page);
  expect(restored.styles.map(({ name }) => name).sort()).toEqual(['Badge', 'Badge (2)', 'From another tab']);
  await second.close();
});

for (const mobile of [false, true]) test(`keeps the canvas fixed when an outside-object drag exits group editing (${mobile ? 'mobile' : 'desktop'})`, async ({ page }) => {
  await createBadgeGroup(page);
  const before = await exportProject(page);
  await page.locator('.canvas-settings summary').click();
  await page.getByRole('checkbox', { name: 'Snap', exact: true }).uncheck();
  await page.locator('.canvas-settings summary').click();
  if (mobile) {
    await page.setViewportSize({ width: 414, height: 896 });
    await page.getByRole('button', { name: 'Objects', exact: true }).click();
  }
  const stage = page.getByLabel(/Interactive emoji canvas/);
  const documentFrame = () => stage.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return { x: box.x + window.scrollX, y: box.y + window.scrollY, width: box.width, height: box.height };
  });
  const normalFrame = await documentFrame();
  await page.getByRole('button', { name: 'Edit group “Badge”', exact: true }).click();
  expect(await documentFrame()).toEqual(normalFrame);
  await stage.scrollIntoViewIfNeeded();
  const editingBox = (await stage.boundingBox())!;
  // The emoji is outside the group and visible above both shape members.
  const x = Math.round(editingBox.x + editingBox.width * 0.5);
  const y = Math.round(editingBox.y + editingBox.height * 0.2);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await expect(page.getByRole('button', { name: 'Done editing group', exact: true })).toHaveCount(0);
  expect(await stage.boundingBox()).toEqual(editingBox);
  await page.mouse.move(x + 1, y + 1);
  await page.mouse.up();
  const after = await exportProject(page);
  const original = before.design.layers.find(({ name }) => name === 'Emoji')!;
  const moved = after.design.layers.find(({ id }) => id === original.id)!;
  expect(moved.transform.x - original.transform.x).toBeCloseTo(1 / editingBox.width, 3);
  expect(moved.transform.y - original.transform.y).toBeCloseTo(1 / editingBox.height, 3);
  expect(after.design.groups).toEqual(before.design.groups);
  for (const layer of before.design.layers.filter(({ id }) => id !== original.id)) {
    expect(after.design.layers.find(({ id }) => id === layer.id)).toEqual(layer);
  }
});

test('recovers an unreadable style with an invalid identity before retrying import', async ({ page }) => {
  await saveNamedStyle(page, 'Original');
  const backup = await exportStyles(page);
  await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open('seemoji-styles');
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction('styles', 'readwrite');
        transaction.objectStore('styles').add({ id: 123, name: 'Unreadable' });
        transaction.oncomplete = () => resolve();
        transaction.onabort = () => reject(transaction.error);
      });
    } finally { database.close(); }
  });
  await page.getByRole('button', { name: 'Refresh styles', exact: true }).click();
  const recoveredBackup = await exportStyles(page);
  expect(recoveredBackup.styles).toEqual(backup.styles);
  expect(recoveredBackup.omissions).toEqual([{ id: null, error: expect.any(String) }]);
  await chooseStyleBackup(page, backup);
  await expect(page.getByRole('alert').filter({ hasText: /unreadable/i }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirm import', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: /Delete unreadable style/ }).click();
  await expect(page.getByRole('button', { name: /Delete unreadable style/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Refresh import preview', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm import', exact: true }).click();
  const restored = await exportStyles(page);
  expect(restored.omissions).toEqual([]);
  expect(restored.styles.map(({ name }) => name).sort()).toEqual(['Original', 'Original (2)']);
  expect(restored.styles.find(({ name }) => name === 'Original')).toEqual(backup.styles[0]);
});
