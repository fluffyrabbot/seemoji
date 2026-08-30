import { describe, expect, it } from 'vitest';
import { createEmojiAssetRef } from '../domain/emoji';
import type { EmojiPackCatalog } from '../ports/emojiPackCatalog';
import { artworkMissingMessage, remapSource } from './remapSource';

const catalog = (covered: boolean): EmojiPackCatalog => ({
  list: async () => ({ ok: true, value: [] }),
  get: async () => ({ ok: false, error: 'unused' }),
  hasGlyph: async () => covered,
  assetUrl: async () => ({ ok: false, error: 'unused' }),
  summaryFor: () => ({
    id: 'twemoji',
    name: 'Twemoji',
    versions: [{ version: '15.1.0', styles: [], defaultStyle: null }],
    defaultVersion: '15.1.0',
    license: {
      spdx: 'CC-BY-4.0', attribution: 'Twemoji', shareAlike: false, noticeUrl: 'https://license.test',
    },
    unicodeLevel: '15.1',
  }),
});

describe('remapSource', () => {
  it('preserves the grapheme while changing its snapshot identity', async () => {
    await expect(remapSource(
      createEmojiAssetRef('😀'),
      { pack: 'twemoji', packVersion: '15.1.0' },
      catalog(true),
    )).resolves.toEqual({ ok: true, value: createEmojiAssetRef('😀') });
  });

  it('returns shared user-facing copy on a coverage miss', async () => {
    await expect(remapSource(
      createEmojiAssetRef('A'),
      { pack: 'twemoji', packVersion: '15.1.0' },
      catalog(false),
    )).resolves.toEqual({
      ok: false,
      error: artworkMissingMessage('Twemoji', '15.1.0', 'A'),
    });
  });
});
