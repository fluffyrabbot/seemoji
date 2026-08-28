export const TWEMOJI_PACK_VERSION = '15.1.0';

export interface EmojiAssetRef {
  readonly pack: 'twemoji';
  readonly packVersion: string;
  readonly codepoint: string;
  readonly grapheme: string;
}

/** Extract the first user-perceived character, preserving ZWJ sequences. */
export function firstGrapheme(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  if (typeof Intl.Segmenter === 'function') {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    const first = segmenter.segment(trimmed)[Symbol.iterator]().next();
    if (!first.done) return first.value.segment;
  }

  return Array.from(trimmed)[0] ?? null;
}

/** Convert a grapheme to the lowercase, dash-separated filename used by Twemoji. */
export function toCodepoint(grapheme: string): string {
  return Array.from(grapheme.replace(/\uFE0F/g, ''))
    .map((character) => character.codePointAt(0)?.toString(16))
    .filter((part): part is string => part !== undefined)
    .join('-');
}

export function createEmojiAssetRef(grapheme: string): EmojiAssetRef {
  return {
    pack: 'twemoji',
    packVersion: TWEMOJI_PACK_VERSION,
    codepoint: toCodepoint(grapheme),
    grapheme,
  };
}
