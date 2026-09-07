import { describe, expect, it, vi } from 'vitest';
import { editorReducer, INITIAL_EDITOR_STATE, type EditorAction } from './editor';
import { DEFAULT_DESIGN, getEmojiLayer, type DesignDocument } from '../domain/design';
import type { PackSnapshot, PackSummary } from '../domain/pack';
import type { EmojiPackCatalog } from '../ports/emojiPackCatalog';
import type { PackPreferenceStore } from '../ports/packPreference';
import { PackSession, resolvePackPreference } from './packSession';

const SUMMARY: PackSummary = {
  id: 'twemoji',
  name: 'Twemoji',
  versions: [
    { version: '15.1.0', styles: [], defaultStyle: null },
    { version: '16.0.0', styles: ['color', 'flat'], defaultStyle: 'color' },
  ],
  defaultVersion: '16.0.0',
  license: {
    spdx: 'CC-BY-4.0', attribution: 'Twemoji', shareAlike: false, noticeUrl: 'https://license.test',
  },
  unicodeLevel: '16.0',
};

const preference = (): PackPreferenceStore => ({
  read: async () => null,
  write: vi.fn(async () => undefined),
});

const catalog = (hasGlyph: EmojiPackCatalog['hasGlyph']): EmojiPackCatalog => ({
  list: async () => ({ ok: true, value: [SUMMARY] }),
  get: async () => ({ ok: false, error: 'unused' }),
  hasGlyph,
  assetUrl: async () => ({ ok: false, error: 'unused' }),
  summaryFor: () => SUMMARY,
});

class WorkspaceStub {
  acceptsEditorMutations = true;
  projectId = 'project-1';
  epoch = 1;
  editor = { ...INITIAL_EDITOR_STATE, design: DEFAULT_DESIGN };
  readonly dispatches: EditorAction[] = [];

  get design(): DesignDocument { return this.editor.design; }
  set design(design: DesignDocument) { this.editor = { ...this.editor, design }; }

  getSnapshot() {
    return {
      workspace: { activeProject: { id: this.projectId } },
      editor: { design: this.design },
      editorSessionEpoch: this.epoch,
    };
  }

  dispatch(action: EditorAction): void {
    this.dispatches.push(action);
    this.editor = editorReducer(this.editor, action);
  }
}

