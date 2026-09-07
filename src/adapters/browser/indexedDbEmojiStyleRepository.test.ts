import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { DEFAULT_EMOJI_LAYER } from '../../domain/design';
import { createEmojiStyle, EMOJI_STYLE_CAPACITY } from '../../domain/emojiStyle';
import { IndexedDbEmojiStyleRepository } from './indexedDbEmojiStyleRepository';

const style = (id: number, name = `Style ${id}`) => {
  const result = createEmojiStyle(`style-${id}`, name, id, DEFAULT_EMOJI_LAYER);
  if (!result.ok) throw new Error(result.error);
  return result.value;
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
});
