import {
  DEFAULT_PACK_SNAPSHOT,
  type PackId,
  type PackSnapshot,
  type PackStyle,
} from './pack';

export interface EmojiAssetRef {
  readonly pack: PackId;
  readonly packVersion: string;
  readonly style?: PackStyle;
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

/** Convert a grapheme to its canonical lowercase, dash-separated Unicode key. */
export function toCodepoint(grapheme: string): string {
  return Array.from(grapheme.replace(/\uFE0F/g, ''))
    .map((character) => character.codePointAt(0)?.toString(16))
    .filter((part): part is string => part !== undefined)
    .join('-');
}

export function createEmojiAssetRef(
  grapheme: string,
  snapshot: PackSnapshot = DEFAULT_PACK_SNAPSHOT,
): EmojiAssetRef {
  const ref: EmojiAssetRef = {
    pack: snapshot.pack,
    packVersion: snapshot.packVersion,
    codepoint: toCodepoint(grapheme),
    grapheme,
  };
  return snapshot.style === undefined ? ref : { ...ref, style: snapshot.style };
}
