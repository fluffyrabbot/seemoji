import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_EMOJI_LAYER } from '../domain/design';
import { createEmojiStyle, type EmojiStyle } from '../domain/emojiStyle';
import { emojiStyleSnapshotKey, parseEmojiStyleArchive, serializeEmojiStyleArchive, type EmojiStyleArchive } from '../domain/emojiStyleArchive';
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
    importStyles: vi.fn(async (styles, expected) => {
      if (emojiStyleSnapshotKey(records) !== emojiStyleSnapshotKey(expected)) throw new Error('The library changed after this preview. Preview again.');
      records = [...records, ...styles];
      return styles;
    }),
    removeUnreadable: vi.fn(async () => {}),
    delete: vi.fn(async (id) => { records = records.filter((style) => style.id !== id); }),
  };
  let identity = 0;
  const download = vi.fn();
  return { repository, download, library: new EmojiStyleLibrary(repository, { createId: () => `style-${++identity}`, now: () => 123, fileExport: { download } }) };
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

const archiveStyle = (id: string, name: string): EmojiStyle => {
  const decoded = createEmojiStyle(id, name, 123, DEFAULT_EMOJI_LAYER);
  if (!decoded.ok) throw new Error(decoded.error);
  return decoded.value;
};
const backup = (styles: readonly EmojiStyle[], omissions: EmojiStyleArchive['omissions'] = []): string => {
  const encoded = serializeEmojiStyleArchive({ format: 'seemoji-styles', version: 1, exportedAt: 123, styles, omissions });
  if (!encoded.ok) throw new Error(encoded.error);
  return encoded.value;
};

