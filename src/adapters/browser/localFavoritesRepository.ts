import { migrateLegacyEditParams } from '../../domain/designCodec';
import { decodeFavorite, type Favorite } from '../../domain/favorite';
import type { FavoritesRepository } from '../../ports/favoritesRepository';

const STORAGE_KEY = 'seemoji:favorites:v2';
const LEGACY_STORAGE_KEY = 'seemoji:favorites:v1';

export class FavoritesRepositoryError extends Error {
  readonly kind: 'unavailable' | 'corrupt' | 'write-failed';

  constructor(
    message: string,
    kind: 'unavailable' | 'corrupt' | 'write-failed',
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'FavoritesRepositoryError';
    this.kind = kind;
  }
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

export class LocalFavoritesRepository implements FavoritesRepository {
  readonly #storage: Storage | null;

  constructor(storage: Storage | null = globalThis.localStorage ?? null) {
    this.#storage = storage;
  }

  async list(): Promise<readonly Favorite[]> {
    if (!this.#storage) {
      throw new FavoritesRepositoryError('Browser storage is unavailable', 'unavailable');
    }
    try {
      const raw = this.#storage.getItem(STORAGE_KEY);
      if (!raw) return this.#migrateLegacy();
      const parsed: unknown = JSON.parse(raw);
      const envelope = asRecord(parsed);
      if (!envelope || envelope.version !== 1 || !Array.isArray(envelope.favorites)) {
        throw new FavoritesRepositoryError('The favorites store has an invalid shape', 'corrupt');
      }
      return envelope.favorites.map((entry, index) => {
        const favorite = decodeFavorite(entry);
        if (!favorite.ok) {
          throw new FavoritesRepositoryError(
            `Favorite ${index + 1} is corrupt: ${favorite.error}`,
            'corrupt',
          );
        }
        return favorite.value;
      });
    } catch (cause) {
      if (cause instanceof FavoritesRepositoryError) throw cause;
      throw new FavoritesRepositoryError('The favorites store could not be read', 'corrupt', {
        cause,
      });
    }
  }

  async save(favorite: Favorite): Promise<readonly Favorite[]> {
    const decoded = decodeFavorite(favorite);
    if (!decoded.ok) {
      throw new FavoritesRepositoryError(decoded.error, 'write-failed');
    }
    const current = await this.list();
    const next = [...current.filter((entry) => entry.id !== favorite.id), decoded.value];
    this.#persist(next);
    return next;
  }

  async remove(id: string): Promise<readonly Favorite[]> {
    const next = (await this.list()).filter((favorite) => favorite.id !== id);
    this.#persist(next);
    return next;
  }

  #persist(favorites: readonly Favorite[]): void {
    if (!this.#storage) {
      throw new FavoritesRepositoryError('Browser storage is unavailable', 'unavailable');
    }
    try {
      this.#storage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, favorites }));
    } catch (cause) {
      throw new FavoritesRepositoryError('Favorites could not be saved', 'write-failed', {
        cause,
      });
    }
  }

  #migrateLegacy(): readonly Favorite[] {
    if (!this.#storage) return [];
    const raw = this.#storage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      throw new FavoritesRepositoryError('The legacy favorites store is corrupt', 'corrupt');
    }

    const migrated = parsed.map((entry, index): Favorite => {
      const legacy = asRecord(entry);
      if (
        !legacy ||
        typeof legacy.id !== 'string' ||
        typeof legacy.name !== 'string' ||
        typeof legacy.emoji !== 'string' ||
        typeof legacy.createdAt !== 'number'
      ) {
        throw new FavoritesRepositoryError(
          `Legacy favorite ${index + 1} is corrupt`,
          'corrupt',
        );
      }
      const design = migrateLegacyEditParams(legacy.emoji, legacy.params);
      if (!design.ok) {
        throw new FavoritesRepositoryError(
          `Legacy favorite ${index + 1} cannot be migrated: ${design.error}`,
          'corrupt',
        );
      }
      return {
        id: legacy.id,
        name: legacy.name,
        design: design.value,
        createdAt: legacy.createdAt,
      };
    });
    this.#persist(migrated);
    return migrated;
  }
}
