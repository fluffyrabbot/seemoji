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
  design: DesignDocument = DEFAULT_DESIGN;
  readonly dispatches: EditorAction[] = [];

  getSnapshot() {
    return {
      workspace: { activeProject: { id: this.projectId } },
      editor: { design: this.design },
      editorSessionEpoch: this.epoch,
    };
  }

  dispatch(action: EditorAction): void {
    this.dispatches.push(action);
    this.design = editorReducer({ ...INITIAL_EDITOR_STATE, design: this.design }, action).design;
  }
}

describe('pack session', () => {
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
    await expect(session.pick('😀', layerId)).resolves.toEqual({ kind: 'applied' });
    expect(getEmojiLayer(workspace.design).source).toMatchObject({
      grapheme: '😀', pack: 'twemoji', packVersion: '15.1.0',
    });
    await expect(session.pick('A', layerId)).resolves.toEqual({
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
    const pending = session.pick('😄', getEmojiLayer(workspace.design).id);
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
    const picking = session.pick('👍🏻', layerId);
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
