import { describe, expect, it, vi } from 'vitest';
import { BrowserStorageHealth } from './browserStorageHealth';

describe('BrowserStorageHealth', () => {
  it('reports persistent storage usage and quota', async () => {
    const health = new BrowserStorageHealth({
      persisted: async () => true,
      estimate: async () => ({ usage: 1_024, quota: 8_192 }),
    });
    await expect(health.inspect()).resolves.toEqual({
      durability: 'persistent',
      usageBytes: 1_024,
      quotaBytes: 8_192,
    });
  });

  it('reports denied persistence without hiding usable best-effort storage', async () => {
    const persist = vi.fn(async () => false);
    const health = new BrowserStorageHealth({
      persisted: async () => false,
      persist,
      estimate: async () => ({ usage: 512, quota: 4_096 }),
    });
    await expect(health.requestPersistence()).resolves.toEqual({
      durability: 'best-effort',
      usageBytes: 512,
      quotaBytes: 4_096,
    });
    expect(persist).toHaveBeenCalledOnce();
  });

  it('degrades safely when the storage manager is unavailable or throws', async () => {
    await expect(new BrowserStorageHealth(null).inspect()).resolves.toEqual({
      durability: 'unavailable',
      usageBytes: null,
      quotaBytes: null,
    });
    await expect(new BrowserStorageHealth({
      persisted: async () => { throw new DOMException('denied'); },
      estimate: async () => { throw new DOMException('denied'); },
    }).inspect()).resolves.toEqual({
      durability: 'best-effort',
      usageBytes: null,
      quotaBytes: null,
    });
  });
});