describe('pack session', () => {
  it('validates an added emoji before inserting it once, selecting it, and recording one undo step', async () => {
    let release!: () => void;
    const validation = new Promise<void>((resolve) => { release = resolve; });
    const workspace = new WorkspaceStub();
    const validateSource = vi.fn(async () => validation);
    const session = new PackSession({
      catalog: catalog(async () => true), preference: preference(), workspace, validateSource,
    });
    const pending = session.pick('😄', { kind: 'add', layerId: 'emoji-2' });
    await vi.waitFor(() => expect(validateSource).toHaveBeenCalledOnce());
    expect(workspace.design).toBe(DEFAULT_DESIGN);
    expect(workspace.dispatches).toEqual([]);
    release();
    await expect(pending).resolves.toEqual({ kind: 'applied' });
    expect(workspace.design.layers).toHaveLength(2);
    expect(workspace.design.layers[0]).toBe(DEFAULT_DESIGN.layers[0]);
    expect(workspace.design.layers[1]).toMatchObject({ id: 'emoji-2', source: { grapheme: '😄' } });
    expect(workspace.editor.selectedLayerIds).toEqual(['emoji-2']);
    expect(workspace.editor.past).toEqual([DEFAULT_DESIGN]);
    expect(workspace.dispatches).toHaveLength(1);
    workspace.dispatch({ type: 'undo' });
    expect(workspace.design).toBe(DEFAULT_DESIGN);
  });

  it('does not insert a placeholder or history entry when added artwork fails validation', async () => {
    const workspace = new WorkspaceStub();
    const session = new PackSession({
      catalog: catalog(async () => true), preference: preference(), workspace,
      validateSource: async () => { throw new Error('Artwork unavailable'); },
    });
    await expect(session.pick('😄', { kind: 'add', layerId: 'emoji-2' })).resolves.toEqual({
      kind: 'rejected', error: 'Artwork unavailable',
    });
    expect(workspace.design).toBe(DEFAULT_DESIGN);
    expect(workspace.editor.past).toEqual([]);
    expect(workspace.dispatches).toEqual([]);
  });

  it.each(['project', 'session', 'superseded', 'busy'] as const)(
    'drops a validated add after its %s fence changes', async (fence) => {
      let release!: () => void;
      const validation = new Promise<void>((resolve) => { release = resolve; });
      const workspace = new WorkspaceStub();
      const validateSource = vi.fn(async () => validation);
      const session = new PackSession({
        catalog: catalog(async () => true), preference: preference(), workspace, validateSource,
      });
      const pending = session.pick('😄', { kind: 'add', layerId: 'emoji-2' });
      await vi.waitFor(() => expect(validateSource).toHaveBeenCalledOnce());
      if (fence === 'project') workspace.projectId = 'project-2';
      if (fence === 'session') workspace.epoch += 1;
      if (fence === 'busy') workspace.acceptsEditorMutations = false;
      if (fence === 'superseded') await session.changeSnapshot({ pack: 'twemoji', packVersion: '16.0.0' }, null);
      release();
      await expect(pending).resolves.toEqual({ kind: 'stale' });
      expect(workspace.design).toBe(DEFAULT_DESIGN);
      expect(workspace.dispatches).toEqual([]);
    },
  );

  it('captures the originating project before initial catalog loading', async () => {
    let release!: () => void;
    const loaded = new Promise<void>((resolve) => { release = resolve; });
    const workspace = new WorkspaceStub();
    const sourceCatalog: EmojiPackCatalog = {
      ...catalog(async () => true),
      list: async () => { await loaded; return { ok: true, value: [SUMMARY] }; },
    };
    const session = new PackSession({
      catalog: sourceCatalog, preference: preference(), workspace, validateSource: async () => undefined,
    });
    const pending = session.pick('😄', { kind: 'add', layerId: 'emoji-2' });
    workspace.projectId = 'project-2';
    release();
    await expect(pending).resolves.toEqual({ kind: 'stale' });
    expect(workspace.dispatches).toEqual([]);
  });

  it('changes the browsing pack without remapping any artwork', async () => {
    const workspace = new WorkspaceStub();
    const store = preference();
    const hasGlyph = vi.fn(async () => true);
    const session = new PackSession({
      catalog: catalog(hasGlyph), preference: store, workspace, validateSource: async () => undefined,
    });
    const target: PackSnapshot = { pack: 'twemoji', packVersion: '16.0.0', style: 'flat' };
    await expect(session.changeSnapshot(target, null)).resolves.toEqual({ kind: 'applied' });
    expect(session.getSnapshot().selected).toEqual(target);
    expect(workspace.design).toBe(DEFAULT_DESIGN);
    expect(workspace.dispatches).toEqual([]);
    expect(hasGlyph).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(store.write).toHaveBeenCalledWith(target));
  });

  it('replaces only the explicit second emoji and can undo the replacement', async () => {
    const workspace = new WorkspaceStub();
    const original = getEmojiLayer(workspace.design);
    workspace.design = { ...workspace.design, layers: [original, { ...original, id: 'emoji-2' }] };
    const before = workspace.design;
    const session = new PackSession({
      catalog: catalog(async () => true), preference: preference(), workspace, validateSource: async () => undefined,
    });
    await expect(session.pick('😄', { kind: 'replace', layerId: 'emoji-2' })).resolves.toEqual({ kind: 'applied' });
    expect(workspace.design.layers[0]).toBe(original);
    expect(workspace.design.layers[1]).toMatchObject({ source: { grapheme: '😄' } });
    expect(workspace.editor.past).toEqual([before]);
    workspace.dispatch({ type: 'undo' });
    expect(workspace.design).toBe(before);
  });

  it('keeps listed versions and normalizes styles within that version', () => {
    expect(resolvePackPreference(
      { pack: 'twemoji', packVersion: '15.1.0', style: 'flat' },
      [SUMMARY],
    )).toEqual({ pack: 'twemoji', packVersion: '15.1.0' });
    expect(resolvePackPreference(
      { pack: 'twemoji', packVersion: '16.0.0', style: 'flat' },
      [SUMMARY],
    )).toEqual({ pack: 'twemoji', packVersion: '16.0.0', style: 'flat' });
    expect(resolvePackPreference(
      { pack: 'twemoji', packVersion: '14.0.0' },
      [SUMMARY],
    )).toEqual({ pack: 'twemoji', packVersion: '16.0.0', style: 'color' });
  });

  it('loads preference without remapping the open design', async () => {
    const workspace = new WorkspaceStub();
    const store: PackPreferenceStore = {
      read: async () => ({ pack: 'twemoji', packVersion: '16.0.0', style: 'flat' }),
      write: async () => undefined,
    };
    const session = new PackSession({
      catalog: catalog(async () => true),
      preference: store,
      workspace,
      validateSource: async () => undefined,
    });
    await expect(session.load()).resolves.toMatchObject({
      status: 'ready',
      selected: { pack: 'twemoji', packVersion: '16.0.0', style: 'flat' },
    });
    expect(workspace.dispatches).toEqual([]);
    expect(getEmojiLayer(workspace.design).source.packVersion).toBe('15.1.0');
  });

  it('creates picker sources through manifest coverage', async () => {
    const workspace = new WorkspaceStub();
    const session = new PackSession({
      catalog: catalog(async (_snapshot, codepoint) => codepoint === '1f600'),
      preference: preference(),
      workspace,
      validateSource: async () => undefined,
    });
    await session.load();
    const layerId = getEmojiLayer(workspace.design).id;
    await expect(session.pick('😀', { kind: 'replace', layerId })).resolves.toEqual({ kind: 'applied' });
    expect(getEmojiLayer(workspace.design).source).toMatchObject({
      grapheme: '😀', pack: 'twemoji', packVersion: '15.1.0',
    });
    await expect(session.pick('A', { kind: 'replace', layerId })).resolves.toEqual({
      kind: 'rejected',
      error: 'No Twemoji 15.1.0 artwork exists for A',
    });
  });

  it('remaps only the captured layer and persists the selected snapshot', async () => {
    const workspace = new WorkspaceStub();
    const store = preference();
    const session = new PackSession({
      catalog: catalog(async () => true),
      preference: store,
      workspace,
      validateSource: async () => undefined,
    });
    await session.load();
    await expect(session.changeSnapshot(
      { pack: 'twemoji', packVersion: '16.0.0', style: 'flat' },
      getEmojiLayer(workspace.design).id,
    )).resolves.toEqual({ kind: 'applied' });
    expect(store.write).toHaveBeenCalledWith({
      pack: 'twemoji', packVersion: '16.0.0', style: 'flat',
    });
    expect(getEmojiLayer(workspace.design).source).toMatchObject({
      packVersion: '16.0.0', style: 'flat',
    });
  });

  it('keeps remapping when preference persistence fails', async () => {
    const workspace = new WorkspaceStub();
    const session = new PackSession({
      catalog: catalog(async () => true),
      preference: {
        read: async () => null,
        write: async () => { throw new Error('storage denied'); },
      },
      workspace,
      validateSource: async () => undefined,
    });
    await session.load();
    await expect(session.changeSnapshot(
      { pack: 'twemoji', packVersion: '16.0.0', style: 'flat' },
      getEmojiLayer(workspace.design).id,
    )).resolves.toEqual({ kind: 'applied' });
  });

  it('drops an async remap after the active project changes', async () => {
    let release!: (covered: boolean) => void;
    const coverage = new Promise<boolean>((resolve) => { release = resolve; });
    const workspace = new WorkspaceStub();
    const session = new PackSession({
      catalog: catalog(async () => coverage),
      preference: preference(),
      workspace,
      validateSource: async () => undefined,
    });
    await session.load();
    const pending = session.changeSnapshot(
      { pack: 'twemoji', packVersion: '16.0.0', style: 'flat' },
      getEmojiLayer(workspace.design).id,
    );
    await Promise.resolve();
    workspace.projectId = 'project-2';
    release(true);
    await expect(pending).resolves.toEqual({ kind: 'stale' });
    expect(workspace.dispatches).toEqual([]);
  });

  it('drops a validated pick when its editor session becomes stale', async () => {
    let releaseValidation!: () => void;
    const validation = new Promise<void>((resolve) => { releaseValidation = resolve; });
    const workspace = new WorkspaceStub();
    const validateSource = vi.fn(async () => validation);
    const session = new PackSession({
      catalog: catalog(async () => true),
      preference: preference(),
      workspace,
      validateSource,
    });
    await session.load();
    const pending = session.pick('😄', { kind: 'replace', layerId: getEmojiLayer(workspace.design).id });
    await vi.waitFor(() => expect(validateSource).toHaveBeenCalledOnce());
    workspace.epoch += 1;
    releaseValidation();
    await expect(pending).resolves.toEqual({ kind: 'stale' });
    expect(workspace.dispatches).toEqual([]);
  });

  it('lets an immediate styled pick supersede its in-flight snapshot remap', async () => {
    const requests: Array<{
      readonly snapshot: PackSnapshot;
      readonly codepoint: string;
      readonly release: (covered: boolean) => void;
    }> = [];
    const hasGlyph = vi.fn(async (snapshot: PackSnapshot, codepoint: string) =>
      new Promise<boolean>((release) => requests.push({ snapshot, codepoint, release })));
    const workspace = new WorkspaceStub();
    const store = preference();
    const session = new PackSession({
      catalog: catalog(hasGlyph),
      preference: store,
      workspace,
      validateSource: async () => undefined,
    });
    await session.load();
    const layerId = getEmojiLayer(workspace.design).id;
    const target: PackSnapshot = {
      pack: 'twemoji', packVersion: '16.0.0', style: 'flat',
    };

    const changing = session.changeSnapshot(target, layerId);
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    const picking = session.pick('👍🏻', { kind: 'replace', layerId });
    await vi.waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[1]).toMatchObject({
      snapshot: target,
      codepoint: '1f44d-1f3fb',
    });

    requests[1]!.release(true);
    await expect(picking).resolves.toEqual({ kind: 'applied' });
    requests[0]!.release(true);
    await expect(changing).resolves.toEqual({ kind: 'stale' });
    expect(getEmojiLayer(workspace.design).source).toMatchObject({
      grapheme: '👍🏻',
      packVersion: '16.0.0',
      style: 'flat',
    });
    expect(workspace.dispatches).toHaveLength(1);
    await vi.waitFor(() => expect(store.write).toHaveBeenCalledWith(target));
  });

  it('lets only the latest selector request commit', async () => {
    const releases: Array<(covered: boolean) => void> = [];
    const hasGlyph = vi.fn(async () => new Promise<boolean>((resolve) => releases.push(resolve)));
    const workspace = new WorkspaceStub();
    const session = new PackSession({
      catalog: catalog(hasGlyph),
      preference: preference(),
      workspace,
      validateSource: async () => undefined,
    });
    await session.load();
    const target: PackSnapshot = {
      pack: 'twemoji', packVersion: '16.0.0', style: 'flat',
    };
    const first = session.changeSnapshot(target, getEmojiLayer(workspace.design).id);
    await vi.waitFor(() => expect(releases).toHaveLength(1));
    const second = session.changeSnapshot(target, getEmojiLayer(workspace.design).id);
    await vi.waitFor(() => expect(releases).toHaveLength(2));
    releases[1]!(true);
    await expect(second).resolves.toEqual({ kind: 'applied' });
    releases[0]!(true);
    await expect(first).resolves.toEqual({ kind: 'stale' });
    expect(workspace.dispatches).toHaveLength(1);
  });
});
