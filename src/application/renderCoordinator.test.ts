import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_DESIGN, DEFAULT_EMOJI_LAYER, DEFAULT_TRANSFORM, type StrokeLayer } from '../domain/design';
import { RenderCoordinator } from './renderCoordinator';
import { layerRenderKey } from './renderIdentity';
import { LatestTask } from './latestTask';
import { WeightedCache } from './weightedCache';
import type { RenderedFrame, RendererPort } from '../ports/renderer';

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const tick = async () => { await Promise.resolve(); await Promise.resolve(); };

describe('render scheduling and resource ownership', () => {
  it('coalesces waiting inputs and never publishes an obsolete result or error', async () => {
    const tasks = [deferred<number>(), deferred<number>()];
    const run = vi.fn(() => tasks.shift()!.promise);
    const first = tasks[0]!, last = tasks[1]!;
    const queue = new LatestTask<number, number>(run);
    const success = vi.fn(), failure = vi.fn();
    queue.request(1, success, failure);
    queue.request(2, success, failure);
    queue.request(3, success, failure);
    first.reject(new Error('obsolete'));
    await tick();
    expect(run.mock.calls).toEqual([[1], [3]]);
    expect(failure).not.toHaveBeenCalled();
    last.resolve(3); await tick();
    expect(success.mock.calls).toEqual([[3]]);
  });
  it('cancellation prevents late publication and allows a new session', async () => {
    const task = deferred<number>();
    const queue = new LatestTask<number, number>(() => task.promise);
    const success = vi.fn();
    queue.request(1, success, vi.fn()); queue.cancel();
    task.resolve(1); await tick();
    expect(success).not.toHaveBeenCalled();
    queue.request(2, success, vi.fn()); await tick();
    expect(success).toHaveBeenCalledOnce();
  });
  it('evicts by resource weight and recency, including oversized entries', () => {
    const cache = new WeightedCache<string, number>(8);
    cache.set('a', 1, 4); cache.set('b', 2, 4); cache.get('a'); cache.set('c', 3, 4);
    expect(cache.get('b')).toBeUndefined(); expect(cache.get('a')).toBe(1);
    cache.set('large', 4, 9); expect(cache.get('large')).toBeUndefined();
    cache.set('a', 5, 8); expect(cache.get('c')).toBeUndefined();
  });
  it('reuses paint identity for transform-only edits without serializing stroke points', () => {
    const points = [{ x: 0.2, y: 0.2, pressure: 0.5 }];
    const layer: StrokeLayer = { id: 'paint', name: 'Paint', kind: 'strokes', visible: true, opacity: 1,
      transform: DEFAULT_TRANSFORM, mask: [], strokes: [{ id: 's', points, color: '#000000', opacity: 1, width: 0.01 }] };
    const key = layerRenderKey(layer, 512);
    expect(layerRenderKey({ ...layer, name: 'Renamed', opacity: 0.2, transform: { ...DEFAULT_TRANSFORM, x: 0.2 } }, 512)).toBe(key);
    expect(layerRenderKey({ ...layer, strokes: [...layer.strokes, layer.strokes[0]!] }, 512)).not.toBe(key);
    expect(key).not.toContain('pressure');
  });
  it('does not acquire hidden artwork; caches current renders and retries failures', async () => {
    const frame: RenderedFrame = { canvas: document.createElement('canvas'), warnings: [] };
    const port: RendererPort = { render: vi.fn(() => frame), toPng: vi.fn(async () => new Blob(['png'])) };
    const load = vi.fn(async () => document.createElement('canvas'));
    const coordinator = new RenderCoordinator({ load }, port);
    const hidden = { ...DEFAULT_DESIGN, layers: [{ ...DEFAULT_EMOJI_LAYER, visible: false }] };
    await coordinator.png(hidden, 128);
    expect(load).not.toHaveBeenCalled();
    await coordinator.render(DEFAULT_DESIGN, 128); await coordinator.render(DEFAULT_DESIGN, 128);
    expect(load).toHaveBeenCalledOnce();
    const failedLoad = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(frame.canvas);
    const retrying = new RenderCoordinator({ load: failedLoad }, port);
    await expect(retrying.render(DEFAULT_DESIGN, 128)).rejects.toThrow('offline');
    await expect(retrying.render(DEFAULT_DESIGN, 128)).resolves.toBe(frame);
  });
});
