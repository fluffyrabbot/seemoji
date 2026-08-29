import { describe, expect, it } from 'vitest';
import { DEFAULT_TRANSFORM, type ShapeLayer } from './design';
import { hitTestLayers, layerWorldBounds, unionWorldBounds } from './sceneGeometry';

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
});
