import { describe, expect, it } from 'vitest';
import { DEFAULT_DESIGN, DESIGN_LIMITS, updateEmojiLayer, type DesignDocument } from './design';
import { createRenderPlan } from './renderPlan';

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
  it.each([48, 128, 256])('keeps maximum supported effects inside %ipx', (size) => {
    const plan = createRenderPlan(extremeDesign, size);
    expect(plan.contentBounds.left).toBeGreaterThanOrEqual(0);
    expect(plan.contentBounds.top).toBeGreaterThanOrEqual(0);
    expect(plan.contentBounds.right).toBeLessThanOrEqual(size);
    expect(plan.contentBounds.bottom).toBeLessThanOrEqual(size);
    expect(Object.values(plan.matrix).every(Number.isFinite)).toBe(true);
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
