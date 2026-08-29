import type { LayerBounds, SceneLayer, Transform } from './design';
import { createLayerMatrix } from './renderPlan';

export interface WorldBounds {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export interface WorldPoint { readonly x: number; readonly y: number }

const DEFAULT_BOUNDS: LayerBounds = { x: 0.25, y: 0.25, width: 0.5, height: 0.5 };

export function layerLocalBounds(layer: SceneLayer): LayerBounds {
  if (layer.kind === 'shape' || layer.kind === 'text') return layer.bounds;
  if (layer.kind === 'emoji') return { x: 0.14, y: 0.14, width: 0.72, height: 0.72 };
  if (layer.kind === 'raster') {
    if (layer.runs.length === 0) return DEFAULT_BOUNDS;
    let left = layer.resolution;
    let top = layer.resolution;
    let right = 0;
    let bottom = 0;
    for (const run of layer.runs) {
      left = Math.min(left, run.xStart);
      right = Math.max(right, run.xEnd + 1);
      top = Math.min(top, run.y);
      bottom = Math.max(bottom, run.y + 1);
    }
    return {
      x: left / layer.resolution,
      y: top / layer.resolution,
      width: (right - left) / layer.resolution,
      height: (bottom - top) / layer.resolution,
    };
  }
  if (layer.strokes.length === 0) return DEFAULT_BOUNDS;
  let left = 1;
  let top = 1;
  let right = 0;
  let bottom = 0;
  for (const stroke of layer.strokes) {
    const padding = stroke.width / 2;
    for (const point of stroke.points) {
      left = Math.min(left, point.x - padding);
      top = Math.min(top, point.y - padding);
      right = Math.max(right, point.x + padding);
      bottom = Math.max(bottom, point.y + padding);
    }
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function transformLayerPoint(transform: Transform, point: WorldPoint): WorldPoint {
  const matrix = createLayerMatrix(transform, 1);
  const x = point.x - 0.5;
  const y = point.y - 0.5;
  return {
    x: matrix.a * x + matrix.c * y + matrix.e,
    y: matrix.b * x + matrix.d * y + matrix.f,
  };
}

export function layerWorldCorners(layer: SceneLayer): readonly WorldPoint[] {
  const { x, y, width, height } = layerLocalBounds(layer);
  return [
    transformLayerPoint(layer.transform, { x, y }),
    transformLayerPoint(layer.transform, { x: x + width, y }),
    transformLayerPoint(layer.transform, { x: x + width, y: y + height }),
    transformLayerPoint(layer.transform, { x, y: y + height }),
  ];
}

export function layerWorldBounds(layer: SceneLayer): WorldBounds {
  const corners = layerWorldCorners(layer);
  return {
    left: Math.min(...corners.map((point) => point.x)),
    top: Math.min(...corners.map((point) => point.y)),
    right: Math.max(...corners.map((point) => point.x)),
    bottom: Math.max(...corners.map((point) => point.y)),
  };
}

export function unionWorldBounds(layers: readonly SceneLayer[]): WorldBounds | null {
  if (layers.length === 0) return null;
  const bounds = layers.map(layerWorldBounds);
  return {
    left: Math.min(...bounds.map((item) => item.left)),
    top: Math.min(...bounds.map((item) => item.top)),
    right: Math.max(...bounds.map((item) => item.right)),
    bottom: Math.max(...bounds.map((item) => item.bottom)),
  };
}

export const boundsContainPoint = (bounds: WorldBounds, point: WorldPoint): boolean =>
  point.x >= bounds.left && point.x <= bounds.right
  && point.y >= bounds.top && point.y <= bounds.bottom;

export const boundsIntersect = (a: WorldBounds, b: WorldBounds): boolean =>
  a.left <= b.right && a.right >= b.left && a.top <= b.bottom && a.bottom >= b.top;

export function hitTestLayers(layers: readonly SceneLayer[], point: WorldPoint): SceneLayer | undefined {
  return [...layers].reverse().find(
    (layer) => layer.visible && boundsContainPoint(layerWorldBounds(layer), point),
  );
}
