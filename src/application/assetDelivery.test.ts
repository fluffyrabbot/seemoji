import { describe, expect, it, vi } from 'vitest';
import { AssetDelivery } from './assetDelivery';

describe('asset delivery', () => {
  it.each(['copied', 'denied', 'unsupported', 'failed'] as const)('preserves %s clipboard outcomes without downloading', async (kind) => {
    const outcome = { kind, cause: new Error('browser failure') };
    const download = vi.fn();
    const delivery = new AssetDelivery({ clipboard: { writePng: async () => outcome }, fileExport: { download } });
    await expect(delivery.copyPng(new Blob())).resolves.toBe(outcome);
    expect(download).not.toHaveBeenCalled();
  });
  it('normalizes unexpected clipboard rejection and preserves download failures', async () => {
    const failure = new Error('failed');
    const delivery = new AssetDelivery({ clipboard: { writePng: async () => { throw failure; } },
      fileExport: { download: () => { throw failure; } } });
    await expect(delivery.copyPng(new Blob())).resolves.toEqual({ kind: 'failed', cause: failure });
    expect(() => delivery.downloadPng(new Blob(), 'image.png')).toThrow(failure);
  });
});
