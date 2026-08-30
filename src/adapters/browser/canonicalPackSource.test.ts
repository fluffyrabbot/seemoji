import { describe, expect, it, vi } from 'vitest';
import { createEmojiAssetRef } from '../../domain/emoji';
import type { PackManifest } from '../../domain/pack';
import type { EmojiPackCatalog } from '../../ports/emojiPackCatalog';
import { CanonicalPackSource, EmojiAssetError } from './canonicalPackSource';

const MANIFEST: PackManifest = {
  id: 'twemoji',
  name: 'Twemoji',
  version: '15.1.0',
  style: null,
  format: 'svg',
  license: {
    spdx: 'CC-BY-4.0',
    attribution: 'Emoji artwork by Twemoji',
    shareAlike: false,
    noticeUrl: 'https://creativecommons.org/licenses/by/4.0/',
  },
  unicodeLevel: '15.1',
  glyphs: ['1f600'],
  assetRoot: 'https://cdn.jsdelivr.net/gh/fluffyrabbot/seemoji-packs@v1.0.0/packs/twemoji/15.1.0/',
  maxAssetBytes: 16,
  upstream: { repository: 'https://github.com/jdecked/twemoji', ref: 'v15.1.0' },
};

const ref = createEmojiAssetRef('😀');
const url = new URL(`${MANIFEST.assetRoot}svg/1f600.svg`);
const decodedImage = {} as CanvasImageSource;

const catalog = (manifest: PackManifest = MANIFEST): EmojiPackCatalog => ({
  list: async () => ({ ok: true, value: [] }),
  get: async () => ({ ok: true, value: manifest }),
  hasGlyph: async () => true,
  assetUrl: async () => ({ ok: true, value: url }),
  summaryFor: () => null,
});

const response = (body: BodyInit, contentType: string, status = 200): Response =>
  new Response(body, { status, headers: { 'content-type': contentType } });

describe('CanonicalPackSource', () => {
  it('loads and caches SVG artwork through the catalog locator', async () => {
    const fetchImpl = vi.fn(async () => response('<svg/>', 'image/svg+xml; charset=utf-8'));
    const decodeImage = vi.fn(async (_blob: Blob) => decodedImage);
    const source = new CanonicalPackSource({ catalog: catalog(), fetchImpl, decodeImage });

    await expect(source.load(ref)).resolves.toBe(decodedImage);
    await expect(source.load(ref)).resolves.toBe(decodedImage);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(url, { mode: 'cors', credentials: 'omit' });
    expect(decodeImage).toHaveBeenCalledTimes(1);
  });

  it('supports a PNG manifest without changing the loader', async () => {
    const pngManifest = { ...MANIFEST, format: 'png' as const };
    const decodeImage = vi.fn(async (_blob: Blob) => decodedImage);
    const source = new CanonicalPackSource({
      catalog: catalog(pngManifest),
      fetchImpl: async () => response(new Uint8Array([137, 80, 78, 71]), 'image/png'),
      decodeImage,
    });

    await expect(source.load(ref)).resolves.toBe(decodedImage);
    expect(decodeImage.mock.calls[0]?.[0].type).toBe('image/png');
  });

  it.each([
    ['content-type', () => response('<svg/>', 'text/html')],
    ['too-large', () => response('0123456789abcdefg', 'image/svg+xml')],
  ] as const)('rejects %s violations before decoding', async (kind, makeResponse) => {
    const decodeImage = vi.fn(async () => decodedImage);
    const source = new CanonicalPackSource({
      catalog: catalog(),
      fetchImpl: async () => makeResponse(),
      decodeImage,
    });

    await expect(source.load(ref)).rejects.toMatchObject({ kind });
    expect(decodeImage).not.toHaveBeenCalled();
  });

  it('drops failures from the cache so a transient request can retry', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response('', 'image/svg+xml', 503))
      .mockResolvedValueOnce(response('<svg/>', 'image/svg+xml'));
    const source = new CanonicalPackSource({
      catalog: catalog(),
      fetchImpl,
      decodeImage: async () => decodedImage,
    });

    await expect(source.load(ref)).rejects.toMatchObject({ kind: 'network' });
    await expect(source.load(ref)).resolves.toBe(decodedImage);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('reports catalog and decoder failures with actionable kinds', async () => {
    const missingCatalog: EmojiPackCatalog = {
      ...catalog(),
      get: async () => ({ ok: false, error: 'manifest unavailable' }),
    };
    await expect(new CanonicalPackSource({ catalog: missingCatalog }).load(ref))
      .rejects.toMatchObject({ kind: 'missing' });

    const source = new CanonicalPackSource({
      catalog: catalog(),
      fetchImpl: async () => response('<svg/>', 'image/svg+xml'),
      decodeImage: async () => { throw new Error('bad image'); },
    });
    await expect(source.load(ref)).rejects.toBeInstanceOf(EmojiAssetError);
    await expect(source.load(ref)).rejects.toMatchObject({ kind: 'decode' });
  });
});
