import { DESIGN_LIMITS, type SceneLayer, type Transform } from './design';
import { unionWorldBounds, type WorldPoint } from './sceneGeometry';

export interface LayerTransformUpdate {
  readonly layerId: string;
  readonly transform: Transform;
}

const DEG = Math.PI / 180;
const TURN = Math.PI * 2;
const EPSILON = 1e-12;
const clamp = (value: number, limits: readonly [number, number]): number =>
  Math.min(limits[1], Math.max(limits[0], value));
const requireFinite = (...values: readonly number[]) => {
  if (!values.every(Number.isFinite)) throw new RangeError('transform inputs must be finite');
};

export const wrapRotation = (degrees: number): number => {
  const wrapped = ((degrees + 180) % 360 + 360) % 360 - 180;
  return wrapped === -180 && degrees > 0 ? 180 : wrapped;
};

export const layerSize = (transform: Transform): number => Math.sqrt(transform.scaleX * transform.scaleY);

export function selectionSize(layers: readonly SceneLayer[]): number {
  return layers.length === 0 ? 1
    : Math.exp(layers.reduce((sum, layer) => sum + Math.log(layerSize(layer.transform)), 0) / layers.length);
}

/** Bounds center in the same center-relative coordinates as Transform.x/y. */
export function selectionCenter(layers: readonly SceneLayer[]): WorldPoint {
  const bounds = unionWorldBounds(layers);
  return bounds ? { x: (bounds.left + bounds.right) / 2 - 0.5, y: (bounds.top + bounds.bottom) / 2 - 0.5 }
    : { x: 0, y: 0 };
}

/** Single objects use their transform origin; groups share the bounds center. */
export function selectionPivot(layers: readonly SceneLayer[]): WorldPoint {
  return layers.length === 1 ? { x: layers[0]!.transform.x, y: layers[0]!.transform.y } : selectionCenter(layers);
}

/** One translation interval per axis keeps every object's spacing unchanged at a limit. */
export function translateSelection(layers: readonly SceneLayer[], delta: WorldPoint): readonly LayerTransformUpdate[] {
  requireFinite(delta.x, delta.y);
  if (layers.length === 0) return [];
  const constrained = (axis: 'x' | 'y') => clamp(delta[axis], [
    Math.max(...layers.map(({ transform }) => DESIGN_LIMITS[axis][0] - transform[axis])),
    Math.min(...layers.map(({ transform }) => DESIGN_LIMITS[axis][1] - transform[axis])),
  ]);
  const x = constrained('x');
  const y = constrained('y');
  return layers.map(({ id, transform }) => ({ layerId: id, transform: {
    ...transform,
    // Only floating-point roundoff can exceed a limit after the common clamp.
    x: clamp(transform.x + x, DESIGN_LIMITS.x),
    y: clamp(transform.y + y, DESIGN_LIMITS.y),
  } }));
}

export function moveSelection(layers: readonly SceneLayer[], axis: 'x' | 'y', target: number): readonly LayerTransformUpdate[] {
  const center = selectionPivot(layers);
  return translateSelection(layers, { x: 0, y: 0, [axis]: target - center[axis] });
}

/** Uniform world-space scaling preserves group geometry, including mirror and skew. */
export function scaleSelectionBy(layers: readonly SceneLayer[], requestedRatio: number): readonly LayerTransformUpdate[] {
  requireFinite(requestedRatio);
  if (layers.length === 0) return [];
  const pivot = selectionPivot(layers);
  let minimum = 0;
  let maximum = Infinity;
  for (const { transform } of layers) {
    for (const scale of [transform.scaleX, transform.scaleY]) {
      minimum = Math.max(minimum, DESIGN_LIMITS.scaleX[0] / scale);
      maximum = Math.min(maximum, DESIGN_LIMITS.scaleX[1] / scale);
    }
    for (const axis of ['x', 'y'] as const) {
      const offset = transform[axis] - pivot[axis];
      if (offset === 0) continue;
      const a = (DESIGN_LIMITS[axis][0] - pivot[axis]) / offset;
      const b = (DESIGN_LIMITS[axis][1] - pivot[axis]) / offset;
      minimum = Math.max(minimum, Math.min(a, b));
      maximum = Math.min(maximum, Math.max(a, b));
    }
  }
  const ratio = clamp(requestedRatio, [minimum, maximum]);
  return layers.map(({ id, transform }) => ({ layerId: id, transform: {
    ...transform,
    x: clamp(pivot.x + (transform.x - pivot.x) * ratio, DESIGN_LIMITS.x),
    y: clamp(pivot.y + (transform.y - pivot.y) * ratio, DESIGN_LIMITS.y),
    scaleX: clamp(transform.scaleX * ratio, DESIGN_LIMITS.scaleX),
    scaleY: clamp(transform.scaleY * ratio, DESIGN_LIMITS.scaleY),
  } }));
}

