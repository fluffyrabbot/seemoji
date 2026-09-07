import { describe, expect, it } from 'vitest';
import { DEFAULT_DESIGN, DEFAULT_EMOJI_LAYER, DESIGN_LIMITS, getEmojiLayer, updateEmojiLayer, type DesignDocument } from './design';
import { createEmojiRenderPlan, createLayerMatrix, createRenderPlan } from './renderPlan';

const extremeDesign: DesignDocument = updateEmojiLayer(DEFAULT_DESIGN, (layer) => ({
  ...layer,
  transform: {
    ...layer.transform,
    rotate: 137,
    scaleX: DESIGN_LIMITS.scaleX[1],
    scaleY: DESIGN_LIMITS.scaleY[1],
    skewX: DESIGN_LIMITS.skewX[1],
    skewY: DESIGN_LIMITS.skewY[0],
    flipH: true,
    flipV: true,
  },
  appearance: {
    hue: 180,
    saturation: 4,
    brightness: 3,
    blur: DESIGN_LIMITS.blur[1],
    outline: { width: DESIGN_LIMITS.outlineWidth[1], color: '#000000' },
  },
}));

describe('render planning', () => {
  it.each([48, 128, 256])('preserves explicit geometry at %ipx, including content outside the output', (size) => {
    const plan = createRenderPlan(extremeDesign, size);
    expect(plan.matrix).toEqual(createLayerMatrix(getEmojiLayer(extremeDesign).transform, size));
    expect(plan.contentBounds.left).toBeLessThan(0);
    expect(plan.contentBounds.top).toBeLessThan(0);
    expect(plan.contentBounds.right).toBeGreaterThan(size);
    expect(plan.contentBounds.bottom).toBeGreaterThan(size);
    expect(Object.values(plan.matrix).every(Number.isFinite)).toBe(true);
  });

  it('doubles visible emoji geometry when scale doubles beyond the former fit ceiling', () => {
    const base = { ...DEFAULT_EMOJI_LAYER, transform: { ...DEFAULT_EMOJI_LAYER.transform, scaleX: 1.5, scaleY: 1.5 } };
    const large = { ...base, transform: { ...base.transform, scaleX: 3, scaleY: 3 } };
    const first = createEmojiRenderPlan(base, 128);
    const second = createEmojiRenderPlan(large, 128);
    expect(second.matrix.a).toBe(2 * first.matrix.a);
    expect(second.contentBounds.right - second.contentBounds.left)
      .toBeCloseTo(2 * (first.contentBounds.right - first.contentBounds.left));
  });

  it('adds blur and outline padding without changing the layer matrix or glyph scale', () => {
    const base = createEmojiRenderPlan(DEFAULT_EMOJI_LAYER, 128);
    const effects = createEmojiRenderPlan({ ...DEFAULT_EMOJI_LAYER, appearance: {
      ...DEFAULT_EMOJI_LAYER.appearance, blur: 0.08, outline: { width: 0.08, color: '#ffffff' },
    } }, 128);
    expect(effects.matrix).toEqual(base.matrix);
    expect(effects.glyphSize).toBe(base.glyphSize);
    expect(effects.contentBounds.left).toBeCloseTo(base.contentBounds.left - 128 * (0.08 * 3 + 0.08));
  });

  it('preserves composition ratios across export resolutions', () => {
    const small = createRenderPlan(extremeDesign, 48).contentBounds;
    const large = createRenderPlan(extremeDesign, 256).contentBounds;
    expect(small.left / 48).toBeCloseTo(large.left / 256, 8);
    expect(small.top / 48).toBeCloseTo(large.top / 256, 8);
    expect(small.right / 48).toBeCloseTo(large.right / 256, 8);
    expect(small.bottom / 48).toBeCloseTo(large.bottom / 256, 8);
  });

  it('maps normalized layer position into output coordinates', () => {
    const moved = updateEmojiLayer(DEFAULT_DESIGN, (layer) => ({
      ...layer,
      transform: { ...layer.transform, x: 0.25, y: -0.1 },
    }));
    const plan = createRenderPlan(moved, 128);
    expect(plan.matrix.e).toBe(96);
    expect(plan.matrix.f).toBeCloseTo(51.2);
  });

  it('rejects nonsensical output sizes at the boundary', () => {
    expect(() => createRenderPlan(DEFAULT_DESIGN, 0)).toThrow(RangeError);
    expect(() => createRenderPlan(DEFAULT_DESIGN, 48.5)).toThrow(RangeError);
    expect(() => createRenderPlan(DEFAULT_DESIGN, 4096)).toThrow(RangeError);
  });
});
