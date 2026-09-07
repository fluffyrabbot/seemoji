import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_EMOJI_LAYER, type EmojiLayer } from '../domain/design';
import { toCodepoint } from '../domain/emoji';
import { DEFAULT_PACK_SNAPSHOT, type PackManifest, type PackSummary } from '../domain/pack';
import type { EmojiPackCatalog } from '../ports/emojiPackCatalog';
import type { EmojiPickTarget } from './editor/contracts';
import EmojiPicker from './EmojiPicker';
import { EMOJI_SEARCH_ENTRIES } from './emojiSearchCorpus';
import { searchEmoji } from './emojiSearch';
import * as searchLibrary from './emojiSearch';

const license = { spdx: 'CC-BY-4.0', attribution: 'Test artwork', shareAlike: false, noticeUrl: 'https://example.test/license' };
const packs: readonly PackSummary[] = ['twemoji', 'noto'].map((id) => ({
  id: id as PackSummary['id'],
  name: id === 'twemoji' ? 'Twemoji' : 'Noto Emoji',
  versions: [{ version: '15.1.0', styles: [], defaultStyle: null }],
  defaultVersion: '15.1.0',
  license,
  unicodeLevel: '15.1',
}));
const manifest: PackManifest = {
  id: 'twemoji', name: 'Twemoji', version: '15.1.0', style: null, format: 'svg',
  license, unicodeLevel: '15.1',
  glyphs: [...EMOJI_SEARCH_ENTRIES.map(({ emoji }) => toCodepoint(emoji)), toCodepoint('👩🏽‍💻')],
  assetRoot: 'https://example.test/artwork/', maxAssetBytes: 1024,
  upstream: { repository: 'https://example.test/artwork', ref: 'v1' },
};

