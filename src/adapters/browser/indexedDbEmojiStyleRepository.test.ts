import { IDBFactory, IDBObjectStore as FakeIDBObjectStore } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_EMOJI_LAYER } from '../../domain/design';
import { createEmojiStyle, EMOJI_STYLE_CAPACITY } from '../../domain/emojiStyle';
import { IndexedDbEmojiStyleRepository } from './indexedDbEmojiStyleRepository';

const style = (id: number, name = `Style ${id}`) => {
  const result = createEmojiStyle(`style-${id}`, name, id, DEFAULT_EMOJI_LAYER);
  if (!result.ok) throw new Error(result.error);
  return result.value;
};

const writeRaw = async (factory: IDBFactory, records: readonly unknown[]): Promise<void> => {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open('seemoji-styles');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction('styles', 'readwrite');
      for (const raw of records) transaction.objectStore('styles').put(raw);
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error);
    });
  } finally { database.close(); }
};

describe('saved style storage', () => {
  it('persists immutable records across repository instances and deletes only the named identity', async () => {
    const factory = new IDBFactory();
    const first = new IndexedDbEmojiStyleRepository(factory);
    const second = new IndexedDbEmojiStyleRepository(factory);
    await first.create(style(1));
    await second.create(style(2));
    expect((await first.load()).styles.map(({ id }) => id)).toEqual(['style-2', 'style-1']);
    await second.delete('style-1');
    await second.delete('style-1');
    expect((await first.load()).styles).toEqual([style(2)]);
  });

  it('atomically rejects duplicate names and identities across concurrent writers', async () => {
    const factory = new IDBFactory();
    const first = new IndexedDbEmojiStyleRepository(factory);
    const second = new IndexedDbEmojiStyleRepository(factory);
    const results = await Promise.allSettled([first.create(style(1, 'Mint')), second.create(style(2, ' ＭＩＮＴ '))]);
    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(results.find(({ status }) => status === 'rejected')).toMatchObject({ reason: { kind: 'duplicate' } });
    const saved = (await first.load()).styles[0]!;
    await expect(second.create({ ...saved, name: 'Renamed' })).rejects.toMatchObject({ kind: 'duplicate' });
    expect((await first.load()).styles).toHaveLength(1);
  });

  it('enforces capacity in the write transaction instead of racing a prior list', async () => {
    const factory = new IDBFactory();
    const first = new IndexedDbEmojiStyleRepository(factory);
    const second = new IndexedDbEmojiStyleRepository(factory);
    for (let index = 0; index < EMOJI_STYLE_CAPACITY - 1; index += 1) await first.create(style(index));
    const results = await Promise.allSettled([first.create(style(100)), second.create(style(101))]);
    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(results.find(({ status }) => status === 'rejected')).toMatchObject({ reason: { kind: 'capacity' } });
    expect((await first.load()).styles).toHaveLength(EMOJI_STYLE_CAPACITY);
  });

  it('reports malformed records without hiding valid saved styles and allows deleting the broken record', async () => {
    const factory = new IDBFactory();
    const repository = new IndexedDbEmojiStyleRepository(factory);
    await repository.create(style(1));
    const database = await new Promise<IDBDatabase>((resolve) => {
      const request = factory.open('seemoji-styles');
      request.onsuccess = () => resolve(request.result);
    });
    await new Promise<void>((resolve) => {
      const transaction = database.transaction('styles', 'readwrite');
      transaction.objectStore('styles').add({ id: 'broken', version: 99 });
      transaction.objectStore('styles').add({ ...style(2), nameKey: 'wrong-name' });
      transaction.oncomplete = () => resolve();
    });
    database.close();
    expect(await repository.load()).toMatchObject({ styles: [style(1)], issues: [
      { id: 'broken', error: expect.any(String) }, { id: 'style-2', error: expect.stringContaining('metadata') },
    ] });
    await repository.delete('broken');
    await repository.delete('style-2');
    expect((await repository.load()).issues).toEqual([]);
  });

  it('exposes unavailable storage and validates values before attempting a write', async () => {
    const repository = new IndexedDbEmojiStyleRepository(null);
    await expect(repository.load()).rejects.toMatchObject({ kind: 'unavailable' });
    await expect(repository.create({ ...style(1), name: '' })).rejects.toMatchObject({ kind: 'write-failed' });
  });

  it('imports a complete batch durably while preserving every existing style', async () => {
    const factory = new IDBFactory();
    const repository = new IndexedDbEmojiStyleRepository(factory);
    await repository.create(style(1));
    const imported = [style(2), style(3)];
    expect(await repository.importStyles(imported, [style(1)])).toEqual(imported);
    expect(await new IndexedDbEmojiStyleRepository(factory).load()).toEqual({
      styles: [style(3), style(2), style(1)], issues: [],
    });
  });

  it('rejects the entire batch for invalid data or unresolved name and identity collisions', async () => {
    const repository = new IndexedDbEmojiStyleRepository(new IDBFactory());
    await repository.create(style(1));
    await expect(repository.importStyles([style(2), { ...style(3), name: '' }], [style(1)]))
      .rejects.toMatchObject({ kind: 'write-failed' });
    for (const batch of [
      [style(2), { ...style(3), id: 'style-2' }],
      [style(2, 'Mint'), style(3, 'ＭＩＮＴ')],
      [style(2), { ...style(3), id: 'style-1' }],
      [style(2), style(3, 'STYLE 1')],
    ]) {
      await expect(repository.importStyles(batch, [style(1)])).rejects.toMatchObject({ kind: 'duplicate' });
    }
    expect((await repository.load()).styles).toEqual([style(1)]);
  });

  it('rejects an oversized batch before inserting even its first record', async () => {
    const repository = new IndexedDbEmojiStyleRepository(new IDBFactory());
    const existing = Array.from({ length: EMOJI_STYLE_CAPACITY - 1 }, (_, index) => style(index));
    await repository.importStyles(existing, []);
    await expect(repository.importStyles([style(100), style(101)], existing)).rejects.toMatchObject({ kind: 'capacity' });
    expect((await repository.load()).styles).toEqual([...existing].reverse());
  });

  it('serializes concurrent commits and rejects the preview invalidated by the winning writer', async () => {
    const factory = new IDBFactory();
    const first = new IndexedDbEmojiStyleRepository(factory);
    const second = new IndexedDbEmojiStyleRepository(factory);
    await first.create(style(1));
    const results = await Promise.allSettled([
      first.importStyles([style(2), style(3)], [style(1)]),
      second.importStyles([style(4), style(5)], [style(1)]),
    ]);
    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(results.find(({ status }) => status === 'rejected')).toMatchObject({ reason: { kind: 'conflict' } });
    const winner = results[0]!.status === 'fulfilled' ? [style(3), style(2)] : [style(5), style(4)];
    expect((await first.load()).styles).toEqual([...winner, style(1)]);
  });

  it('compares full persisted records so replacement data invalidates a preview even at the same size', async () => {
    const factory = new IDBFactory();
    const first = new IndexedDbEmojiStyleRepository(factory);
    const second = new IndexedDbEmojiStyleRepository(factory);
    await first.create(style(1));
    await second.delete('style-1');
    await second.create({ ...style(1), transform: { ...style(1).transform, rotate: 45 } });
    await expect(first.importStyles([style(2)], [style(1)])).rejects.toMatchObject({ kind: 'conflict' });
    expect((await first.load()).styles).toEqual([{ ...style(1), transform: { ...style(1).transform, rotate: 45 } }]);
  });

  it('blocks import into a corrupt collection without removing its recoverable records', async () => {
    const factory = new IDBFactory();
    const repository = new IndexedDbEmojiStyleRepository(factory);
    await repository.create(style(1));
    const database = await new Promise<IDBDatabase>((resolve) => {
      const request = factory.open('seemoji-styles');
      request.onsuccess = () => resolve(request.result);
    });
    await new Promise<void>((resolve) => {
      const transaction = database.transaction('styles', 'readwrite');
      transaction.objectStore('styles').add({ id: 'broken', version: 99 });
      transaction.oncomplete = () => resolve();
    });
    database.close();
    await expect(repository.importStyles([style(2)], [style(1)])).rejects.toMatchObject({ kind: 'corrupt' });
    expect(await repository.load()).toMatchObject({ styles: [style(1)], issues: [{ id: 'broken' }] });
    await repository.delete('broken');
    await repository.importStyles([style(2)], [style(1)]);
    expect((await repository.load()).styles).toEqual([style(2), style(1)]);
  });

  it('rolls back earlier inserts when a transaction aborts after a later insert succeeds', async () => {
    const repository = new IndexedDbEmojiStyleRepository(new IDBFactory());
    await repository.create(style(1));
    const originalAdd = FakeIDBObjectStore.prototype.add;
    let inserted = 0;
    const add = vi.spyOn(FakeIDBObjectStore.prototype, 'add').mockImplementation(function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
      const request = originalAdd.call(this, value, key);
      inserted += 1;
      if (inserted === 2) request.addEventListener('success', () => this.transaction.abort(), { once: true });
      return request;
    });
    try {
      await expect(repository.importStyles([style(2), style(3)], [style(1)])).rejects.toMatchObject({ kind: 'write-failed' });
      expect(inserted).toBe(2);
      expect((await repository.load()).styles).toEqual([style(1)]);
    } finally {
      add.mockRestore();
    }
    await repository.importStyles([style(2), style(3)], [style(1)]);
    expect((await repository.load()).styles).toEqual([style(3), style(2), style(1)]);
  });

  it.each([
    ['numeric', 42],
    ['empty string', ''],
    ['array', ['legacy', 2]],
    ['date', new Date(123)],
    ['binary', new Uint8Array([2, 4, 6])],
  ])('recovers a corrupt record with a %s key without touching readable styles', async (_label, key) => {
    const factory = new IDBFactory();
    const repository = new IndexedDbEmojiStyleRepository(factory);
    await repository.create(style(1));
    await writeRaw(factory, [{ id: key, version: 99 }]);
    const collection = await repository.load();
    expect(collection.styles).toEqual([style(1)]);
    expect(collection.issues).toHaveLength(1);
    const token = collection.issues[0]!.recoveryToken;
    expect(token).toEqual(expect.any(String));
    await repository.removeUnreadable(token!);
    expect(await repository.load()).toEqual({ styles: [style(1)], issues: [] });
    await repository.importStyles([style(2)], [style(1)]);
    expect((await repository.load()).styles).toEqual([style(2), style(1)]);
  });

  it('refuses a stale recovery action after another writer repairs the style', async () => {
    const factory = new IDBFactory();
    const repository = new IndexedDbEmojiStyleRepository(factory);
    await repository.load();
    await writeRaw(factory, [{ id: 'style-1', version: 99 }]);
    const token = (await repository.load()).issues[0]!.recoveryToken!;
    await writeRaw(factory, [{ ...style(1), nameKey: 'style 1' }]);
    await expect(repository.removeUnreadable(token)).rejects.toMatchObject({ kind: 'conflict', message: expect.stringContaining('Nothing was deleted') });
    expect(await repository.load()).toEqual({ styles: [style(1)], issues: [] });
  });

  it('requires another explicit recovery action for a replacement corrupt record at the same key', async () => {
    const factory = new IDBFactory();
    const repository = new IndexedDbEmojiStyleRepository(factory);
    await repository.load();
    await writeRaw(factory, [{ id: ['legacy', 2], version: 99, data: 'first' }]);
    const token = (await repository.load()).issues[0]!.recoveryToken!;
    await writeRaw(factory, [{ id: ['legacy', 2], version: 99, data: 'replacement' }]);
    await expect(repository.removeUnreadable(token)).rejects.toMatchObject({ kind: 'conflict' });
    const refreshed = (await repository.load()).issues[0]!.recoveryToken!;
    expect(refreshed).not.toBe(token);
    await repository.removeUnreadable(refreshed);
    expect((await repository.load()).issues).toEqual([]);
  });

  it('compares structured clone graph topology, binary bytes, maps and dates before deletion', async () => {
    const factory = new IDBFactory();
    const repository = new IndexedDbEmojiStyleRepository(factory);
    await repository.load();
    const first = { id: 42, version: 99, absent: undefined, data: new Map<unknown, unknown>([
      ['date', new Date(123)], ['bytes', new Uint8Array([1, 2])], ['set', new Set([NaN, undefined, 5n])],
    ]), cycle: null as unknown };
    first.cycle = first;
    await writeRaw(factory, [first]);
    const token = (await repository.load()).issues[0]!.recoveryToken!;
    first.data.set('bytes', new Uint8Array([1, 3]));
    await writeRaw(factory, [first]);
    await expect(repository.removeUnreadable(token)).rejects.toMatchObject({ kind: 'conflict' });
    const changedBytes = (await repository.load()).issues[0]!.recoveryToken!;
    first.cycle = { id: 42, version: 99, cycle: first };
    await writeRaw(factory, [first]);
    await expect(repository.removeUnreadable(changedBytes)).rejects.toMatchObject({ kind: 'conflict' });
    await repository.removeUnreadable((await repository.load()).issues[0]!.recoveryToken!);
    expect((await repository.load()).issues).toEqual([]);
  });

  it('expires tokens on refresh and scopes them to the repository that observed the record', async () => {
    const factory = new IDBFactory();
    const first = new IndexedDbEmojiStyleRepository(factory);
    const second = new IndexedDbEmojiStyleRepository(factory);
    await first.load();
    await writeRaw(factory, [{ id: '', version: 99 }]);
    const token = (await first.load()).issues[0]!.recoveryToken!;
    await expect(second.removeUnreadable(token)).rejects.toMatchObject({ kind: 'conflict' });
    const refreshed = (await first.load()).issues[0]!.recoveryToken!;
    await expect(first.removeUnreadable(token)).rejects.toMatchObject({ kind: 'conflict' });
    await first.removeUnreadable(refreshed);
    await expect(first.removeUnreadable(refreshed)).rejects.toMatchObject({ kind: 'conflict' });
    expect((await first.load()).issues).toEqual([]);
  });
});
