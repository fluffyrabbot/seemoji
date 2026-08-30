import type { DesignDocument } from './design';

/** Persisted scene capacities shared by editing and decoding boundaries. */
export const DESIGN_CAPACITY = {
  layers: 100,
  strokesPerCollection: 10_000,
  pointsPerStroke: 50_000,
  pointsPerDocument: 250_000,
} as const;

type StrokeCollection = readonly { readonly points: readonly unknown[] }[];

function addStrokeCollectionPoints(total: number, strokes: StrokeCollection): number | null {
  if (strokes.length > DESIGN_CAPACITY.strokesPerCollection) return null;
  for (const stroke of strokes) {
    if (stroke.points.length === 0 || stroke.points.length > DESIGN_CAPACITY.pointsPerStroke) {
      return null;
    }
    total += stroke.points.length;
    if (total > DESIGN_CAPACITY.pointsPerDocument) return null;
  }
  return total;
}

/**
 * Checks the collection and point-count constraints enforced by the persisted codec.
 * Call this only for transitions that replace or add stroke-bearing scene data.
 */
export function hasDesignCapacity(design: DesignDocument): boolean {
  if (design.layers.length === 0 || design.layers.length > DESIGN_CAPACITY.layers) return false;
  let total = 0;
  for (const layer of design.layers) {
    const withMask = addStrokeCollectionPoints(total, layer.mask);
    if (withMask === null) return false;
    total = withMask;
    if (layer.kind === 'strokes') {
      const withPaint = addStrokeCollectionPoints(total, layer.strokes);
      if (withPaint === null) return false;
      total = withPaint;
    }
  }
  return true;
}
