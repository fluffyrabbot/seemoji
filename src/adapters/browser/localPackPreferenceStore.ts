import { decodePackPreference } from '../../domain/packCodec';
import type { PackSnapshot } from '../../domain/pack';
import type { PackPreferenceStore } from '../../ports/packPreference';

export const PACK_PREFERENCE_KEY = 'seemoji:pack-preference:v1';

export class LocalPackPreferenceStore implements PackPreferenceStore {
  readonly #storage: Storage | null;

  constructor(storage?: Storage | null) {
    if (storage !== undefined) {
      this.#storage = storage;
      return;
    }
    try {
      this.#storage = globalThis.localStorage ?? null;
    } catch {
      this.#storage = null;
    }
  }

  async read(): Promise<PackSnapshot | null> {
    try {
      const encoded = this.#storage?.getItem(PACK_PREFERENCE_KEY);
      if (!encoded) return null;
      const decoded = decodePackPreference(JSON.parse(encoded));
      return decoded.ok ? decoded.value : null;
    } catch {
      return null;
    }
  }

  async write(preference: PackSnapshot): Promise<void> {
    if (!this.#storage) return;
    const envelope = {
      version: 1,
      pack: preference.pack,
      packVersion: preference.packVersion,
      ...(preference.style === undefined ? {} : { style: preference.style }),
    };
    try {
      this.#storage.setItem(PACK_PREFERENCE_KEY, JSON.stringify(envelope));
    } catch {
      // Session selection remains usable when device preferences are unavailable.
    }
  }
}
