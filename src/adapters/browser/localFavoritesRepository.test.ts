import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_DESIGN,
  getEmojiLayer,
  updateEmojiLayer,
  type StrokeLayer,
} from '../../domain/design';
import type { Favorite } from '../../domain/favorite';
import { LocalFavoritesRepository } from './localFavoritesRepository';

const PAINT_LAYER: StrokeLayer = {
  id: 'paint-1',
  kind: 'strokes',
  name: 'Paint',
  visible: true,
  opacity: 1,
  transform: DEFAULT_DESIGN.layers[0]!.transform,
  strokes: [{
    id: 'stroke-1',
    points: [{ x: 0.5, y: 0.5, pressure: 0.5 }],
    width: 0.03,
    color: '#ff00aa',
    opacity: 1,
  }],
  mask: [],
};

const TILTED_DESIGN = updateEmojiLayer(DEFAULT_DESIGN, (layer) => ({
  ...layer,
  transform: { ...layer.transform, rotate: 15 },
}));

const favorite = (overrides: Partial<Favorite> = {}): Favorite => ({
  id: crypto.randomUUID(),
  name: 'tilty',
  design: {
    ...TILTED_DESIGN,
    layers: [...TILTED_DESIGN.layers, PAINT_LAYER],
  },
  createdAt: Date.now(),
  ...overrides,
});

class MemoryStorage implements Storage {
  readonly #values = new Map<string, string>();

  get length() {
    return this.#values.size;
  }

  clear() {
    this.#values.clear();
  }

  getItem(key: string) {
    return this.#values.get(key) ?? null;
  }

  key(index: number) {
    return [...this.#values.keys()][index] ?? null;
  }

  removeItem(key: string) {
    this.#values.delete(key);
  }

  setItem(key: string, value: string) {
    this.#values.set(key, value);
  }
}

describe('local favorites repository', () => {
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage();
  });

  it('round-trips validated scene favorites', async () => {
    const repository = new LocalFavoritesRepository(storage);
    const saved = favorite();
    await repository.save(saved);
    expect(await repository.list()).toEqual([saved]);
    expect(storage.getItem('seemoji:favorites:v2')).not.toContain('thumbnail');
  });

  it('reports corruption instead of pretending the collection is empty', async () => {
    storage.setItem('seemoji:favorites:v2', JSON.stringify({ version: 1, favorites: [{}] }));
    const repository = new LocalFavoritesRepository(storage);
    await expect(repository.list()).rejects.toMatchObject({
      kind: 'corrupt',
    });
  });

  it('promotes saved V1 recipes to V2 scenes in place', async () => {
    const layer = getEmojiLayer(DEFAULT_DESIGN);
    const { x: _x, y: _y, ...transform } = layer.transform;
    storage.setItem('seemoji:favorites:v2', JSON.stringify({
      version: 1,
      favorites: [{
        id: 'v1-favorite',
        name: 'old recipe',
        createdAt: 12,
        design: {
          version: 1,
          source: layer.source,
          transform,
          appearance: layer.appearance,
        },
      }],
    }));

    const repository = new LocalFavoritesRepository(storage);
    const [promoted] = await repository.list();
    expect(promoted?.design.version).toBe(2);
    expect(JSON.parse(storage.getItem('seemoji:favorites:v2')!).favorites[0].design.version)
      .toBe(2);
  });

  it('migrates the prototype storage envelope once', async () => {
    storage.setItem(
      'seemoji:favorites:v1',
      JSON.stringify([
        {
          id: 'legacy-1',
          name: 'legacy',
          emoji: '😀',
          createdAt: 42,
          params: {
            v: 1,
            rotate: 10,
            scaleX: 1,
            scaleY: 1,
            skewX: 0,
            skewY: 0,
            flipH: false,
            flipV: false,
            hue: 0,
            saturate: 100,
            brightness: 100,
            blur: 0,
            outline: null,
          },
        },
      ]),
    );
    const repository = new LocalFavoritesRepository(storage);
    const migrated = await repository.list();
    expect(migrated[0]?.design.version).toBe(2);
    expect(getEmojiLayer(migrated[0]!.design).source.codepoint).toBe('1f600');
    expect(storage.getItem('seemoji:favorites:v2')).toBeTruthy();
  });

  it('rejects unavailable storage explicitly', async () => {
    const repository = new LocalFavoritesRepository(null);
    await expect(repository.list()).rejects.toMatchObject({
      kind: 'unavailable',
    });
  });
});
