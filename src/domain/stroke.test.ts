import { describe, expect, it } from 'vitest';
import { applyPressureCurve, simplifyStrokePoints, stabilizeStrokePoint } from './stroke';

describe('stroke processing', () => {
  it('maps soft and firm pressure around the linear curve', () => {
    expect(applyPressureCurve(0.25, 'soft')).toBe(0.5);
    expect(applyPressureCurve(0.25, 'linear')).toBe(0.25);
    expect(applyPressureCurve(0.5, 'firm')).toBe(0.25);
  });

  it('stabilizes position and pressure without leaving normalized space', () => {
    const stabilized = stabilizeStrokePoint(
      { x: 0.2, y: 0.4, pressure: 0.4 },
      { x: 0.6, y: 0.8, pressure: 0.8 },
      0.75,
    );
    expect(stabilized.x).toBeCloseTo(0.3);
    expect(stabilized.y).toBe(0.5);
    expect(stabilized.pressure).toBe(0.5);
  });

  it('simplifies straight samples while retaining corners and pressure changes', () => {
    const points = [
      { x: 0, y: 0, pressure: 0.5 },
      { x: 0.25, y: 0, pressure: 0.5 },
      { x: 0.5, y: 0, pressure: 0.9 },
      { x: 0.5, y: 0.5, pressure: 0.5 },
      { x: 0.5, y: 1, pressure: 0.5 },
    ];
    const simplified = simplifyStrokePoints(points, 0.001);
    expect(simplified).toContain(points[2]);
    expect(simplified).toContain(points[3]);

    const straight = Array.from({ length: 9 }, (_, index) => ({
      x: index / 8,
      y: 0.5,
      pressure: 0.5,
    }));
    expect(simplifyStrokePoints(straight, 0.001)).toEqual([straight[0], straight[8]]);
  });
});
