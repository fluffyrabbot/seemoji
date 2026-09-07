import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_EMOJI_LAYER } from '../domain/design';
import { createEmojiStyle, type EmojiStyle } from '../domain/emojiStyle';
import type { EmojiStyleCollection, EmojiStyleRepository } from '../ports/emojiStyleRepository';
import { EmojiStyleLibrary } from './emojiStyleLibrary';

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
};
const fixture = () => {
  let records: EmojiStyle[] = [];
  const repository: EmojiStyleRepository = {
    load: vi.fn(async () => ({ styles: [...records], issues: [] })),
    create: vi.fn(async (style) => { records = [...records, style]; return style; }),
    delete: vi.fn(async (id) => { records = records.filter((style) => style.id !== id); }),
  };
  let identity = 0;
  return { repository, library: new EmojiStyleLibrary(repository, { createId: () => `style-${++identity}`, now: () => 123 }) };
};

describe('saved style library operation ordering', () => {
  it('persists a captured look then refreshes and publishes observable changes', async () => {
    const { repository, library } = fixture();
    const changed = vi.fn();
    const unsubscribe = library.subscribe(changed);
    await library.load();
    await expect(library.save('Look', { ...DEFAULT_EMOJI_LAYER,
      transform: { ...DEFAULT_EMOJI_LAYER.transform, rotate: 24, x: 0.3 },
    })).resolves.toBe(true);
    expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({ name: 'Look', transform: expect.objectContaining({ rotate: 24 }) }));
    expect(library.getSnapshot().styles[0]?.transform).not.toHaveProperty('x');
    expect(library.getSnapshot()).toMatchObject({ status: 'ready', busy: false, error: null });
    expect(changed).toHaveBeenCalled();
    unsubscribe();
    const calls = changed.mock.calls.length;
    await library.remove('style-1');
    expect(library.getSnapshot().styles).toEqual([]);
    expect(changed).toHaveBeenCalledTimes(calls);
  });

  it('orders a delayed read, save and delete so no late snapshot resurrects deleted styles', async () => {
    const { repository, library } = fixture();
    const gate = deferred<EmojiStyleCollection>();
    vi.mocked(repository.load).mockImplementationOnce(() => gate.promise);
    const read = library.load();
    const save = library.save('Captured', DEFAULT_EMOJI_LAYER);
    const remove = library.remove('style-1');
    await Promise.resolve();
    expect(repository.create).not.toHaveBeenCalled();
    gate.resolve({ styles: [], issues: [] });
    await Promise.all([read, save, remove]);
    expect(repository.create).toHaveBeenCalledTimes(1);
    expect(repository.delete).toHaveBeenCalledWith('style-1');
    expect(library.getSnapshot()).toMatchObject({ busy: false, styles: [], error: null });
  });

  it('does not claim persistence when saving fails and allows a later retry', async () => {
    const { repository, library } = fixture();
    vi.mocked(repository.create).mockRejectedValueOnce(new Error('Storage is full'));
    await expect(library.save('Look', DEFAULT_EMOJI_LAYER)).resolves.toBe(false);
    expect(library.getSnapshot()).toMatchObject({ status: 'error', styles: [], busy: false, error: 'Storage is full' });
    await expect(library.save('Look', DEFAULT_EMOJI_LAYER)).resolves.toBe(true);
    expect(library.getSnapshot().styles).toHaveLength(1);
    expect(library.getSnapshot().error).toBeNull();
  });

  it('distinguishes a committed save from a failed refresh and preserves the saved record locally', async () => {
    const { repository, library } = fixture();
    vi.mocked(repository.load).mockRejectedValueOnce(new Error('read failed'));
    await expect(library.save('Look', DEFAULT_EMOJI_LAYER)).resolves.toBe(true);
    expect(library.getSnapshot()).toMatchObject({ styles: [{ name: 'Look' }], error: expect.stringContaining('Style saved') });
    await library.load();
    expect(library.getSnapshot()).toMatchObject({ status: 'ready', error: null });
  });

  it('rejects invalid names without storage writes and refreshes styles saved by another instance', async () => {
    const { repository, library } = fixture();
    await expect(library.save('   ', DEFAULT_EMOJI_LAYER)).resolves.toBe(false);
    expect(repository.create).not.toHaveBeenCalled();
    const external = createEmojiStyle('external', 'Other tab', 12, DEFAULT_EMOJI_LAYER);
    if (!external.ok) throw new Error(external.error);
    await repository.create(external.value);
    await library.load();
    expect(library.getSnapshot().styles).toEqual([external.value]);
  });
});