let root: Root | null = null;
afterEach(() => {
  root?.unmount();
  root = null;
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

const mount = async (options: {
  selected?: EmojiLayer | null;
  catalogOverrides?: Partial<EmojiPackCatalog>;
  accepted?: boolean;
} = {}) => {
  const container = document.createElement('div');
  document.body.append(container);
  const catalog: EmojiPackCatalog = {
    list: async () => ({ ok: true, value: packs }),
    get: async () => ({ ok: true, value: manifest }),
    hasGlyph: async (_snapshot, codepoint) => manifest.glyphs.includes(codepoint),
    assetUrl: async (ref) => ({ ok: true, value: new URL(`${manifest.assetRoot}${ref.codepoint}.svg`) }),
    summaryFor: (id) => packs.find((pack) => pack.id === id) ?? null,
    ...options.catalogOverrides,
  };
  const onPick = vi.fn(async (_emoji: string, _target: EmojiPickTarget) => options.accepted ?? true);
  const onSnapshotChange = vi.fn(async () => undefined);
  const props = {
    emoji: '😀', selectedLayer: options.selected === undefined ? DEFAULT_EMOJI_LAYER : options.selected,
    catalog, snapshot: DEFAULT_PACK_SNAPSHOT, packs, onPick, onSnapshotChange,
  };
  root = createRoot(container);
  root.render(createElement(EmojiPicker, props));
  await vi.waitFor(() => expect(container.querySelector('#emoji-search')).not.toBeNull());
  const search = async (query: string) => {
    const input = container.querySelector<HTMLInputElement>('#emoji-search')!;
    input.value = query;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await vi.waitFor(() => expect(input.value).toBe(query));
  };
  const button = (label: string) => Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
    .find((candidate) => candidate.textContent === label)!;
  const submit = async () => {
    await vi.waitFor(() => expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(false));
    container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  };
  return { container, props, onPick, onSnapshotChange, search, button, submit };
};

describe('emoji discovery', () => {
  it('keeps Popular available without loading search data, then expands only on interaction', async () => {
    const load = vi.spyOn(searchLibrary, 'loadEmojiSearchEntries');
    const picker = await mount();
    await vi.waitFor(() => expect(picker.container.querySelectorAll('.emoji-grid button')).toHaveLength(18));
    expect(load).not.toHaveBeenCalled();
    expect(picker.container.querySelector('[title="Smiling face with sunglasses"]')).not.toBeNull();
    picker.container.querySelector<HTMLInputElement>('#emoji-search')!.focus();
    await vi.waitFor(() => expect(load).toHaveBeenCalledOnce());
    expect(picker.container.querySelectorAll('.emoji-grid button')).toHaveLength(18);
    picker.button('See all').click();
    await vi.waitFor(() => expect(picker.container.querySelectorAll('.emoji-grid button')).toHaveLength(EMOJI_SEARCH_ENTRIES.length));
    expect(load).toHaveBeenCalledOnce();
  });

  it('accepts a pasted compound emoji while search data loads and preserves full names in successful recents', async () => {
    let release!: (entries: typeof EMOJI_SEARCH_ENTRIES) => void;
    const loading = new Promise<typeof EMOJI_SEARCH_ENTRIES>((resolve) => { release = resolve; });
    const load = vi.spyOn(searchLibrary, 'loadEmojiSearchEntries').mockReturnValue(loading);
    const picker = await mount({ selected: null });
    await picker.search('👩🏽‍💻');
    await picker.submit();
    await vi.waitFor(() => expect(picker.onPick).toHaveBeenCalledWith('👩🏽‍💻', { kind: 'add' }));
    release(EMOJI_SEARCH_ENTRIES);
    await picker.search('taco');
    await picker.submit();
    await vi.waitFor(() => expect(picker.onPick).toHaveBeenCalledWith('🌮', { kind: 'add' }));
    await vi.waitFor(() => expect(picker.container.querySelector('[title="Taco"]')).not.toBeNull());
    expect(picker.container.querySelector<HTMLInputElement>('#emoji-search')!.value).toBe('');
    expect(load).toHaveBeenCalledOnce();
  });

  it('can retry a failed full search load without losing the compact collection', async () => {
    const load = vi.spyOn(searchLibrary, 'loadEmojiSearchEntries')
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(EMOJI_SEARCH_ENTRIES);
    const picker = await mount();
    picker.button('See all').click();
    await vi.waitFor(() => expect(picker.container.textContent).toContain('More emoji couldn’t load.'));
    expect(picker.container.querySelectorAll('.emoji-grid button')).toHaveLength(18);
    picker.button('Retry search').click();
    await vi.waitFor(() => expect(picker.container.querySelectorAll('.emoji-grid button')).toHaveLength(EMOJI_SEARCH_ENTRIES.length));
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('finds descriptive names and useful synonyms, and preserves pasted sequences', () => {
    expect(searchEmoji('sunglasses', EMOJI_SEARCH_ENTRIES).map(({ emoji }) => emoji)).toEqual(['😎']);
    expect(searchEmoji('COOL', EMOJI_SEARCH_ENTRIES).map(({ emoji }) => emoji)).toEqual(['😎']);
    expect(searchEmoji('food cheese', EMOJI_SEARCH_ENTRIES).map(({ emoji }) => emoji)).toEqual(['🍕']);
    expect(searchEmoji('❤', EMOJI_SEARCH_ENTRIES)[0]?.name).toBe('Red heart');
    expect(searchEmoji('👩🏽‍💻', EMOJI_SEARCH_ENTRIES)[0]?.emoji).toBe('👩🏽‍💻');
    expect(searchEmoji('🍕 pizza please', EMOJI_SEARCH_ENTRIES)).toEqual([]);
    expect(searchEmoji('unfindable', EMOJI_SEARCH_ENTRIES)).toEqual([]);
  });

  it('keeps the initial grid compact and submits a named result to the selected emoji', async () => {
    const picker = await mount({ selected: { ...DEFAULT_EMOJI_LAYER, id: 'emoji-selected' } });
    await vi.waitFor(() => expect(picker.container.querySelectorAll('.emoji-grid img').length).toBeGreaterThan(0));
    expect(picker.container.querySelectorAll('.emoji-grid button').length).toBeLessThanOrEqual(18);
    await picker.search('cool');
    await vi.waitFor(() => expect(picker.container.querySelector('.emoji-grid button')?.getAttribute('aria-label'))
      .toBe('Replace selected with Smiling face with sunglasses 😎'));
    await picker.submit();
    await vi.waitFor(() => expect(picker.onPick).toHaveBeenCalledWith('😎', { kind: 'replace', layerId: 'emoji-selected' }));
  });

  it('adds a searched emoji when Add emoji is chosen without overwriting the selected layer', async () => {
    const picker = await mount();
    picker.button('Add emoji').click();
    await picker.search('pizza');
    await picker.submit();
    await vi.waitFor(() => expect(picker.onPick).toHaveBeenCalledWith('🍕', { kind: 'add' }));
  });

  it('does not revive an earlier Add choice when returning to a previously selected emoji', async () => {
    const picker = await mount();
    picker.button('Add emoji').click();
    await vi.waitFor(() => expect(picker.button('Add emoji').getAttribute('aria-pressed')).toBe('true'));
    root!.render(createElement(EmojiPicker, {
      ...picker.props, selectedLayer: { ...DEFAULT_EMOJI_LAYER, id: 'second-emoji' },
    }));
    await vi.waitFor(() => expect(picker.button('Replace selected').getAttribute('aria-pressed')).toBe('true'));
    root!.render(createElement(EmojiPicker, picker.props));
    await vi.waitFor(() => expect(picker.button('Replace selected').getAttribute('aria-pressed')).toBe('true'));
    await picker.search('pizza');
    await picker.submit();
    await vi.waitFor(() => expect(picker.onPick).toHaveBeenCalledWith('🍕', {
      kind: 'replace', layerId: DEFAULT_EMOJI_LAYER.id,
    }));
  });

  it('defaults to Add for non-emoji selections and accepts supported pasted emoji outside the collection', async () => {
    const picker = await mount({ selected: null });
    expect(picker.button('Replace selected').disabled).toBe(true);
    await picker.search('👩🏽‍💻');
    await picker.submit();
    await vi.waitFor(() => expect(picker.onPick).toHaveBeenCalledWith('👩🏽‍💻', { kind: 'add' }));
  });

  it('keeps pack browsing separate from replacing a particular selected layer', async () => {
    const picker = await mount({ selected: { ...DEFAULT_EMOJI_LAYER, id: 'chosen-object' } });
    const select = picker.container.querySelector<HTMLSelectElement>('[aria-label="Emoji library"]')!;
    select.value = 'noto';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await vi.waitFor(() => expect(picker.onSnapshotChange).toHaveBeenLastCalledWith(
      { pack: 'noto', packVersion: '15.1.0' }, 'chosen-object',
    ));
    await vi.waitFor(() => expect(picker.button('Add emoji').disabled).toBe(false));
    picker.button('Add emoji').click();
    await vi.waitFor(() => expect(picker.button('Add emoji').getAttribute('aria-pressed')).toBe('true'));
    select.value = 'noto';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await vi.waitFor(() => expect(picker.onSnapshotChange).toHaveBeenLastCalledWith(
      { pack: 'noto', packVersion: '15.1.0' }, null,
    ));
  });

  it('distinguishes absent coverage from a failed pack request', async () => {
    const picker = await mount();
    await picker.search('🫎');
    await vi.waitFor(() => expect(picker.container.textContent).toContain('Twemoji doesn’t include this emoji'));
    expect(picker.container.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
    root!.render(createElement(EmojiPicker, {
      ...picker.props,
      catalog: { ...picker.props.catalog, get: async () => { throw new Error('offline'); } },
    }));
    await vi.waitFor(() => expect(picker.container.textContent).toContain('Couldn’t load Twemoji'));
    expect(picker.container.textContent).not.toContain('doesn’t include');
    expect(picker.onPick).not.toHaveBeenCalled();
  });

  it('does not record a failed pick in recents', async () => {
    const picker = await mount({ accepted: false });
    await picker.search('taco');
    await picker.submit();
    await vi.waitFor(() => expect(picker.container.textContent).toContain('This emoji couldn’t be used'));
    await picker.search('');
    await vi.waitFor(() => expect(picker.container.querySelector('[title="Taco"]')).toBeNull());
  });
});
