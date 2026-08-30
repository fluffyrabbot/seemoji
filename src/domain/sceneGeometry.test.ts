import { describe, expect, it } from 'vitest';
import { DEFAULT_EMOJI_LAYER, DEFAULT_TRANSFORM, type ShapeLayer } from './design';
import { createEmojiRenderPlan } from './renderPlan';
import {
  hitTestLayers,
  layerLocalPointToWorld,
  layerWorldBounds,
  unionWorldBounds,
  worldPointToLayerLocal,
} from './sceneGeometry';

const shape = (id: string, x: number): ShapeLayer => ({ id, kind: 'shape', name: id,
  visible: true, opacity: 1, transform: { ...DEFAULT_TRANSFORM, x }, mask: [],
  shape: 'rectangle', bounds: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 },
  fill: '#000000', stroke: null });

describe('scene geometry', () => {
  it('derives transformed bounds and unions selections', () => {
    expect(layerWorldBounds(shape('a', 0.1))).toEqual({ left: 0.35, top: 0.25, right: 0.85, bottom: 0.75 });
    const union = unionWorldBounds([shape('a', -0.1), shape('b', 0.1)]);
    expect(union?.left).toBeCloseTo(0.15);
    expect(union).toMatchObject({ top: 0.25, right: 0.85, bottom: 0.75 });
  });

  it('hit-tests in topmost paint order', () => {
    expect(hitTestLayers([shape('back', 0), shape('front', 0)], { x: 0.5, y: 0.5 })?.id).toBe('front');
  });

  it('round-trips layer-local points through the complete affine transform', () => {
    const transformed: ShapeLayer = {
      ...shape('affine', 0.13),
      transform: {
        x: 0.13,
        y: -0.09,
        rotate: 37,
        scaleX: 1.7,
        scaleY: 0.65,
        skewX: 24,
        skewY: -17,
        flipH: true,
        flipV: false,
      },
    };
    const local = { x: 0.31, y: 0.68 };
    const world = layerLocalPointToWorld(transformed, local);
    const recovered = worldPointToLayerLocal(transformed, world);

    expect(recovered?.x).toBeCloseTo(local.x, 12);
    expect(recovered?.y).toBeCloseTo(local.y, 12);
  });

  it('keeps a local point attached after move, scale, rotate, skew, and flip changes', () => {
    const local = { x: 0.36, y: 0.42 };
    const before = layerLocalPointToWorld(shape('before', 0), local);
    const afterLayer: ShapeLayer = {
      ...shape('after', -0.18),
      transform: {
        x: -0.18,
        y: 0.12,
        rotate: -71,
        scaleX: 1.35,
        scaleY: 0.55,
        skewX: -19,
        skewY: 11,
        flipH: true,
        flipV: true,
      },
    };
    const after = layerLocalPointToWorld(afterLayer, local);

    expect(after).not.toEqual(before);
    expect(worldPointToLayerLocal(afterLayer, after)).toEqual(expect.objectContaining({
      x: expect.closeTo(local.x, 12),
      y: expect.closeTo(local.y, 12),
    }));
  });

  it('declines to invert a collapsed affine transform', () => {
    const collapsed: ShapeLayer = {
      ...shape('collapsed', 0),
      transform: { ...DEFAULT_TRANSFORM, skewX: 45, skewY: 45 },
    };
    expect(worldPointToLayerLocal(collapsed, { x: 0.5, y: 0.5 })).toBeNull();
  });

  it("uses the emoji planner's fitted matrix for interaction geometry", () => {
    const emoji = {
      ...DEFAULT_EMOJI_LAYER,
      transform: { ...DEFAULT_TRANSFORM, x: 0.12, rotate: 47, scaleX: 3, scaleY: 2.4 },
    };
    const local = { x: 0.29, y: 0.63 };
    const plan = createEmojiRenderPlan(emoji, 256);
    const x = (local.x - 0.5) * 256;
    const y = (local.y - 0.5) * 256;
    const expected = {
      x: (plan.matrix.a * x + plan.matrix.c * y + plan.matrix.e) / 256,
      y: (plan.matrix.b * x + plan.matrix.d * y + plan.matrix.f) / 256,
    };

    expect(layerLocalPointToWorld(emoji, local).x).toBeCloseTo(expected.x, 12);
    expect(layerLocalPointToWorld(emoji, local).y).toBeCloseTo(expected.y, 12);
    expect(worldPointToLayerLocal(emoji, expected)?.x).toBeCloseTo(local.x, 12);
    expect(worldPointToLayerLocal(emoji, expected)?.y).toBeCloseTo(local.y, 12);
  });
});
