import { expect, test, type Page } from '@playwright/test';

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
  await page.getByLabel('Rotate').fill('137');
  await page.getByLabel('Scale X').fill('3');
  await page.getByLabel('Scale Y').fill('3');
  await page.getByLabel('Skew X').fill('60');
  await page.getByLabel('Skew Y').fill('-60');
  await page.getByLabel('Blur').fill('0.08');
  await page.getByLabel('Outline', { exact: true }).check();
  await page.getByLabel('Outline width').fill('0.08');

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

test('rejects a grapheme without artwork before changing the design', async ({ page }) => {
  await page.getByLabel('Paste another emoji').fill('A');
  await page.getByRole('button', { name: 'Use', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('No Twemoji');
  await expect(page.getByLabel('Preview of 😀')).toBeVisible();
});

test('persists, reapplies, and removes a favorite recipe', async ({ page }) => {
  await page.getByLabel('Rotate').fill('22');
  await page.getByRole('button', { name: '☆ Save this tweak' }).click();
  await page.getByLabel('Favorite name').fill('tilty');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('button', { name: 'tilty', exact: true })).toBeVisible();

  await page.reload();
  await expect(page.getByRole('button', { name: 'Copy PNG' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'tilty', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Reset edits' }).click();
  await expect(page.getByLabel('Rotate')).toHaveValue('0');
  await page.getByRole('button', { name: 'tilty', exact: true }).click();
  await expect(page.getByLabel('Rotate')).toHaveValue('22');

  await page.getByRole('button', { name: 'Remove “tilty”' }).click();
  await expect(page.getByRole('button', { name: 'tilty', exact: true })).toHaveCount(0);
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
