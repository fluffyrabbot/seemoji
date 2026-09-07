import { describe, expect, it } from 'vitest';
import { DEFAULT_EMOJI_LAYER, DEFAULT_TRANSFORM, type SceneLayer, type ShapeLayer } from '../domain/design';
import { layerWorldCorners } from '../domain/sceneGeometry';
import { applyQuickStyle, moveSelection, rotateSelection, scaleSelection, selectionCenter } from './inspectorModel';

const shape = (id: string, x: number, y = 0): ShapeLayer => ({
  id, kind: 'shape', name: id, visible: true, opacity: 1, mask: [],
  transform: { ...DEFAULT_TRANSFORM, x, y, scaleX: 0.5, scaleY: 0.5 },
  shape: 'rectangle', bounds: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 }, fill: '#000000', stroke: null,
});

describe('inspector recipes', () => {
  const edited = { ...DEFAULT_EMOJI_LAYER,
    transform: { ...DEFAULT_TRANSFORM, x: 0.2, y: -0.1, scaleX: 1.4, scaleY: 0.8, rotate: 40, flipH: true },
    appearance: { ...DEFAULT_EMOJI_LAYER.appearance, hue: 40, brightness: 1.2 },
  };

  it('composes idempotent named changes without losing unrelated edits', () => {
    const tilt = applyQuickStyle(edited, 'tilt');
    expect(tilt.transform).toEqual({ ...edited.transform, rotate: -12 });
    expect(tilt.appearance).toBe(edited.appearance);
    const squish = applyQuickStyle(tilt, 'squish');
    expect(squish.transform.scaleX / squish.transform.scaleY).toBeCloseTo(1.5);
    expect(squish.transform.scaleX * squish.transform.scaleY).toBeCloseTo(1.4 * 0.8);
    expect(squish.transform).toMatchObject({ x: 0.2, y: -0.1, rotate: -12, flipH: true });
    expect(applyQuickStyle(squish, 'squish')).toEqual(squish);
    const sticker = applyQuickStyle(squish, 'sticker');
    expect(sticker.transform).toBe(squish.transform);
    expect(sticker.appearance).toEqual({ ...edited.appearance, outline: { width: 0.025, color: '#ffffff' } });
  });

  it('resets only the chosen emoji color and transforms while retaining its placement and content', () => {
    const result = applyQuickStyle(edited, 'original');
    expect(result.transform).toEqual({ ...DEFAULT_TRANSFORM, x: 0.2, y: -0.1 });
    expect(result.appearance).toEqual(DEFAULT_EMOJI_LAYER.appearance);
    expect(result.source).toBe(edited.source);
    expect(result.id).toBe(edited.id);
  });
});

describe('inspector selection transforms', () => {
  it('scales positions and dimensions around a shared selection pivot', () => {
    const layers = [shape('a', -0.15), shape('b', 0.15)];
    const updates = scaleSelection(layers, 1);
    expect(updates[0]).toMatchObject({ layerId: 'a', transform: { x: -0.3, scaleX: 1, scaleY: 1 } });
    expect(updates[1]).toMatchObject({ layerId: 'b', transform: { x: 0.3, scaleX: 1, scaleY: 1 } });
  });

  it('uses one size limit for the whole selection, preserving relative scales and spacing', () => {
    const first = shape('a', -0.1);
    const second = { ...shape('b', 0.1), transform: { ...DEFAULT_TRANSFORM, x: 0.1, scaleX: 2, scaleY: 2 } };
    const layers = [first, second];
    const updates = scaleSelection(layers, 3);
    expect(updates[1]!.transform.scaleX).toBe(3);
    expect(updates[0]!.transform.scaleX).toBe(0.75);
    expect(updates[1]!.transform.x - updates[0]!.transform.x).toBeCloseTo(0.3);
  });

  it('translates the group together at a boundary', () => {
    const updates = moveSelection([shape('a', -0.2), shape('b', 0.2)], 'x', 0.5);
    expect(updates[0]!.transform.x).toBeCloseTo(0.1);
    expect(updates[1]!.transform.x).toBeCloseTo(0.5);
  });

  it('rotates every world corner around the shared pivot even for mirrored and skewed objects', () => {
    const layers: readonly SceneLayer[] = [shape('a', -0.12, -0.05), {
      ...shape('b', 0.15, 0.08),
      transform: { ...shape('b', 0.15, 0.08).transform, flipH: true, skewX: 20, rotate: 15 },
    }];
    const pivot = selectionCenter(layers);
    const angle = 35 * Math.PI / 180;
    const updates = rotateSelection(layers, 35);
    layers.forEach((layer, index) => {
      const before = layerWorldCorners(layer);
      const after = layerWorldCorners({ ...layer, transform: updates[index]!.transform });
      before.forEach((point, corner) => {
        const x = point.x - 0.5 - pivot.x;
        const y = point.y - 0.5 - pivot.y;
        expect(after[corner]!.x).toBeCloseTo(0.5 + pivot.x + x * Math.cos(angle) - y * Math.sin(angle));
        expect(after[corner]!.y).toBeCloseTo(0.5 + pivot.y + x * Math.sin(angle) + y * Math.cos(angle));
      });
    });
  });

  it('stops rotation as a group before positions exceed their limits', () => {
    const layers = [shape('a', -0.48, -0.48), shape('b', 0.48, 0.48)];
    const updates = rotateSelection(layers, 30);
    const distance = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
    expect(distance(updates[0]!.transform, updates[1]!.transform))
      .toBeCloseTo(distance(layers[0]!.transform, layers[1]!.transform));
    for (const update of updates) {
      expect(Math.abs(update.transform.x)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(update.transform.y)).toBeLessThanOrEqual(0.5);
    }
  });
});
