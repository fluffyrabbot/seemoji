import type { RasterRun } from './design';

export interface FloodFillInput {
  readonly pixels: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
  readonly seedX: number;
  readonly seedY: number;
  readonly tolerance: number;
  readonly color: string;
  readonly maximumPixels?: number;
  readonly maximumRuns?: number;
}

/** Connected, tolerance-aware fill encoded as bounded scan-line runs. */
export function createFloodFillRuns(input: FloodFillInput): readonly RasterRun[] {
  const { width, height, pixels, color } = input;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1
    || pixels.length !== width * height * 4) return [];
  const seedX = Math.max(0, Math.min(width - 1, Math.floor(input.seedX)));
  const seedY = Math.max(0, Math.min(height - 1, Math.floor(input.seedY)));
  const seedOffset = (seedY * width + seedX) * 4;
  const target = pixels.slice(seedOffset, seedOffset + 4);
  const tolerance = Math.max(0, Math.min(255, input.tolerance));
  const maximumPixels = input.maximumPixels ?? 65_536;
  const maximumRuns = input.maximumRuns ?? 65_536;
  const visited = new Uint8Array(width * height);
  const filled = new Uint8Array(width * height);
  const queue = new Int32Array(Math.min(width * height, maximumPixels));
  let head = 0;
  let tail = 1;
  queue[0] = seedY * width + seedX;
  visited[queue[0]!] = 1;

  const matches = (pixel: number) => {
    const offset = pixel * 4;
    return Math.max(
      Math.abs((pixels[offset] ?? 0) - (target[0] ?? 0)),
      Math.abs((pixels[offset + 1] ?? 0) - (target[1] ?? 0)),
      Math.abs((pixels[offset + 2] ?? 0) - (target[2] ?? 0)),
      Math.abs((pixels[offset + 3] ?? 0) - (target[3] ?? 0)),
    ) <= tolerance;
  };

  while (head < tail && head < maximumPixels) {
    const pixel = queue[head++]!;
    if (!matches(pixel)) continue;
    filled[pixel] = 1;
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    const neighbors = [x > 0 ? pixel - 1 : -1, x + 1 < width ? pixel + 1 : -1,
      y > 0 ? pixel - width : -1, y + 1 < height ? pixel + width : -1];
    for (const neighbor of neighbors) {
      if (neighbor >= 0 && !visited[neighbor] && tail < queue.length) {
        visited[neighbor] = 1;
        queue[tail++] = neighbor;
      }
    }
  }

  const runs: RasterRun[] = [];
  for (let y = 0; y < height && runs.length < maximumRuns; y += 1) {
    let x = 0;
    while (x < width && runs.length < maximumRuns) {
      while (x < width && !filled[y * width + x]) x += 1;
      if (x >= width) break;
      const xStart = x;
      while (x + 1 < width && filled[y * width + x + 1]) x += 1;
      runs.push({ y, xStart, xEnd: x, color });
      x += 1;
    }
  }
  return runs;
}