export function scaleSelection(layers: readonly SceneLayer[], requestedSize: number): readonly LayerTransformUpdate[] {
  return scaleSelectionBy(layers, requestedSize / selectionSize(layers));
}

/** Independent local axes are meaningful for one object; groups always scale uniformly. */
export function scaleLayerAxes(layer: SceneLayer, ratios: WorldPoint): readonly LayerTransformUpdate[] {
  requireFinite(ratios.x, ratios.y);
  return [{ layerId: layer.id, transform: { ...layer.transform,
    scaleX: clamp(layer.transform.scaleX * ratios.x, DESIGN_LIMITS.scaleX),
    scaleY: clamp(layer.transform.scaleY * ratios.y, DESIGN_LIMITS.scaleY),
  } }];
}

/** First outward crossing of A cos(t) + B sin(t) = limit over one positive turn. */
function boundaryExit(a: number, b: number, limit: number, upper: boolean): number {
  const radius = Math.hypot(a, b);
  if (radius === 0 || Math.abs(limit) > radius + EPSILON) return Infinity;
  const phase = Math.atan2(b, a);
  const arc = Math.acos(clamp(limit / radius, [-1, 1]));
  let exit = Infinity;
  for (const root of [phase - arc, phase + arc]) {
    let angle = ((root % TURN) + TURN) % TURN;
    if (angle < EPSILON || TURN - angle < EPSILON) angle = 0;
    const derivative = -a * Math.sin(angle) + b * Math.cos(angle);
    const secondDerivative = -a * Math.cos(angle) - b * Math.sin(angle);
    const outward = upper ? derivative > EPSILON : derivative < -EPSILON;
    // Starting at a tangent on the wrong side leaves the interval immediately.
    const tangentExit = angle === 0 && Math.abs(derivative) <= EPSILON
      && (upper ? secondDerivative > EPSILON : secondDerivative < -EPSILON);
    if (outward || tangentExit) exit = Math.min(exit, angle);
  }
  return exit;
}

/**
 * Rotate along the continuous feasible arc from the starting selection. Analytic
 * boundary crossings also catch excursions whose endpoint is back inside bounds;
 * feasibility is not monotone in angle, so endpoint tests/binary search are unsound.
 */
export function rotateSelection(layers: readonly SceneLayer[], degrees: number): readonly LayerTransformUpdate[] {
  requireFinite(degrees);
  if (layers.length === 0) return [];
  const pivot = selectionPivot(layers);
  const direction = Math.sign(degrees);
  let radians = Math.abs(degrees) * DEG;
  for (const { transform } of layers) {
    const x = transform.x - pivot.x;
    const y = transform.y - pivot.y;
    const coordinates = [
      { axis: 'x' as const, a: x, b: -direction * y },
      { axis: 'y' as const, a: y, b: direction * x },
    ];
    for (const { axis, a, b } of coordinates) {
      radians = Math.min(radians,
        boundaryExit(a, b, DESIGN_LIMITS[axis][0] - pivot[axis], false),
        boundaryExit(a, b, DESIGN_LIMITS[axis][1] - pivot[axis], true));
    }
  }
  const angle = radians * direction;
  const appliedDegrees = angle / DEG;
  return layers.map(({ id, transform }) => {
    const x = transform.x - pivot.x;
    const y = transform.y - pivot.y;
    const mirrorDirection = transform.flipH !== transform.flipV ? -1 : 1;
    return { layerId: id, transform: { ...transform,
      x: clamp(pivot.x + x * Math.cos(angle) - y * Math.sin(angle), DESIGN_LIMITS.x),
      y: clamp(pivot.y + x * Math.sin(angle) + y * Math.cos(angle), DESIGN_LIMITS.y),
      rotate: wrapRotation(transform.rotate + appliedDegrees * mirrorDirection),
    } };
  });
}
