import type { EditorAction } from './editor';
import { getLayer, type DesignDocument } from '../domain/design';
import { createEmojiAssetRef, toCodepoint, type EmojiAssetRef } from '../domain/emoji';
import {
  DEFAULT_PACK_SNAPSHOT,
  type PackSnapshot,
  type PackSummary,
  type PackVersionSummary,
} from '../domain/pack';
import type { EmojiPackCatalog } from '../ports/emojiPackCatalog';
import type { PackPreferenceStore } from '../ports/packPreference';
import { artworkMissingMessage, remapSource } from './remapSource';

export interface PackSessionSnapshot {
  readonly status: 'loading' | 'ready' | 'error';
  readonly selected: PackSnapshot;
  readonly packs: readonly PackSummary[];
  readonly revision: number;
  readonly error: string | null;
}

export type PackOperationResult =
  | { readonly kind: 'applied' }
  | { readonly kind: 'rejected'; readonly error: string }
  | { readonly kind: 'stale' };

interface PackOperation {
  readonly generation: number;
  readonly projectId: string;
  readonly editorSessionEpoch: number;
  readonly layerId: string;
  readonly source: EmojiAssetRef;
}

interface PackWorkspaceSnapshot {
  readonly workspace: { readonly activeProject: { readonly id: string } } | null;
  readonly editor: {
    readonly design: DesignDocument;
  };
  readonly editorSessionEpoch: number;
}

interface PackWorkspace {
  readonly acceptsEditorMutations: boolean;
  getSnapshot(): PackWorkspaceSnapshot;
  dispatch(action: EditorAction): unknown;
}

const versionFor = (
  summary: PackSummary,
  version: string,
): PackVersionSummary | null =>
  summary.versions.find((candidate) => candidate.version === version) ?? null;

const sameSource = (left: EmojiAssetRef, right: EmojiAssetRef): boolean =>
  left.pack === right.pack
  && left.packVersion === right.packVersion
  && left.style === right.style
  && left.codepoint === right.codepoint
  && left.grapheme === right.grapheme;

export const snapshotForPackVersion = (
  summary: PackSummary,
  version: PackVersionSummary,
  preferredStyle: PackSnapshot['style'],
): PackSnapshot => {
  const style = preferredStyle !== undefined && version.styles.includes(preferredStyle)
    ? preferredStyle
    : version.defaultStyle ?? undefined;
  const snapshot: PackSnapshot = { pack: summary.id, packVersion: version.version };
  return style === undefined ? snapshot : { ...snapshot, style };
};

export function resolvePackPreference(
  preference: PackSnapshot | null,
  packs: readonly PackSummary[],
): PackSnapshot {
  if (!preference) return DEFAULT_PACK_SNAPSHOT;
  const summary = packs.find((pack) => pack.id === preference.pack);
  if (!summary) return DEFAULT_PACK_SNAPSHOT;
  const version = versionFor(summary, preference.packVersion)
    ?? versionFor(summary, summary.defaultVersion);
  return version
    ? snapshotForPackVersion(summary, version, preference.style)
    : DEFAULT_PACK_SNAPSHOT;
}

