import { describe, expect, it } from 'vitest';
import { createFloodFillRuns } from './floodFill';

const pixels = (...values: readonly number[]) => new Uint8ClampedArray(values);

describe('flood fill', () => {
  it('fills only the connected matching region and emits scan-line runs', () => {
    const data = pixels(
      0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255, 255,
      0, 0, 0, 255, 255, 255, 255, 255, 255, 255, 255, 255,
    );
    expect(createFloodFillRuns({ pixels: data, width: 3, height: 2, seedX: 0, seedY: 0,
      tolerance: 0, color: '#ff00aa' })).toEqual([
      { y: 0, xStart: 0, xEnd: 1, color: '#ff00aa' },
      { y: 1, xStart: 0, xEnd: 0, color: '#ff00aa' },
    ]);
  });

  it('honors tolerance and hard storage bounds', () => {
    const data = pixels(10, 10, 10, 255, 20, 20, 20, 255, 200, 200, 200, 255);
    const runs = createFloodFillRuns({ pixels: data, width: 3, height: 1, seedX: 0, seedY: 0,
      tolerance: 15, color: '#000000', maximumPixels: 2, maximumRuns: 1 });
    expect(runs).toEqual([{ y: 0, xStart: 0, xEnd: 1, color: '#000000' }]);
  });
});
