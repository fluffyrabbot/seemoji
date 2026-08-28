import { describe, expect, it } from 'vitest';
import { DEFAULT_DESIGN } from './design';
import { decodeDesignDocument, migrateLegacyEditParams } from './designCodec';

describe('design document codec', () => {
  it('round-trips a valid versioned document', () => {
    expect(decodeDesignDocument(JSON.parse(JSON.stringify(DEFAULT_DESIGN)))).toEqual({
      ok: true,
      value: DEFAULT_DESIGN,
    });
  });

  it('rejects unknown versions instead of silently coercing them', () => {
    const decoded = decodeDesignDocument({ ...DEFAULT_DESIGN, version: 2 });
    expect(decoded.ok).toBe(false);
    if (!decoded.ok) expect(decoded.error).toContain('unsupported');
  });

  it('rejects a source whose grapheme and codepoint disagree', () => {
    const decoded = decodeDesignDocument({
      ...DEFAULT_DESIGN,
      source: { ...DEFAULT_DESIGN.source, codepoint: '1f44d' },
    });
    expect(decoded.ok).toBe(false);
  });

  it('rejects out-of-range values rather than creating an invalid domain value', () => {
    const decoded = decodeDesignDocument({
      ...DEFAULT_DESIGN,
      appearance: { ...DEFAULT_DESIGN.appearance, blur: 99 },
    });
    expect(decoded.ok).toBe(false);
  });

  it('explicitly migrates prototype edit parameters into normalized units', () => {
    const migrated = migrateLegacyEditParams('😀', {
      v: 1,
      rotate: 15,
      scaleX: 1.2,
      scaleY: 0.8,
      skewX: 4,
      skewY: -3,
      flipH: true,
      flipV: false,
      hue: 30,
      saturate: 150,
      brightness: 80,
      blur: 4,
      outline: { width: 3, color: '#ff00aa' },
    });
    expect(migrated.ok).toBe(true);
    if (migrated.ok) {
      expect(migrated.value.appearance.saturation).toBe(1.5);
      expect(migrated.value.appearance.blur).toBe(4 / 128);
      expect(migrated.value.appearance.outline?.width).toBe(3 / 128);
      expect(migrated.value.source.codepoint).toBe('1f600');
    }
  });
});
