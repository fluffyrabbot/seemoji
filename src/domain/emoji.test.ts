import { describe, expect, it } from 'vitest';
import { createEmojiAssetRef, firstGrapheme, toCodepoint } from './emoji';

describe('emoji identity', () => {
  it.each([
    ['😀', '1f600'],
    ['❤️', '2764'],
    ['👨‍👩‍👧‍👦', '1f468-200d-1f469-200d-1f467-200d-1f466'],
    ['👍🏽', '1f44d-1f3fd'],
    ['🇺🇸', '1f1fa-1f1f8'],
  ])('maps %s to %s', (grapheme, codepoint) => {
    expect(toCodepoint(grapheme)).toBe(codepoint);
  });

  it('pins pack identity into the source reference', () => {
    expect(createEmojiAssetRef('😀')).toEqual({
      pack: 'twemoji',
      packVersion: '15.1.0',
      codepoint: '1f600',
      grapheme: '😀',
    });
  });

  it('extracts exactly one grapheme', () => {
    expect(firstGrapheme(' 👨‍👩‍👧‍👦 hello')).toBe('👨‍👩‍👧‍👦');
    expect(firstGrapheme('   ')).toBeNull();
  });
});
