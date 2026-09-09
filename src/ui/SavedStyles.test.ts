import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EmojiStyleImportPreview, EmojiStyleLibrary, EmojiStyleLibrarySnapshot } from '../application/emojiStyleLibrary';
import { DEFAULT_EMOJI_LAYER } from '../domain/design';
import { createEmojiStyle } from '../domain/emojiStyle';
import { EMOJI_STYLE_ARCHIVE_MAX_BYTES } from '../domain/emojiStyleArchive';
import SavedStyles from './SavedStyles';

let root: Root | null = null;
afterEach(() => { root?.unmount(); root = null; document.body.replaceChildren(); });

const created = createEmojiStyle('existing', 'Mint', 1, DEFAULT_EMOJI_LAYER);
if (!created.ok) throw new Error(created.error);
const mint = created.value;
const preview: EmojiStyleImportPreview = {
  id: 'preview-1', policy: 'keep-both', incomingCount: 2, importCount: 2, skippedCount: 0, renamedCount: 1,
  entries: [
    { sourceId: 'a', originalName: 'Mint', name: 'Mint (2)', action: 'import' },
    { sourceId: 'b', originalName: 'Tilt', name: 'Tilt', action: 'import' },
  ], omissions: [],
};

const setup = async (selectedLayer: typeof DEFAULT_EMOJI_LAYER | null = null) => {
  let snapshot: EmojiStyleLibrarySnapshot = { status: 'ready', busy: false, styles: [mint], issues: [], error: null };
  const listeners = new Set<() => void>();
  const methods = {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); },
    load: vi.fn(async () => undefined), save: vi.fn(async () => true), remove: vi.fn(async () => true),
    removeUnreadable: vi.fn(async () => true),
    prepareImport: vi.fn(async () => preview as EmojiStyleImportPreview | null),
    importPreview: vi.fn(async () => ({ importedCount: 2, skippedCount: 0, renamedCount: 1 }) as { importedCount: number; skippedCount: number; renamedCount: number } | null),
    cancelImport: vi.fn(), exportArchive: vi.fn(async () => ({ styleCount: 1, omittedCount: 0, issues: [] })),
  };
  const library = methods as unknown as EmojiStyleLibrary;
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  root.render(createElement(SavedStyles, { loadLibrary: async () => library, selectedLayer, onApply: vi.fn() }));
  await vi.waitFor(() => expect(container.querySelector('.style-archive')).not.toBeNull());
  const publish = (patch: Partial<EmojiStyleLibrarySnapshot>) => {
    snapshot = { ...snapshot, ...patch };
    for (const listener of listeners) listener();
  };
  return { container, methods, publish };
};
const button = (container: HTMLElement, label: string): HTMLButtonElement =>
  [...container.querySelectorAll('button')].find((element) => element.textContent === label)!;
const pick = (container: HTMLElement, file: File) => {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new Event('change', { bubbles: true }));
};
const file = () => new File(['{"backup":"fixture"}'], 'styles.json', { type: 'application/json' });

