import type { StrokePoint } from './design';

export type PressureCurve = 'soft' | 'linear' | 'firm';

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

export function applyPressureCurve(pressure: number, curve: PressureCurve): number {
  const normalized = clamp01(pressure);
  if (curve === 'soft') return Math.sqrt(normalized);
  if (curve === 'firm') return normalized * normalized;
  return normalized;
}

export function stabilizeStrokePoint(
  previous: StrokePoint,
  current: StrokePoint,
  amount: number,
): StrokePoint {
  const retained = clamp01(amount);
  const incoming = 1 - retained;
  return {
    x: previous.x * retained + current.x * incoming,
    y: previous.y * retained + current.y * incoming,
    pressure: previous.pressure * retained + current.pressure * incoming,
  };
}

const segmentDistanceSquared = (
  point: StrokePoint,
  start: StrokePoint,
  end: StrokePoint,
): number => {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  const ratio = lengthSquared === 0
    ? 0
    : Math.min(1, Math.max(0, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  const nearestX = start.x + dx * ratio;
  const nearestY = start.y + dy * ratio;
  const nearestPressure = start.pressure + (end.pressure - start.pressure) * ratio;
  const pressureDistance = (point.pressure - nearestPressure) * 0.025;
  return (
    (point.x - nearestX) ** 2
    + (point.y - nearestY) ** 2
    + pressureDistance ** 2
  );
};

/** Iterative Ramer-Douglas-Peucker simplification with pressure retained as geometry. */
export function simplifyStrokePoints(
  points: readonly StrokePoint[],
  tolerance = 0.0015,
): readonly StrokePoint[] {
  if (points.length <= 2) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const pending: Array<readonly [number, number]> = [[0, points.length - 1]];
  const threshold = tolerance * tolerance;

  while (pending.length > 0) {
    const [startIndex, endIndex] = pending.pop()!;
    const start = points[startIndex];
    const end = points[endIndex];
    if (!start || !end) continue;
    let farthestIndex = -1;
    let farthestDistance = threshold;
    for (let index = startIndex + 1; index < endIndex; index += 1) {
      const point = points[index];
      if (!point) continue;
      const distance = segmentDistanceSquared(point, start, end);
      if (distance > farthestDistance) {
        farthestDistance = distance;
        farthestIndex = index;
      }
    }
    if (farthestIndex < 0) continue;
    keep[farthestIndex] = 1;
    pending.push([startIndex, farthestIndex], [farthestIndex, endIndex]);
  }

  return points.filter((_, index) => keep[index] === 1);
}
