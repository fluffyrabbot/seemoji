import { describe, expect, it } from 'vitest';
import { DEFAULT_EMOJI_LAYER, DEFAULT_TRANSFORM, DESIGN_LIMITS, type SceneLayer, type ShapeLayer } from './design';
import { layerLocalPointToWorld, layerWorldCorners, worldPointToLayerLocal } from './sceneGeometry';
import {
  moveSelection, rotateSelection, scaleLayerAxes, scaleSelection, scaleSelectionBy,
  selectionPivot, selectionSize, translateSelection,
} from './selectionTransforms';

const shape = (id: string, x = 0, y = 0): ShapeLayer => ({
  id, kind: 'shape', name: id, visible: true, opacity: 1, mask: [],
  transform: { ...DEFAULT_TRANSFORM, x, y, scaleX: 0.5, scaleY: 0.5 },
  shape: 'rectangle', bounds: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 }, fill: '#000000', stroke: null,
});
const distance = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

describe('shared selection transforms', () => {
  it('uses identical updates for numeric and pointer movement and size', () => {
    const layers = [shape('a', -0.1), shape('b', 0.1)];
    const pivot = selectionPivot(layers);
    expect(moveSelection(layers, 'x', pivot.x + 0.17))
      .toEqual(translateSelection(layers, { x: 0.17, y: 0 }));
    expect(scaleSelection(layers, selectionSize(layers) * 1.6)).toEqual(scaleSelectionBy(layers, 1.6));
  });

  it('preserves spacing when either translation axis meets a limit', () => {
    const layers = [shape('a', -0.4, -0.2), shape('b', 0.4, 0.3)];
    const updates = translateSelection(layers, { x: 0.4, y: 0.7 });
    expect(updates[1]!.transform.x).toBe(0.5);
    expect(updates[1]!.transform.y).toBe(0.5);
    expect(distance(updates[0]!.transform, updates[1]!.transform))
      .toBeCloseTo(distance(layers[0]!.transform, layers[1]!.transform));
  });

  it.each([[false, false], [true, false], [false, true], [true, true]])(
    'rotates mixed emoji and shape world corners exactly with mirrors %s/%s and skew', (flipH, flipV) => {
      const layers: readonly SceneLayer[] = [{ ...DEFAULT_EMOJI_LAYER,
        transform: { ...DEFAULT_TRANSFORM, x: -0.08, y: -0.04, scaleX: 2.2, scaleY: 1.9,
          rotate: 21, skewX: 18, skewY: -11, flipH: flipH!, flipV: flipV! },
      }, { ...shape('shape', 0.12, 0.07), transform: {
        ...shape('shape', 0.12, 0.07).transform, rotate: -31, skewX: -16, flipH: !flipH, flipV: flipV!,
      } }];
      const pivot = selectionPivot(layers);
      const degrees = 27;
      const radians = degrees * Math.PI / 180;
      const updates = rotateSelection(layers, degrees);
      layers.forEach((layer, index) => {
        const after = layerWorldCorners({ ...layer, transform: updates[index]!.transform });
        layerWorldCorners(layer).forEach((point, corner) => {
          const x = point.x - 0.5 - pivot.x;
          const y = point.y - 0.5 - pivot.y;
          expect(after[corner]!.x).toBeCloseTo(0.5 + pivot.x + x * Math.cos(radians) - y * Math.sin(radians), 10);
          expect(after[corner]!.y).toBeCloseTo(0.5 + pivot.y + x * Math.sin(radians) + y * Math.cos(radians), 10);
        });
      });
    },
  );

  it('uniformly scales oversized emoji and mixed objects around one pivot without fitting', () => {
    const layers: readonly SceneLayer[] = [{ ...DEFAULT_EMOJI_LAYER,
      transform: { ...DEFAULT_TRANSFORM, x: -0.1, scaleX: 2, scaleY: 1.8, skewX: 12, flipH: true },
    }, shape('shape', 0.1)];
    const pivot = selectionPivot(layers);
    const ratio = 1.4;
    const updates = scaleSelectionBy(layers, ratio);
    layers.forEach((layer, index) => {
      const after = layerWorldCorners({ ...layer, transform: updates[index]!.transform });
      layerWorldCorners(layer).forEach((point, corner) => {
        expect(after[corner]!.x).toBeCloseTo(0.5 + pivot.x + (point.x - 0.5 - pivot.x) * ratio, 10);
        expect(after[corner]!.y).toBeCloseTo(0.5 + pivot.y + (point.y - 0.5 - pivot.y) * ratio, 10);
      });
    });
  });

  it('uses one limiting ratio for the group, including position and both scale axes', () => {
    const layers = [shape('a', -0.4), shape('b', 0.4)];
    const updates = scaleSelectionBy(layers, 6);
    expect(updates[0]!.transform.x).toBeCloseTo(-0.5);
    expect(updates[1]!.transform.x).toBeCloseTo(0.5);
    expect(updates[0]!.transform.scaleX).toBeCloseTo(0.625);
    expect(updates[1]!.transform.scaleY).toBeCloseTo(0.625);
    const pinned = { ...shape('pinned'), transform: { ...DEFAULT_TRANSFORM, scaleX: 0.25, scaleY: 3 } };
    expect(scaleSelectionBy([pinned, shape('other')], 8).map((update) => update.transform))
      .toEqual([pinned.transform, shape('other').transform]);
  });

  it('scales unlocked local axes under rotation, mirror, and skew without moving the origin', () => {
    const layer = { ...shape('shape', 0.1, -0.1), transform: {
      ...shape('shape', 0.1, -0.1).transform, rotate: 57, skewX: 25, skewY: -14, flipH: true,
    } };
    const local = { x: 0.8, y: 0.2 };
    const targetLocal = { x: 0.5 + (local.x - 0.5) * 1.7, y: 0.5 + (local.y - 0.5) * 0.6 };
    const pointer = layerLocalPointToWorld(layer, targetLocal);
    const recovered = worldPointToLayerLocal(layer, pointer)!;
    const updates = scaleLayerAxes(layer, {
      x: (recovered.x - 0.5) / (local.x - 0.5), y: (recovered.y - 0.5) / (local.y - 0.5),
    });
    const result = layerLocalPointToWorld({ ...layer, transform: updates[0]!.transform }, local);
    expect(result.x).toBeCloseTo(pointer.x, 10);
    expect(result.y).toBeCloseTo(pointer.y, 10);
    expect(updates[0]!.transform.x).toBe(layer.transform.x);
    expect(updates[0]!.transform.y).toBe(layer.transform.y);
  });

  it.each([90, -90, 180, -180, 360, -360, 720])(
    'stops at the first outward crossing, even when the %s° endpoint is valid', (degrees) => {
      const layers = [shape('a', -0.48, -0.48), shape('b', 0.48, 0.48)];
      const updates = rotateSelection(layers, degrees);
      const expected = (Math.asin(0.5 / (0.48 * Math.sqrt(2))) - Math.PI / 4) * 180 / Math.PI;
      expect(updates[0]!.transform.rotate).toBeCloseTo(Math.sign(degrees) * expected, 9);
      expect(distance(updates[0]!.transform, updates[1]!.transform))
        .toBeCloseTo(distance(layers[0]!.transform, layers[1]!.transform), 10);
      for (const { transform } of updates) {
        expect(Math.abs(transform.x)).toBeLessThanOrEqual(DESIGN_LIMITS.x[1]);
        expect(Math.abs(transform.y)).toBeLessThanOrEqual(DESIGN_LIMITS.y[1]);
      }
    },
  );

  it('allows a complete circle that only touches the boundaries tangentially', () => {
    const layers = [shape('a', -0.5), shape('b', 0.5)];
    const updates = rotateSelection(layers, 360);
    expect(updates[0]!.transform.rotate).toBe(0);
    expect(updates[0]!.transform.x).toBeCloseTo(-0.5);
    expect(updates[1]!.transform.x).toBeCloseTo(0.5);
  });

  it('stops immediately when starting at a tangent that curves outside a limit', () => {
    const shiftedBounds = { x: 0.4, y: 0.4, width: 0.4, height: 0.2 };
    const layers = [shape('a', 0.5), shape('b', 0.5)].map((layer) => ({
      ...layer, transform: { ...layer.transform, scaleX: 1, scaleY: 1 }, bounds: shiftedBounds,
    }));
    expect(rotateSelection(layers, 60).map((update) => update.transform))
      .toEqual(layers.map((layer) => layer.transform));
  });

  it('rejects non-finite inputs before they can enter scene state', () => {
    expect(() => rotateSelection([shape('a')], NaN)).toThrow(RangeError);
    expect(() => scaleSelectionBy([shape('a')], Infinity)).toThrow(RangeError);
    expect(() => translateSelection([shape('a')], { x: NaN, y: 0 })).toThrow(RangeError);
  });
});