describe('saved style backup workflow', () => {
  it('keeps a draft name editable while refreshing the library', async () => {
    const { container, publish, methods } = await setup(DEFAULT_EMOJI_LAYER);
    const input = container.querySelector<HTMLInputElement>('.saved-style-form input')!;
    input.focus();
    publish({ busy: true });
    await vi.waitFor(() => expect(container.querySelector('.saved-style-library')?.getAttribute('aria-busy')).toBe('true'));
    expect(input.disabled).toBe(false);
    expect(document.activeElement).toBe(input);
    input.value = 'Draft during refresh';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(button(container, 'Save style').disabled).toBe(true);
    publish({ busy: false });
    await vi.waitFor(() => expect(button(container, 'Save style').disabled).toBe(false));
    expect(input.value).toBe('Draft during refresh');
    button(container, 'Save style').click();
    await vi.waitFor(() => expect(methods.save).toHaveBeenCalledWith('Draft during refresh', DEFAULT_EMOJI_LAYER));
  });

  it('exports and opens imports without an emoji selection while save/apply stay disabled', async () => {
    const { container, methods } = await setup();
    expect(button(container, 'Save style').disabled).toBe(true);
    expect(button(container, 'Apply').disabled).toBe(true);
    expect(button(container, 'Import styles').disabled).toBe(false);
    button(container, 'Export styles').click();
    await vi.waitFor(() => expect(methods.exportArchive).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(container.textContent).toContain('Exported 1 style.'));
  });

  it('shows names and counts before the only action that writes an import', async () => {
    const { container, methods } = await setup();
    pick(container, file());
    await vi.waitFor(() => expect(container.querySelector('.style-import-counts')).not.toBeNull());
    expect(methods.prepareImport).toHaveBeenCalledWith('{"backup":"fixture"}', 'keep-both');
    expect(methods.importPreview).not.toHaveBeenCalled();
    expect(container.querySelector('.style-import-preview')?.textContent).toContain('2 to import');
    expect(container.querySelector('.style-import-preview')?.textContent).toContain('Mint → Mint (2)');
    button(container, 'Confirm import').click();
    await vi.waitFor(() => expect(methods.importPreview).toHaveBeenCalledWith('preview-1'));
    await vi.waitFor(() => expect(container.querySelector('.style-import-preview')).toBeNull());
    expect(container.textContent).toContain('Imported 2 styles. 0 skipped; 1 renamed.');
  });

  it('prepares a new explicit preview when duplicate-name handling changes', async () => {
    const { container, methods } = await setup();
    pick(container, file());
    await vi.waitFor(() => expect(container.querySelector('.style-import-counts')).not.toBeNull());
    const policy = container.querySelector<HTMLSelectElement>('.style-import-policy select')!;
    policy.value = 'skip-matching';
    policy.dispatchEvent(new Event('change', { bubbles: true }));
    await vi.waitFor(() => expect(methods.prepareImport).toHaveBeenLastCalledWith('{"backup":"fixture"}', 'skip-matching'));
    expect(methods.importPreview).not.toHaveBeenCalled();
  });

  it('requires a fresh review after a stale or capacity-conflicted import is rejected', async () => {
    const { container, methods, publish } = await setup();
    methods.importPreview.mockImplementationOnce(async () => {
      publish({ error: 'The library changed. Prepare another preview.' });
      return null;
    });
    pick(container, file());
    await vi.waitFor(() => expect(container.querySelector('.style-import-counts')).not.toBeNull());
    button(container, 'Confirm import').click();
    await vi.waitFor(() => expect(button(container, 'Refresh import preview')).toBeDefined());
    expect(button(container, 'Confirm import')).toBeUndefined();
    expect(container.textContent).toContain('The library changed.');
    button(container, 'Refresh import preview').click();
    await vi.waitFor(() => expect(methods.prepareImport).toHaveBeenCalledTimes(2));
    expect(methods.importPreview).toHaveBeenCalledTimes(1);
  });

  it('rejects oversized files before reading or preparing them', async () => {
    const { container, methods } = await setup();
    const oversized = new File([new Uint8Array(EMOJI_STYLE_ARCHIVE_MAX_BYTES + 1)], 'large.json');
    const read = vi.spyOn(oversized, 'text');
    pick(container, oversized);
    await vi.waitFor(() => expect(container.textContent).toContain('no larger than 256 KB'));
    expect(read).not.toHaveBeenCalled();
    expect(methods.prepareImport).not.toHaveBeenCalled();
    expect(methods.importPreview).not.toHaveBeenCalled();
  });

  it('cancels a pending file read so its late result cannot reopen an import', async () => {
    const { container, methods } = await setup();
    let finish!: (value: string) => void;
    const pending = file();
    vi.spyOn(pending, 'text').mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    pick(container, pending);
    await vi.waitFor(() => expect(button(container, 'Cancel import')).toBeDefined());
    button(container, 'Cancel import').click();
    finish('{"backup":"late"}');
    await vi.waitFor(() => expect(container.querySelector('.style-import-preview')).toBeNull());
    expect(methods.prepareImport).not.toHaveBeenCalled();
  });

  it('makes omission metadata visible when exporting and reviewing a partial backup', async () => {
    const { container, methods } = await setup();
    methods.exportArchive.mockResolvedValueOnce({ styleCount: 1, omittedCount: 1, issues: [] });
    button(container, 'Export styles').click();
    await vi.waitFor(() => expect(container.textContent).toContain('1 unreadable record was omitted'));
    methods.prepareImport.mockResolvedValueOnce({ ...preview, omissions: [{ id: 'broken', error: 'Invalid saved transform' }] });
    pick(container, file());
    await vi.waitFor(() => expect(container.querySelector('.style-import-omissions')?.textContent).toContain('cannot be restored'));
    expect(container.querySelector('.style-import-omissions')?.textContent).toContain('Invalid saved transform');
    expect(methods.importPreview).not.toHaveBeenCalled();
  });

  it.each([null, ''])('recovers an unreadable record with display identity %j through its opaque token', async (id) => {
    const { container, methods, publish } = await setup();
    const issue = { id, error: 'Saved style has an invalid identity.', recoveryToken: 'opaque-record-token' };
    publish({ issues: [issue] });
    await vi.waitFor(() => expect(button(container, 'Delete unreadable style')).toBeDefined());
    expect(methods.removeUnreadable).not.toHaveBeenCalled();
    publish({ busy: true });
    await vi.waitFor(() => expect(button(container, 'Delete unreadable style').disabled).toBe(true));
    publish({ busy: false });
    await vi.waitFor(() => expect(button(container, 'Delete unreadable style').disabled).toBe(false));
    methods.removeUnreadable.mockImplementationOnce(async () => {
      publish({ issues: [] });
      return true;
    });
    button(container, 'Delete unreadable style').click();
    await vi.waitFor(() => expect(methods.removeUnreadable).toHaveBeenCalledWith('opaque-record-token'));
    expect(methods.remove).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(button(container, 'Delete unreadable style')).toBeUndefined());
    expect(container.textContent).toContain('Deleted the unreadable style.');
    expect(container.querySelector('.saved-style-list')?.textContent).toContain('Mint');
  });

  it('shows a changed-record conflict and uses the refreshed token only after another explicit deletion', async () => {
    const { container, methods, publish } = await setup();
    publish({ issues: [{ id: null, error: 'Invalid record', recoveryToken: 'first-token' }] });
    await vi.waitFor(() => expect(button(container, 'Delete unreadable style')).toBeDefined());
    methods.removeUnreadable.mockImplementationOnce(async () => {
      publish({ error: 'The unreadable style changed. Review it and try again.',
        issues: [{ id: null, error: 'Changed invalid record', recoveryToken: 'refreshed-token' }] });
      return false;
    });
    button(container, 'Delete unreadable style').click();
    await vi.waitFor(() => expect(container.textContent).toContain('The unreadable style changed.'));
    expect(methods.removeUnreadable).toHaveBeenCalledOnce();
    expect(container.textContent).not.toContain('Deleted the unreadable style.');
    button(container, 'Delete unreadable style').click();
    await vi.waitFor(() => expect(methods.removeUnreadable).toHaveBeenNthCalledWith(2, 'refreshed-token'));
    expect(methods.remove).not.toHaveBeenCalled();
  });

  it('does not offer per-record deletion for an aggregate issue without a recovery token', async () => {
    const { container, methods, publish } = await setup();
    publish({ issues: [{ id: null, error: 'This library exceeds its capacity. Delete entries and refresh.' }] });
    await vi.waitFor(() => expect(container.textContent).toContain('This library exceeds its capacity.'));
    expect(button(container, 'Delete unreadable style')).toBeUndefined();
    expect(methods.removeUnreadable).not.toHaveBeenCalled();
  });
});