describe('portable style backup and import', () => {
  it('exports fresh persisted records and makes corruption omissions explicit and bounded', async () => {
    const { repository, library, download } = fixture();
    await library.load();
    const externallySaved = archiveStyle('external', 'Other tab');
    await repository.create(externallySaved);
    vi.mocked(repository.load).mockResolvedValueOnce({ styles: [externallySaved], issues: [{ id: 'x'.repeat(101), error: 'Unreadable format' }] });
    expect(await library.exportArchive()).toMatchObject({ styleCount: 1, omittedCount: 1, issues: [{ id: null, error: expect.stringContaining('identity was too long') }] });
    expect(download).toHaveBeenCalledWith(expect.any(Blob), 'seemoji-styles.json');
    const decoded = parseEmojiStyleArchive(await (download.mock.calls[0]![0] as Blob).text());
    expect(decoded).toMatchObject({ ok: true, value: { styles: [externallySaved], omissions: [{ id: null, error: expect.stringContaining('Unreadable') }] } });
  });

  it('previews without writing, imports fresh identities, and resolves duplicate names explicitly', async () => {
    const { repository, library } = fixture();
    const existing = archiveStyle('existing', 'Mint');
    await repository.create(existing);
    const preview = await library.prepareImport(backup([archiveStyle('source', 'Mint')]), 'keep-both');
    expect(preview).toMatchObject({ importCount: 1, renamedCount: 1, entries: [{ originalName: 'Mint', name: 'Mint (2)' }] });
    expect(repository.importStyles).not.toHaveBeenCalled();
    expect((await repository.load()).styles).toEqual([existing]);
    expect(await library.importPreview(preview!.id)).toEqual({ importedCount: 1, skippedCount: 0, renamedCount: 1 });
    expect((await repository.load()).styles).toEqual([existing, expect.objectContaining({ id: 'style-1', name: 'Mint (2)' })]);
    const skip = await library.prepareImport(backup([archiveStyle('source', 'mint')]), 'skip-matching');
    expect(skip).toMatchObject({ importCount: 0, skippedCount: 1 });
    await library.importPreview(skip!.id);
    expect((await repository.load()).styles).toHaveLength(2);
  });

  it('invalidates an earlier preview when a new file is malformed or explicitly cancelled', async () => {
    const { repository, library } = fixture();
    const encoded = backup([archiveStyle('source', 'Mint')]);
    const preview = await library.prepareImport(encoded, 'keep-both');
    expect(await library.prepareImport('{', 'keep-both')).toBeNull();
    expect(library.getSnapshot().error).toContain('JSON');
    expect(await library.importPreview(preview!.id)).toBeNull();
    const second = await library.prepareImport(encoded, 'keep-both');
    library.cancelImport();
    expect(await library.importPreview(second!.id)).toBeNull();
    expect(repository.importStyles).not.toHaveBeenCalled();
  });

  it('ignores late preview reads after the user chooses a different file', async () => {
    const { repository, library } = fixture();
    const gate = deferred<EmojiStyleCollection>();
    vi.mocked(repository.load).mockImplementationOnce(() => gate.promise);
    const first = library.prepareImport(backup([archiveStyle('old', 'Old file')]), 'keep-both');
    await Promise.resolve();
    const latest = library.prepareImport(backup([archiveStyle('latest', 'Latest file')]), 'keep-both');
    gate.resolve({ styles: [], issues: [] });
    expect(await first).toBeNull();
    const preview = await latest;
    expect(preview?.entries[0]?.name).toBe('Latest file');
    await library.importPreview(preview!.id);
    expect((await repository.load()).styles.map(({ name }) => name)).toEqual(['Latest file']);
  });

  it('rejects a preview after a concurrent writer changes the library and supports re-preview', async () => {
    const { repository, library } = fixture();
    const encoded = backup([archiveStyle('source', 'Mint')]);
    const preview = await library.prepareImport(encoded, 'keep-both');
    await repository.create(archiveStyle('external', 'Mint'));
    expect(await library.importPreview(preview!.id)).toBeNull();
    expect(library.getSnapshot().error).toContain('changed');
    expect((await repository.load()).styles).toHaveLength(1);
    const next = await library.prepareImport(encoded, 'keep-both');
    expect(next?.entries[0]?.name).toBe('Mint (2)');
    expect(await library.importPreview(next!.id)).toMatchObject({ importedCount: 1 });
  });

  it('makes refresh invalidate a changed preview without overwriting persisted styles', async () => {
    const { repository, library } = fixture();
    const preview = await library.prepareImport(backup([archiveStyle('source', 'Mint')]), 'keep-both');
    await repository.create(archiveStyle('external', 'Other tab'));
    await library.load();
    expect(await library.importPreview(preview!.id)).toBeNull();
    expect(repository.importStyles).not.toHaveBeenCalled();
    expect(library.getSnapshot().error).toContain('changed');
  });

  it('keeps valid backups usable for recovery while blocking import into an unreadable library', async () => {
    const { repository, library, download } = fixture();
    const valid = archiveStyle('valid', 'Recovered');
    vi.mocked(repository.load).mockResolvedValue({ styles: [valid], issues: [{ id: 'broken', error: 'Invalid style data' }] });
    await library.exportArchive();
    const encoded = await (download.mock.calls[0]![0] as Blob).text();
    expect(await library.prepareImport(encoded, 'keep-both')).toBeNull();
    expect(repository.importStyles).not.toHaveBeenCalled();
    vi.mocked(repository.load).mockResolvedValue({ styles: [], issues: [] });
    const recovered = await library.prepareImport(encoded, 'keep-both');
    expect(recovered).toMatchObject({ importCount: 1, omissions: [{ id: 'broken' }] });
    expect(await library.importPreview(recovered!.id)).toMatchObject({ importedCount: 1 });
  });

  it('surfaces identity generation and transaction failures without claiming an import', async () => {
    const { repository } = fixture();
    const library = new EmojiStyleLibrary(repository, { createId: () => 'source', now: () => 123 });
    const preview = await library.prepareImport(backup([archiveStyle('source', 'Mint')]), 'keep-both');
    expect(await library.importPreview(preview!.id)).toBeNull();
    expect(library.getSnapshot().error).toContain('fresh style identity');
    expect(repository.importStyles).not.toHaveBeenCalled();
    const fresh = new EmojiStyleLibrary(repository, { createId: () => 'fresh', now: () => 123 });
    const candidate = await fresh.prepareImport(backup([archiveStyle('source', 'Mint')]), 'keep-both');
    vi.mocked(repository.importStyles).mockRejectedValueOnce(new Error('Storage transaction aborted'));
    expect(await fresh.importPreview(candidate!.id)).toBeNull();
    expect(fresh.getSnapshot().error).toContain('transaction aborted');
    expect((await repository.load()).styles).toEqual([]);
  });

  it('surfaces failed download delivery and can retry without changing stored styles', async () => {
    const { repository, library, download } = fixture();
    await repository.create(archiveStyle('source', 'Mint'));
    download.mockImplementationOnce(() => { throw new Error('Download denied'); });
    expect(await library.exportArchive()).toBeNull();
    expect(library.getSnapshot().error).toBe('Download denied');
    expect(await library.exportArchive()).toMatchObject({ styleCount: 1 });
  });

  it('deletes unreadable records only through their recovery capability and refreshes the collection', async () => {
    const { repository, library } = fixture();
    vi.mocked(repository.load).mockResolvedValueOnce({ styles: [], issues: [
      { id: null, error: 'Invalid identity', recoveryToken: 'observed-numeric-key' },
      { id: '', error: 'Invalid identity', recoveryToken: 'observed-empty-key' },
    ] });
    await library.load();
    expect(repository.removeUnreadable).not.toHaveBeenCalled();
    await expect(library.removeUnreadable('observed-numeric-key')).resolves.toBe(true);
    expect(repository.removeUnreadable).toHaveBeenCalledWith('observed-numeric-key');
    expect(repository.delete).not.toHaveBeenCalled();
    expect(library.getSnapshot()).toMatchObject({ busy: false, status: 'ready', error: null, issues: [] });
  });

  it('shows repaired data after a recovery conflict and lets the caller review a fresh token', async () => {
    const { repository, library } = fixture();
    vi.mocked(repository.load).mockResolvedValueOnce({ styles: [], issues: [
      { id: null, error: 'Invalid identity', recoveryToken: 'old' },
    ] });
    await library.load();
    vi.mocked(repository.removeUnreadable).mockRejectedValueOnce(new Error('The unreadable style changed. Nothing was deleted.'));
    vi.mocked(repository.load).mockResolvedValueOnce({ styles: [archiveStyle('repaired', 'Recovered')], issues: [
      { id: null, error: 'Replacement data', recoveryToken: 'fresh' },
    ] });
    await expect(library.removeUnreadable('old')).resolves.toBe(false);
    expect(library.getSnapshot()).toMatchObject({ status: 'error', busy: false,
      styles: [{ name: 'Recovered' }], issues: [{ recoveryToken: 'fresh' }], error: expect.stringContaining('Nothing was deleted'),
    });
    await expect(library.removeUnreadable('fresh')).resolves.toBe(true);
    expect(repository.removeUnreadable).toHaveBeenLastCalledWith('fresh');
  });

  it('never serializes local recovery capabilities into portable backups or import previews', async () => {
    const { repository, library, download } = fixture();
    vi.mocked(repository.load).mockResolvedValue({ styles: [], issues: [
      { id: null, error: 'Invalid identity', recoveryToken: 'private-local-capability' },
    ] });
    const exported = await library.exportArchive();
    const encoded = await (download.mock.calls[0]![0] as Blob).text();
    expect(encoded).not.toContain('private-local-capability');
    expect(exported?.issues).toEqual([{ id: null, error: 'Invalid identity' }]);
    vi.mocked(repository.load).mockResolvedValue({ styles: [], issues: [] });
    expect((await library.prepareImport(encoded, 'keep-both'))?.omissions).toEqual([{ id: null, error: 'Invalid identity' }]);
  });
});
