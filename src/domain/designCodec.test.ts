import { describe, expect, it } from 'vitest';
import { DEFAULT_DESIGN, getEmojiLayer, type DesignDocumentV1 } from './design';
import { decodeDesignDocument } from './designCodec';

describe('design document codec', () => {
  it('round-trips a valid V2 scene document', () => {
    expect(decodeDesignDocument(JSON.parse(JSON.stringify(DEFAULT_DESIGN)))).toEqual({
      ok: true,
      value: DEFAULT_DESIGN,
    });
  });

  it('explicitly promotes a V1 recipe into a V2 emoji layer', () => {
    const layer = getEmojiLayer(DEFAULT_DESIGN);
    const { x: _x, y: _y, ...positionlessTransform } = layer.transform;
    const versionOne: DesignDocumentV1 = {
      version: 1,
      source: layer.source,
      transform: { ...positionlessTransform, rotate: 18 },
      appearance: layer.appearance,
    };
    const decoded = decodeDesignDocument(versionOne);
    expect(decoded.ok).toBe(true);
    if (decoded.ok) {
      expect(decoded.value.version).toBe(2);
      expect(getEmojiLayer(decoded.value).transform).toMatchObject({ x: 0, y: 0, rotate: 18 });
    }
  });

  it('rejects unknown versions instead of silently coercing them', () => {
    const decoded = decodeDesignDocument({ ...DEFAULT_DESIGN, version: 3 });
    expect(decoded.ok).toBe(false);
    if (!decoded.ok) expect(decoded.error).toContain('unsupported');
  });

  it('rejects a source whose grapheme and codepoint disagree', () => {
    const layer = getEmojiLayer(DEFAULT_DESIGN);
    const decoded = decodeDesignDocument({
      ...DEFAULT_DESIGN,
      layers: [{ ...layer, source: { ...layer.source, codepoint: '1f44d' } }],
    });
    expect(decoded.ok).toBe(false);
  });

  it('keeps recognized styles and drops unknown source keys', () => {
    const layer = getEmojiLayer(DEFAULT_DESIGN);
    const decoded = decodeDesignDocument({
      ...DEFAULT_DESIGN,
      layers: [{
        ...layer,
        source: { ...layer.source, style: 'flat', ignored: 'value' },
      }],
    });
    expect(decoded.ok).toBe(true);
    if (decoded.ok) {
      expect(getEmojiLayer(decoded.value).source).toEqual({
        ...layer.source,
        style: 'flat',
      });
    }
  });

  it.each([null, 'invented'])('rejects invalid source style %s', (style) => {
    const layer = getEmojiLayer(DEFAULT_DESIGN);
    const decoded = decodeDesignDocument({
      ...DEFAULT_DESIGN,
      layers: [{ ...layer, source: { ...layer.source, style } }],
    });
    expect(decoded.ok).toBe(false);
  });

  it('round-trips every non-default pack source', () => {
    const layer = getEmojiLayer(DEFAULT_DESIGN);
    for (const source of [
      { ...layer.source, pack: 'noto' as const, packVersion: '2.042.0' },
      { ...layer.source, pack: 'fluent' as const, packVersion: '1.0.0', style: 'color' as const },
      { ...layer.source, pack: 'fluent' as const, packVersion: '1.1.0', style: 'high-contrast' as const },
      { ...layer.source, pack: 'openmoji' as const, packVersion: '17.0.0', style: 'color' as const },
      { ...layer.source, pack: 'fxemoji' as const, packVersion: '1.7.9' },
      { ...layer.source, pack: 'emojitwo' as const, packVersion: '2.2.7' },
      { ...layer.source, pack: 'blobmoji' as const, packVersion: '1.0.0' },
      { ...layer.source, pack: 'serenity' as const, packVersion: '1.0.0' },
    ]) {
      const document = { ...DEFAULT_DESIGN, layers: [{ ...layer, source }] };
      expect(decodeDesignDocument(JSON.parse(JSON.stringify(document))))
        .toEqual({ ok: true, value: document });
    }
  });

  it('rejects packs outside the shipped allowlist', () => {
    const layer = getEmojiLayer(DEFAULT_DESIGN);
    expect(decodeDesignDocument({
      ...DEFAULT_DESIGN,
      layers: [{ ...layer, source: { ...layer.source, pack: 'future-pack' } }],
    }).ok).toBe(false);
  });

  it('rejects out-of-range layer values', () => {
    const layer = getEmojiLayer(DEFAULT_DESIGN);
    const decoded = decodeDesignDocument({
      ...DEFAULT_DESIGN,
      layers: [{ ...layer, appearance: { ...layer.appearance, blur: 99 } }],
    });
    expect(decoded.ok).toBe(false);
  });

  it('round-trips normalized pressure strokes and non-destructive masks', () => {
    const scene = {
      ...DEFAULT_DESIGN,
      layers: [
        ...DEFAULT_DESIGN.layers,
        {
          id: 'paint-1',
          kind: 'strokes' as const,
          name: 'Paint',
          visible: true,
          opacity: 0.8,
          transform: getEmojiLayer(DEFAULT_DESIGN).transform,
          strokes: [{
            id: 'stroke-1',
            points: [{ x: 0.1, y: 0.2, pressure: 0.7 }],
            width: 0.04,
            color: '#ff00aa',
            opacity: 0.9,
          }],
          mask: [{
            id: 'mask-1',
            mode: 'erase' as const,
            points: [{ x: 0.15, y: 0.2, pressure: 0.6 }],
            width: 0.02,
          }],
        },
      ],
    };
    expect(decodeDesignDocument(JSON.parse(JSON.stringify(scene)))).toEqual({
      ok: true,
      value: scene,
    });
  });

  it('normalizes earlier V2 paint layers with identity transforms and erase masks', () => {
    const decoded = decodeDesignDocument({
      ...DEFAULT_DESIGN,
      layers: [
        ...DEFAULT_DESIGN.layers,
        {
          id: 'paint-1',
          kind: 'strokes',
          name: 'Paint',
          visible: true,
          opacity: 1,
          strokes: [],
          mask: [{
            id: 'mask-1',
            points: [{ x: 0.5, y: 0.5, pressure: 0.5 }],
            width: 0.03,
          }],
        },
      ],
    });
    expect(decoded.ok).toBe(true);
    if (decoded.ok) {
      expect(decoded.value.layers[1]?.transform).toEqual(getEmojiLayer(DEFAULT_DESIGN).transform);
      expect(decoded.value.layers[1]?.mask[0]).toMatchObject({ mode: 'erase' });
    }
  });

  it('round-trips structured and bounded raster scene nodes', () => {
    const transform = getEmojiLayer(DEFAULT_DESIGN).transform;
    const scene = { ...DEFAULT_DESIGN, layers: [...DEFAULT_DESIGN.layers,
      { id: 'shape-1', kind: 'shape' as const, name: 'Ellipse', visible: true, opacity: 1,
        transform, mask: [], shape: 'ellipse' as const,
        bounds: { x: 0.2, y: 0.3, width: 0.6, height: 0.4 }, fill: '#ff00aa', stroke: null },
      { id: 'text-1', kind: 'text' as const, name: 'Text', visible: true, opacity: 1,
        transform, mask: [], bounds: { x: 0.2, y: 0.3, width: 0.6, height: 0.2 },
        text: 'Hello', fontSize: 0.12, color: '#ffffff', fontFamily: 'sans-serif' as const, align: 'center' as const },
      { id: 'fill-1', kind: 'raster' as const, name: 'Fill', visible: true, opacity: 1,
        transform, mask: [], resolution: 16, runs: [{ y: 2, xStart: 3, xEnd: 8, color: '#112233' }] },
    ] };
    expect(decodeDesignDocument(JSON.parse(JSON.stringify(scene)))).toEqual({ ok: true, value: scene });
  });

  it('rejects stroke points outside the normalized canvas', () => {
    const decoded = decodeDesignDocument({
      ...DEFAULT_DESIGN,
      layers: [
        ...DEFAULT_DESIGN.layers,
        {
          id: 'paint-1',
          kind: 'strokes',
          name: 'Paint',
          visible: true,
          opacity: 1,
          transform: getEmojiLayer(DEFAULT_DESIGN).transform,
          strokes: [{
            id: 'stroke-1',
            points: [{ x: 2, y: 0.2, pressure: 0.5 }],
            width: 0.03,
            color: '#000000',
            opacity: 1,
          }],
          mask: [],
        },
      ],
    });
    expect(decoded.ok).toBe(false);
  });

});
