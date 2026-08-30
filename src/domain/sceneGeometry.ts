import type { LayerBounds, SceneLayer } from './design';
import {
  createEmojiRenderPlan,
  createLayerMatrix,
  toTopLeftOrigin,
  type AffineMatrix,
} from './renderPlan';

export interface WorldBounds {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export interface WorldPoint { readonly x: number; readonly y: number }

const DEFAULT_BOUNDS: LayerBounds = { x: 0.25, y: 0.25, width: 0.5, height: 0.5 };
const EMOJI_GEOMETRY_PLAN_SIZE = 1024;

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

export function transformPoint(matrix: AffineMatrix, point: WorldPoint): WorldPoint {
  return {
    x: matrix.a * point.x + matrix.c * point.y + matrix.e,
    y: matrix.b * point.x + matrix.d * point.y + matrix.f,
  };
}

export function invertMatrix(matrix: AffineMatrix): AffineMatrix | null {
  const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
  const determinantScale = Math.max(
    1,
    Math.abs(matrix.a * matrix.d),
    Math.abs(matrix.b * matrix.c),
  );
  if (!Number.isFinite(determinant) || Math.abs(determinant) <= determinantScale * 1e-12) {
    return null;
  }
  const a = matrix.d / determinant;
  const b = -matrix.b / determinant;
  const c = -matrix.c / determinant;
  const d = matrix.a / determinant;
  return {
    a,
    b,
    c,
    d,
    e: -(a * matrix.e + c * matrix.f),
    f: -(b * matrix.e + d * matrix.f),
  };
}

/** Maps normalized layer-local points directly into normalized canvas/world points. */
export function layerLocalToWorldMatrix(layer: SceneLayer): AffineMatrix {
  let centered: AffineMatrix;
  if (layer.kind === 'emoji') {
    const matrix = createEmojiRenderPlan(layer, EMOJI_GEOMETRY_PLAN_SIZE).matrix;
    centered = {
      ...matrix,
      e: matrix.e / EMOJI_GEOMETRY_PLAN_SIZE,
      f: matrix.f / EMOJI_GEOMETRY_PLAN_SIZE,
    };
  } else {
    centered = createLayerMatrix(layer.transform, 1);
  }
  return toTopLeftOrigin(centered, 1);
}

export function layerLocalPointToWorld(layer: SceneLayer, point: WorldPoint): WorldPoint {
  return transformPoint(layerLocalToWorldMatrix(layer), point);
}

/** Returns null when the layer's affine transform collapses onto a line. */
export function worldPointToLayerLocal(layer: SceneLayer, point: WorldPoint): WorldPoint | null {
  const inverse = invertMatrix(layerLocalToWorldMatrix(layer));
  return inverse ? transformPoint(inverse, point) : null;
}

export function layerWorldCorners(layer: SceneLayer): readonly WorldPoint[] {
  const { x, y, width, height } = layerLocalBounds(layer);
  return [
    layerLocalPointToWorld(layer, { x, y }),
    layerLocalPointToWorld(layer, { x: x + width, y }),
    layerLocalPointToWorld(layer, { x: x + width, y: y + height }),
    layerLocalPointToWorld(layer, { x, y: y + height }),
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
