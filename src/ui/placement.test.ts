import { describe, expect, it } from 'vitest';
import { createPlacedLayer } from './placement';
import { layerLocalPointToWorld } from '../domain/sceneGeometry';

describe('canvas placement', () => {
  it('normalizes reverse drags and clips oversized gestures to the canvas', () => {
    const layer = createPlacedLayer('rectangle', { x: 0.8, y: 0.7 }, { x: -0.2, y: 0.1 }, 'shape', '#123456');
    if (layer.kind !== 'shape') throw new Error('expected shape');
    expect(layer.bounds.x).toBeCloseTo(0);
    expect(layer.bounds.y).toBeCloseTo(0.1);
    expect(layer.bounds.width).toBeCloseTo(0.8);
    expect(layer.bounds.height).toBeCloseTo(0.6);
    expect(layer.fill).toBe('#123456');
  });

  it('preserves the visible endpoints of an upward line instead of reversing its slope', () => {
    const layer = createPlacedLayer('line', { x: 0.1, y: 0.8 }, { x: 0.7, y: 0.2 }, 'line', '#123456');
    if (layer.kind !== 'shape') throw new Error('expected shape');
    const a = layerLocalPointToWorld(layer, { x: layer.bounds.x, y: layer.bounds.y });
    const b = layerLocalPointToWorld(layer, { x: layer.bounds.x + layer.bounds.width, y: layer.bounds.y + layer.bounds.height });
    expect(a.x).toBeCloseTo(0.1); expect(a.y).toBeCloseTo(0.8);
    expect(b.x).toBeCloseTo(0.7); expect(b.y).toBeCloseTo(0.2);
  });

  it('keeps click-created text inside the document near the bottom-right edge', () => {
    const layer = createPlacedLayer('text', { x: 0.98, y: 0.99 }, { x: 0.98, y: 0.99 }, 'text', '#123456');
    if (layer.kind !== 'text') throw new Error('expected text');
    expect(layer.bounds.x + layer.bounds.width).toBeLessThanOrEqual(1);
    expect(layer.bounds.y + layer.bounds.height).toBeLessThanOrEqual(1);
    expect(layer.bounds.width).toBe(0.6);
  });
});

describe('placement modifiers', () => {
  it.each(['rectangle', 'ellipse'] as const)('constrains %s and clips uniformly at every edge', (tool) => {
    for (const end of [{ x: 2, y: 0.7 }, { x: -1, y: 0.9 }, { x: 0.9, y: -2 }]) {
      const layer = createPlacedLayer(tool, { x: 0.3, y: 0.4 }, end, 'shape', '#000000', { shiftKey: true });
      if (layer.kind !== 'shape') throw new Error('expected shape');
      expect(layer.bounds.width).toBeCloseTo(layer.bounds.height);
      expect(layer.bounds.x).toBeGreaterThanOrEqual(0);
      expect(layer.bounds.y).toBeGreaterThanOrEqual(0);
      expect(layer.bounds.x + layer.bounds.width).toBeLessThanOrEqual(1);
      expect(layer.bounds.y + layer.bounds.height).toBeLessThanOrEqual(1);
    }
  });

  it.each([false, true])('preserves the center when clipping an Alt drag (Shift=%s)', (shiftKey) => {
    const layer = createPlacedLayer('ellipse', { x: 0.2, y: 0.6 }, { x: -1, y: 2 }, 'shape', '#000000', { altKey: true, shiftKey });
    if (layer.kind !== 'shape') throw new Error('expected shape');
    expect(layer.bounds.x + layer.bounds.width / 2).toBeCloseTo(0.2);
    expect(layer.bounds.y + layer.bounds.height / 2).toBeCloseTo(0.6);
    expect(layer.bounds.width).toBeCloseTo(0.4);
    expect(layer.bounds.height).toBeCloseTo(shiftKey ? 0.4 : 0.8);
  });
});
