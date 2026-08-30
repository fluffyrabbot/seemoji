import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const readJson = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));

test('commits complete, internally consistent, immutable catalog snapshots', async () => {
  const index = await readJson('../public/packs/index.json');
  const twemoji = await readJson('../public/packs/twemoji/15.1.0/manifest.json');
  const noto = await readJson('../public/packs/noto/2.042.0/manifest.json');
  const fluent = await readJson('../public/packs/fluent/1.0.0/color/manifest.json');
  const fluentColor = await readJson('../public/packs/fluent/1.1.0/color/manifest.json');
  const fluentFlat = await readJson('../public/packs/fluent/1.1.0/flat/manifest.json');
  const fluentHighContrast = await readJson(
    '../public/packs/fluent/1.1.0/high-contrast/manifest.json',
  );
  const openmoji = await readJson('../public/packs/openmoji/17.0.0/color/manifest.json');
  const fxemoji = await readJson('../public/packs/fxemoji/1.7.9/manifest.json');
  const emojitwo = await readJson('../public/packs/emojitwo/2.2.7/manifest.json');
  const blobmoji = await readJson('../public/packs/blobmoji/1.0.0/manifest.json');
  const serenity = await readJson('../public/packs/serenity/1.0.0/manifest.json');
  assert.equal(index.version, 1);
  assert.deepEqual(index.packs.map(({ id }) => id), [
    'twemoji', 'noto', 'fluent', 'openmoji', 'fxemoji', 'emojitwo', 'blobmoji', 'serenity',
  ]);
  assert.deepEqual(index.packs[0].versions, [
    { version: '15.1.0', styles: [], defaultStyle: null },
  ]);
  assert.deepEqual(index.packs[2].versions, [
    { version: '1.0.0', styles: ['color'], defaultStyle: 'color' },
    {
      version: '1.1.0',
      styles: ['color', 'flat', 'high-contrast'],
      defaultStyle: 'color',
    },
  ]);
  assert.equal(index.packs[2].defaultVersion, '1.1.0');
  assert.deepEqual(index.packs[3].versions, [
    { version: '17.0.0', styles: ['color'], defaultStyle: 'color' },
  ]);
  assert.match(twemoji.assetRoot, /seemoji-packs@v1\.0\.0\/packs\/twemoji\/15\.1\.0\/$/);
  assert.match(noto.assetRoot, /seemoji-packs@v1\.1\.0\/packs\/noto\/2\.042\.0\/$/);
  assert.match(fluent.assetRoot, /seemoji-packs@v1\.1\.0\/packs\/fluent\/1\.0\.0\/color\/$/);
  for (const manifest of [fluentColor, fluentFlat, fluentHighContrast]) {
    assert.match(manifest.assetRoot, /seemoji-packs@v1\.4\.0\/packs\/fluent\/1\.1\.0\//);
  }
  assert.match(openmoji.assetRoot, /seemoji-packs@v1\.2\.0\/packs\/openmoji\/17\.0\.0\/color\/$/);
  for (const manifest of [fxemoji, emojitwo, blobmoji, serenity]) {
    assert.match(manifest.assetRoot, /seemoji-packs@v1\.3\.0\/packs\//);
  }
  assert.equal(fluent.style, 'color');
  assert.equal(openmoji.style, 'color');
  assert.equal(openmoji.license.spdx, 'CC-BY-SA-4.0');
  assert.equal(openmoji.license.shareAlike, true);
  assert.ok(fluent.maxAssetBytes >= 560_761);
  assert.equal(fluentColor.glyphs.length, 3_145);
  assert.equal(fluentFlat.glyphs.length, 3_145);
  assert.equal(fluentHighContrast.glyphs.length, 1_595);
  assert.ok(fluentFlat.glyphs.includes('1f44d-1f3fb'));
  assert.ok(!fluentHighContrast.glyphs.includes('1f44d-1f3fb'));
  assert.equal(serenity.format, 'png');
  assert.equal(serenity.license.spdx, 'BSD-2-Clause');
  const minimums = new Map([
    ['twemoji', 3_000], ['noto', 3_000], ['fluent', 3_000], ['openmoji', 3_000],
    ['fxemoji', 1_000], ['emojitwo', 1_800], ['blobmoji', 2_500], ['serenity', 2_000],
  ]);
  for (const manifest of [
    twemoji, noto, fluent, fluentColor, fluentFlat, openmoji,
    fxemoji, emojitwo, blobmoji, serenity,
  ]) {
    assert.ok(manifest.glyphs.length > minimums.get(manifest.id),
      `${manifest.id} inventory is incomplete`);
    assert.equal(new Set(manifest.glyphs).size, manifest.glyphs.length);
    for (const required of ['1f600', '1f604', '1f44d', '2764']) {
      assert.ok(manifest.glyphs.includes(required), `${manifest.id} missing ${required}`);
    }
    assert.ok(!manifest.glyphs.includes('41'));
  }
  assert.equal(new Set(fluentHighContrast.glyphs).size, fluentHighContrast.glyphs.length);
  for (const required of ['1f600', '1f604', '1f44d', '2764']) {
    assert.ok(fluentHighContrast.glyphs.includes(required));
  }
  assert.ok(!openmoji.glyphs.some((glyph) => {
    const first = Number.parseInt(glyph.split('-')[0], 16);
    return first >= 0xe000 && first <= 0xf8ff;
  }), 'OpenMoji includes a private-use glyph');
});
