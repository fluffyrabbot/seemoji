export interface StorageHealth {
  readonly durability: 'persistent' | 'best-effort' | 'unavailable';
  readonly usageBytes: number | null;
  readonly quotaBytes: number | null;
}

export interface StorageHealthPort {
  inspect(): Promise<StorageHealth>;
  requestPersistence(): Promise<StorageHealth>;
}
