import { describe, expect, it } from 'vitest';
import { DEFAULT_EMOJI_LAYER } from './design';
import { createEmojiAssetRef } from './emoji';
import { applyEmojiStyle, createEmojiStyle, decodeEmojiStyle, emojiStyleNameKey } from './emojiStyle';

const saved = () => {
  const result = createEmojiStyle('style-1', '  Mint sticker  ', 123, {
    ...DEFAULT_EMOJI_LAYER,
    transform: { ...DEFAULT_EMOJI_LAYER.transform, x: 0.25, y: -0.1, rotate: 32, scaleX: 1.5, scaleY: 0.8, skewX: 12, flipH: true },
    appearance: { ...DEFAULT_EMOJI_LAYER.appearance, hue: 41, outline: { width: 0.02, color: '#ABCDEF' } },
  });
  if (!result.ok) throw new Error(result.error);
  return result.value;
};

describe('reusable emoji style', () => {
  it('captures only the reusable look and preserves all target scene identity when applied', () => {
    const style = saved();
    expect(style.name).toBe('Mint sticker');
    expect(style.transform).not.toHaveProperty('x');
    expect(style.transform).not.toHaveProperty('y');
    expect(style).not.toHaveProperty('source');
    const target = { ...DEFAULT_EMOJI_LAYER, id: 'target', name: 'Target', visible: false, opacity: 0.4,
      source: createEmojiAssetRef('🍕'), transform: { ...DEFAULT_EMOJI_LAYER.transform, x: -0.2, y: 0.3 },
      mask: [{ id: 'mask', mode: 'erase' as const, width: 0.02, points: [{ x: 0.5, y: 0.5, pressure: 0.5 }] }],
    };
    const applied = applyEmojiStyle(target, style);
    expect(applied).toMatchObject({ id: 'target', name: 'Target', visible: false, opacity: 0.4,
      source: target.source, mask: target.mask,
      transform: { ...style.transform, x: -0.2, y: 0.3 }, appearance: style.appearance,
    });
    expect(target.transform.rotate).toBe(0);
    expect(applied.appearance.outline).not.toBe(style.appearance.outline);
  });

  it('round-trips through JSON and discards position accidentally present in imported style data', () => {
    const style = saved();
    expect(decodeEmojiStyle(JSON.parse(JSON.stringify(style)))).toEqual({ ok: true, value: style });
    const decoded = decodeEmojiStyle({ ...style, transform: { ...style.transform, x: 0.49, y: 0.49 } });
    expect(decoded).toEqual({ ok: true, value: style });
    expect(emojiStyleNameKey(' ＭＩＮＴ sticker ')).toBe(emojiStyleNameKey('mint STICKER'));
  });

  it('normalizes a zero-width outline to no outline without rejecting the look', () => {
    const style = saved();
    expect(decodeEmojiStyle({ ...style, appearance: { ...style.appearance, outline: { width: 0, color: '#abcdef' } } }))
      .toMatchObject({ ok: true, value: { appearance: { outline: null } } });
  });

  it.each([
    { version: 2 }, { name: '' }, { name: 'a'.repeat(49) }, { name: 'bad\nname' }, { id: '../bad' },
    { createdAt: -1 }, { createdAt: 0.5 },
    { transform: { rotate: NaN } }, { transform: { scaleX: 0 } }, { transform: { flipH: 1 } },
    { appearance: { hue: Infinity } }, { appearance: { blur: 2 } },
    { appearance: { outline: { width: 0.02, color: 'red' } } },
  ])('rejects invalid saved data %j', (patch) => {
    const style = saved();
    const candidate = { ...style, ...patch,
      transform: { ...style.transform, ...patch.transform },
      appearance: { ...style.appearance, ...patch.appearance },
    };
    expect(decodeEmojiStyle(candidate).ok).toBe(false);
  });
});