export class PackSession {
  readonly #catalog: EmojiPackCatalog;
  readonly #preference: PackPreferenceStore;
  readonly #workspace: PackWorkspace;
  readonly #validateSource: (source: EmojiAssetRef) => Promise<void>;
  readonly #listeners = new Set<() => void>();
  #snapshot: PackSessionSnapshot = {
    status: 'loading',
    selected: DEFAULT_PACK_SNAPSHOT,
    packs: [],
    revision: 0,
    error: null,
  };
  #loadRequest: Promise<PackSessionSnapshot> | null = null;
  #operationGeneration = 0;
  #preferenceWrites: Promise<void> = Promise.resolve();

  constructor(options: {
    readonly catalog: EmojiPackCatalog;
    readonly preference: PackPreferenceStore;
    readonly workspace: PackWorkspace;
    readonly validateSource: (source: EmojiAssetRef) => Promise<void>;
  }) {
    this.#catalog = options.catalog;
    this.#preference = options.preference;
    this.#workspace = options.workspace;
    this.#validateSource = options.validateSource;
  }

  getSnapshot = (): PackSessionSnapshot => this.#snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  load(): Promise<PackSessionSnapshot> {
    if (this.#loadRequest) return this.#loadRequest;
    this.#loadRequest = Promise.all([
      this.#catalog.list().catch((cause: unknown) => ({
        ok: false as const,
        error: cause instanceof Error ? cause.message : String(cause),
      })),
      this.#preference.read().catch(() => null),
    ])
      .then(([catalog, preference]) => {
        if (!catalog.ok) {
          this.#set({
            status: 'error',
            selected: DEFAULT_PACK_SNAPSHOT,
            packs: [],
            revision: this.#snapshot.revision + 1,
            error: catalog.error,
          });
          return this.#snapshot;
        }
        this.#set({
          status: 'ready',
          selected: resolvePackPreference(preference, catalog.value),
          packs: catalog.value,
          revision: this.#snapshot.revision + 1,
          error: null,
        });
        return this.#snapshot;
      });
    return this.#loadRequest;
  }

  async pick(grapheme: string, layerId: string): Promise<PackOperationResult> {
    await this.load();
    const operation = this.#beginOperation(layerId);
    if (!operation) return { kind: 'stale' };
    const selected = this.#snapshot.selected;
    let covered: boolean;
    try {
      covered = await this.#catalog.hasGlyph(selected, toCodepoint(grapheme));
    } catch (cause) {
      return this.#rejectCurrent(operation, cause);
    }
    if (!this.#isCurrent(operation)) return { kind: 'stale' };
    if (!covered) {
      const name = this.#catalog.summaryFor(selected.pack)?.name ?? selected.pack;
      return {
        kind: 'rejected',
        error: artworkMissingMessage(name, selected.packVersion, grapheme),
      };
    }
    const source = createEmojiAssetRef(grapheme, selected);
    try {
      await this.#validateSource(source);
    } catch (cause) {
      return this.#rejectCurrent(operation, cause);
    }
    if (!this.#isCurrent(operation)) return { kind: 'stale' };
    this.#workspace.dispatch({ type: 'set-emoji-source', layerId, source });
    return { kind: 'applied' };
  }

  async changeSnapshot(
    requested: PackSnapshot,
    layerId: string,
  ): Promise<PackOperationResult> {
    await this.load();
    const target = resolvePackPreference(requested, this.#snapshot.packs);
    const operation = this.#beginOperation(layerId);
    if (!operation) return { kind: 'stale' };

    this.#set({
      ...this.#snapshot,
      selected: target,
      revision: this.#snapshot.revision + 1,
    });
    this.#preferenceWrites = this.#preferenceWrites
      .catch(() => undefined)
      .then(() => this.#preference.write(target))
      .catch(() => undefined);
    let remapped;
    try {
      remapped = await remapSource(operation.source, target, this.#catalog);
    } catch (cause) {
      return this.#rejectCurrent(operation, cause);
    }
    if (!this.#isCurrent(operation)) return { kind: 'stale' };
    if (!remapped.ok) return { kind: 'rejected', error: remapped.error };
    try {
      await this.#validateSource(remapped.value);
    } catch (cause) {
      return this.#rejectCurrent(operation, cause);
    }
    if (!this.#isCurrent(operation)) return { kind: 'stale' };
    this.#workspace.dispatch({
      type: 'set-emoji-source',
      layerId,
      source: remapped.value,
    });
    return { kind: 'applied' };
  }

  #beginOperation(layerId: string): PackOperation | null {
    const generation = ++this.#operationGeneration;
    const requested = this.#workspace.getSnapshot();
    const projectId = requested.workspace?.activeProject.id;
    const layer = getLayer(requested.editor.design, layerId);
    if (!projectId || !this.#workspace.acceptsEditorMutations || layer?.kind !== 'emoji') return null;
    return {
      generation,
      projectId,
      editorSessionEpoch: requested.editorSessionEpoch,
      layerId,
      source: layer.source,
    };
  }

  #isCurrent(operation: PackOperation): boolean {
    const current = this.#workspace.getSnapshot();
    const layer = getLayer(current.editor.design, operation.layerId);
    return operation.generation === this.#operationGeneration
      && this.#workspace.acceptsEditorMutations
      && current.workspace?.activeProject.id === operation.projectId
      && current.editorSessionEpoch === operation.editorSessionEpoch
      && layer?.kind === 'emoji'
      && sameSource(layer.source, operation.source);
  }

  #rejectCurrent(operation: PackOperation, cause: unknown): PackOperationResult {
    return this.#isCurrent(operation)
      ? { kind: 'rejected', error: cause instanceof Error ? cause.message : String(cause) }
      : { kind: 'stale' };
  }

  #set(snapshot: PackSessionSnapshot): void {
    this.#snapshot = snapshot;
    for (const listener of this.#listeners) listener();
  }
}
