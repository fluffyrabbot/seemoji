import type { StorageHealth, StorageHealthPort } from '../../ports/storageHealth';

interface BrowserStorageManager {
  estimate?: () => Promise<{ readonly usage?: number; readonly quota?: number }>;
  persisted?: () => Promise<boolean>;
  persist?: () => Promise<boolean>;
}

const validBytes = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;

export class BrowserStorageHealth implements StorageHealthPort {
  readonly #manager: BrowserStorageManager | null;

  constructor(manager: BrowserStorageManager | null = typeof navigator === 'undefined'
    ? null : navigator.storage) {
    this.#manager = manager;
  }

  async inspect(): Promise<StorageHealth> {
    if (!this.#manager) {
      return { durability: 'unavailable', usageBytes: null, quotaBytes: null };
    }
    const [persisted, rawEstimate] = await Promise.all([
      this.#manager.persisted?.().catch(() => false) ?? Promise.resolve(false),
      this.#manager.estimate?.().catch(() => ({})) ?? Promise.resolve({}),
    ]);
    const estimate = rawEstimate as { readonly usage?: number; readonly quota?: number };
    return {
      durability: persisted ? 'persistent' : 'best-effort',
      usageBytes: validBytes(estimate.usage),
      quotaBytes: validBytes(estimate.quota),
    };
  }

  async requestPersistence(): Promise<StorageHealth> {
    if (!this.#manager?.persist) return this.inspect();
    const granted = await this.#manager.persist().catch(() => false);
    const health = await this.inspect();
    return granted ? { ...health, durability: 'persistent' } : health;
  }
}
