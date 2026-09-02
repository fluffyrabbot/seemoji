import { describe, expect, it } from 'vitest';
import type { ProductEvent, ProductEventTracker } from '../ports/productEvents';
import { AssetDelivery } from './assetDelivery';

class EventTracker implements ProductEventTracker {
  readonly events: ProductEvent[] = [];

  capture(event: Exclude<ProductEvent, { readonly name: 'experiment_exposed' }>): void {
    this.events.push(event);
  }
}

describe('AssetDelivery', () => {
  it('reports clipboard success only after the port succeeds', async () => {
    const events = new EventTracker();
    const delivery = new AssetDelivery({
      clipboard: { writePng: async () => ({ kind: 'copied' }) },
      fileExport: { download: () => undefined },
      events,
    });
    await expect(delivery.copyPng(new Blob())).resolves.toEqual({ kind: 'copied' });
    expect(events.events).toEqual([{
      name: 'asset_delivery_succeeded',
      properties: { method: 'clipboard' },
    }]);
  });

  it('preserves clipboard failure taxonomy in a content-free event', async () => {
    const events = new EventTracker();
    const delivery = new AssetDelivery({
      clipboard: { writePng: async () => ({ kind: 'denied', cause: new Error('private') }) },
      fileExport: { download: () => undefined },
      events,
    });
    await delivery.copyPng(new Blob());
    expect(events.events).toEqual([{
      name: 'asset_delivery_failed',
      properties: { method: 'clipboard', reason: 'denied' },
    }]);
  });

  it('normalizes an unexpected clipboard rejection', async () => {
    const events = new EventTracker();
    const failure = new Error('clipboard crashed');
    const delivery = new AssetDelivery({
      clipboard: { writePng: async () => { throw failure; } },
      fileExport: { download: () => undefined },
      events,
    });
    await expect(delivery.copyPng(new Blob())).resolves.toEqual({
      kind: 'failed',
      cause: failure,
    });
    expect(events.events).toEqual([{
      name: 'asset_delivery_failed',
      properties: { method: 'clipboard', reason: 'failed' },
    }]);
  });

  it('names browser download honestly as started', () => {
    const events = new EventTracker();
    const delivery = new AssetDelivery({
      clipboard: { writePng: async () => ({ kind: 'unsupported' }) },
      fileExport: { download: () => undefined },
      events,
    });
    delivery.downloadPng(new Blob(), 'seemoji.png');
    expect(events.events).toEqual([{
      name: 'asset_delivery_started',
      properties: { method: 'download' },
    }]);
  });

  it('never lets event collection break asset delivery', async () => {
    const delivery = new AssetDelivery({
      clipboard: { writePng: async () => ({ kind: 'copied' }) },
      fileExport: { download: () => undefined },
      events: { capture: () => { throw new Error('collector unavailable'); } },
    });
    await expect(delivery.copyPng(new Blob())).resolves.toEqual({ kind: 'copied' });
    expect(() => delivery.downloadPng(new Blob(), 'seemoji.png')).not.toThrow();
  });

  it('reports and preserves a synchronous download failure', () => {
    const events = new EventTracker();
    const failure = new Error('download failed');
    const delivery = new AssetDelivery({
      clipboard: { writePng: async () => ({ kind: 'unsupported' }) },
      fileExport: { download: () => { throw failure; } },
      events,
    });
    expect(() => delivery.downloadPng(new Blob(), 'seemoji.png')).toThrow(failure);
    expect(events.events).toEqual([{
      name: 'asset_delivery_failed',
      properties: { method: 'download', reason: 'failed' },
    }]);
  });
});
