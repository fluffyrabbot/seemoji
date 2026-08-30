import { describe, expect, it, vi } from 'vitest';
import { createEmojiAssetRef } from '../../domain/emoji';
import { HttpEmojiPackCatalog } from './httpEmojiPackCatalog';

const LICENSE = {
  spdx: 'CC-BY-4.0',
  attribution: 'Emoji artwork by Twemoji',
  shareAlike: false,
  noticeUrl: 'https://creativecommons.org/licenses/by/4.0/',
};

const INDEX = {
  version: 1,
  packs: [{
    id: 'twemoji',
    name: 'Twemoji',
    versions: [{ version: '15.1.0', styles: [], defaultStyle: null }],
    defaultVersion: '15.1.0',
    license: LICENSE,
    unicodeLevel: '15.1',
  }],
};

const MANIFEST = {
  id: 'twemoji',
  name: 'Twemoji',
  version: '15.1.0',
  style: null,
  format: 'svg',
  license: LICENSE,
  unicodeLevel: '15.1',
  glyphs: ['1f600'],
  assetRoot: 'https://cdn.jsdelivr.net/gh/fluffyrabbot/seemoji-packs@v1.0.0/packs/twemoji/15.1.0/',
  upstream: { repository: 'https://github.com/jdecked/twemoji', ref: 'v15.1.0' },
};

const response = (body: unknown, status = 200): Response => new Response(
  JSON.stringify(body),
  { status, headers: { 'content-type': 'application/json' } },
);

describe('HttpEmojiPackCatalog', () => {
  it('loads and caches the index and manifest independently', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      return url.endsWith('/index.json') ? response(INDEX) : response(MANIFEST);
    });
    const catalog = new HttpEmojiPackCatalog({
      baseUrl: 'https://seemoji.test',
      fetchImpl,
    });
    await expect(catalog.get({ pack: 'twemoji', packVersion: '15.1.0' }))
      .resolves.toMatchObject({ ok: true });
    expect(catalog.summaryFor('twemoji')).toBeNull();
    await expect(catalog.list()).resolves.toMatchObject({ ok: true });
    await catalog.list();
    expect(catalog.summaryFor('twemoji')?.name).toBe('Twemoji');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('uses manifest coverage and its pinned asset root as the only locator', async () => {
    const catalog = new HttpEmojiPackCatalog({
      baseUrl: 'https://seemoji.test',
      fetchImpl: async (input) => String(input).endsWith('/index.json')
        ? response(INDEX)
        : response(MANIFEST),
    });
    await expect(catalog.hasGlyph(
      { pack: 'twemoji', packVersion: '15.1.0' },
      '1f600',
    )).resolves.toBe(true);
    await expect(catalog.hasGlyph(
      { pack: 'twemoji', packVersion: '15.1.0' },
      '41',
    )).resolves.toBe(false);
    const asset = await catalog.assetUrl(createEmojiAssetRef('😀'));
    expect(asset).toEqual({
      ok: true,
      value: new URL(
        'https://cdn.jsdelivr.net/gh/fluffyrabbot/seemoji-packs@v1.0.0/packs/twemoji/15.1.0/svg/1f600.svg',
      ),
    });
  });

  it('falls back from an omitted style to that version\'s frozen default', async () => {
    const styledIndex = {
      ...INDEX,
      packs: [{
        ...INDEX.packs[0],
        versions: [{ version: '15.1.0', styles: ['flat'], defaultStyle: 'flat' }],
      }],
    };
    const requests: string[] = [];
    const catalog = new HttpEmojiPackCatalog({
      baseUrl: 'https://seemoji.test',
      fetchImpl: async (input) => {
        const url = String(input);
        requests.push(url);
        if (url.endsWith('/index.json')) return response(styledIndex);
        if (url.endsWith('/15.1.0/manifest.json')) return response({}, 404);
        return response({ ...MANIFEST, style: 'flat' });
      },
    });
    await catalog.list();
    await expect(catalog.get({ pack: 'twemoji', packVersion: '15.1.0' }))
      .resolves.toMatchObject({ ok: true, value: { style: 'flat' } });
    expect(requests.some((url) => url.endsWith('/15.1.0/flat/manifest.json'))).toBe(true);
  });

  it('fails closed for corrupt JSON, unpinned roots, and internal exceptions', async () => {
    const badCatalog = new HttpEmojiPackCatalog({
      baseUrl: 'https://seemoji.test',
      fetchImpl: async (input) => String(input).endsWith('/index.json')
        ? response({ version: 99, packs: [] })
        : response({ ...MANIFEST, assetRoot: 'https://example.com/@latest/' }),
    });
    await expect(badCatalog.list()).resolves.toMatchObject({ ok: false });
    await expect(badCatalog.assetUrl(createEmojiAssetRef('😀')))
      .resolves.toMatchObject({ ok: false });
    const throwing = new HttpEmojiPackCatalog({
      baseUrl: 'https://seemoji.test',
      fetchImpl: async () => { throw new Error('offline'); },
    });
    await expect(throwing.hasGlyph(
      { pack: 'twemoji', packVersion: '15.1.0' },
      '1f600',
    )).resolves.toBe(false);
  });

  it('retries a manifest after a transient failure', async () => {
    let attempts = 0;
    const catalog = new HttpEmojiPackCatalog({
      baseUrl: 'https://seemoji.test',
      fetchImpl: async () => {
        attempts += 1;
        return attempts === 1 ? response({}, 503) : response(MANIFEST);
      },
    });
    await expect(catalog.get({ pack: 'twemoji', packVersion: '15.1.0' }))
      .resolves.toMatchObject({ ok: false });
    await expect(catalog.get({ pack: 'twemoji', packVersion: '15.1.0' }))
      .resolves.toMatchObject({ ok: true });
    expect(attempts).toBe(2);
  });
});
