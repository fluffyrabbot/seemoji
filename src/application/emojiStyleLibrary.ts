import type { EmojiLayer } from '../domain/design';
import { createEmojiStyle, decodeEmojiStyle, type EmojiStyle } from '../domain/emojiStyle';
import {
  emojiStyleSnapshotKey, parseEmojiStyleArchive, planEmojiStyleImport, serializeEmojiStyleArchive,
  type EmojiStyleArchive, type EmojiStyleImportPlan, type EmojiStyleImportPolicy,
} from '../domain/emojiStyleArchive';
import type { EmojiStyleRecordIssue, EmojiStyleRepository } from '../ports/emojiStyleRepository';
import type { FileExportPort } from '../ports/clipboard';

export type { EmojiStyleImportPolicy } from '../domain/emojiStyleArchive';
export interface EmojiStyleArchiveExport {
  readonly styleCount: number;
  readonly omittedCount: number;
  readonly issues: readonly EmojiStyleRecordIssue[];
}
export interface EmojiStyleImportPreview extends Omit<EmojiStyleImportPlan, 'styles'> { readonly id: string }
export interface EmojiStyleImportResult {
  readonly importedCount: number;
  readonly skippedCount: number;
  readonly renamedCount: number;
}

export interface EmojiStyleLibrarySnapshot {
  readonly status: 'idle' | 'loading' | 'ready' | 'error';
  readonly busy: boolean;
  readonly styles: readonly EmojiStyle[];
  readonly issues: readonly EmojiStyleRecordIssue[];
  readonly error: string | null;
}

/** One ordered operation stream prevents late reads from replacing accepted writes. */
export class EmojiStyleLibrary {
  readonly #repository: EmojiStyleRepository;
  readonly #createId: () => string;
  readonly #now: () => number;
  readonly #fileExport: FileExportPort | undefined;
  readonly #listeners = new Set<() => void>();
  #tail: Promise<unknown> = Promise.resolve();
  #pending = 0;
  #previewGeneration = 0;
  #preview: { readonly value: EmojiStyleImportPreview; readonly archive: EmojiStyleArchive;
    readonly plan: EmojiStyleImportPlan; readonly expected: readonly EmojiStyle[] } | null = null;
  #previewInvalidation = 'This import preview expired. Preview the file again.';
  #snapshot: EmojiStyleLibrarySnapshot = { status: 'idle', busy: false, styles: [], issues: [], error: null };

  constructor(repository: EmojiStyleRepository, options: { readonly createId?: () => string; readonly now?: () => number; readonly fileExport?: FileExportPort } = {}) {
    this.#repository = repository;
    this.#createId = options.createId ?? (() => crypto.randomUUID());
    this.#now = options.now ?? Date.now;
    this.#fileExport = options.fileExport;
  }

  getSnapshot = (): EmojiStyleLibrarySnapshot => this.#snapshot;
  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  load(): Promise<void> {
    return this.#schedule(async () => {
      try {
        const collection = await this.#repository.load();
        if (this.#preview && (collection.issues.length || emojiStyleSnapshotKey(collection.styles) !== emojiStyleSnapshotKey(this.#preview.expected))) {
          this.cancelImport();
          this.#previewInvalidation = 'The saved style library changed after this preview. Preview the import again.';
        }
        this.#publish({ ...collection, status: 'ready', error: null });
      } catch (cause) {
        this.#publish({ status: 'error', error: message(cause, 'Saved styles could not be loaded. Please try again.') });
      }
    });
  }

  save(name: string, layer: EmojiLayer): Promise<boolean> {
    this.cancelImport();
    // Capture the selected object's look before any queued storage operation waits.
    const captured = createEmojiStyle(this.#createId(), name, this.#now(), layer);
    return this.#schedule(async () => {
      if (!captured.ok) { this.#publish({ status: 'error', error: captured.error }); return false; }
      try {
        const saved = await this.#repository.create(captured.value);
        this.#publish({ status: 'ready', error: null, styles: [saved, ...this.#snapshot.styles.filter((style) => style.id !== saved.id)] });
        await this.#refreshAfterMutation('Style saved, but the library could not be refreshed.');
        return true;
      } catch (cause) {
        this.#publish({ status: 'error', error: message(cause, 'The style could not be saved. Please try again.') });
        return false;
      }
    });
  }

  remove(id: string): Promise<boolean> {
    this.cancelImport();
    return this.#schedule(async () => {
      try {
        await this.#repository.delete(id);
        this.#publish({ status: 'ready', error: null,
          styles: this.#snapshot.styles.filter((style) => style.id !== id),
          issues: this.#snapshot.issues.filter((issue) => issue.id !== id),
        });
        await this.#refreshAfterMutation('Style deleted, but the library could not be refreshed.');
        return true;
      } catch (cause) {
        this.#publish({ status: 'error', error: message(cause, 'The style could not be deleted. Please try again.') });
        return false;
      }
    });
  }

  removeUnreadable(recoveryToken: string): Promise<boolean> {
    this.cancelImport();
    return this.#schedule(async () => {
      try {
        await this.#repository.removeUnreadable(recoveryToken);
        this.#publish({ status: 'ready', error: null,
          issues: this.#snapshot.issues.filter((issue) => issue.recoveryToken !== recoveryToken),
        });
        await this.#refreshAfterMutation('Unreadable style deleted, but the library could not be refreshed.');
        return true;
      } catch (cause) {
        // A repaired or replaced record must remain visible after a stale recovery action.
        try { this.#publish({ ...await this.#repository.load() }); } catch { /* Preserve the recovery error. */ }
        this.#publish({ status: 'error', error: message(cause, 'The unreadable style could not be deleted. Refresh and try again.') });
        return false;
      }
    });
  }

  exportArchive(): Promise<EmojiStyleArchiveExport | null> {
    return this.#schedule(async () => {
      try {
        const collection = await this.#repository.load();
        this.#publish({ ...collection, status: 'ready', error: null });
        const omissions = collection.issues.map((issue) => ({
          id: issue.id !== null && issue.id.length <= 100 ? issue.id : null,
          error: `${issue.error}${issue.id !== null && issue.id.length > 100 ? ' The unreadable record identity was too long to include.' : ''}`.slice(0, 500),
        }));
        const serialized = serializeEmojiStyleArchive({ format: 'seemoji-styles', version: 1,
          exportedAt: this.#now(), styles: collection.styles, omissions,
        });
        if (!serialized.ok) throw new Error(serialized.error);
        if (!this.#fileExport) throw new Error('Style backup downloads are unavailable in this workspace.');
        this.#fileExport.download(new Blob([serialized.value], { type: 'application/json' }), 'seemoji-styles.json');
        return { styleCount: collection.styles.length, omittedCount: collection.issues.length, issues: omissions };
      } catch (cause) {
        this.#publish({ status: 'error', error: message(cause, 'The style backup could not be downloaded. Please try again.') });
        return null;
      }
    });
  }

  prepareImport(text: string, policy: EmojiStyleImportPolicy): Promise<EmojiStyleImportPreview | null> {
    this.cancelImport();
    const generation = this.#previewGeneration;
    const parsed = parseEmojiStyleArchive(text);
    return this.#schedule(async () => {
      if (generation !== this.#previewGeneration) return null;
      if (!parsed.ok) { this.#publish({ status: 'error', error: parsed.error }); return null; }
      try {
        const collection = await this.#repository.load();
        if (generation !== this.#previewGeneration) return null;
        this.#publish({ ...collection, status: 'ready', error: null });
        if (collection.issues.length) throw new Error('The saved style library contains unreadable records. Export the readable styles and repair the unreadable records before importing.');
        const planned = planEmojiStyleImport(parsed.value, collection.styles, policy);
        if (!planned.ok) throw new Error(planned.error);
        const { styles: _styles, ...details } = planned.value;
        const preview: EmojiStyleImportPreview = { ...details, id: `style-import-${generation}` };
        this.#preview = { value: preview, archive: parsed.value, plan: planned.value, expected: collection.styles };
        return preview;
      } catch (cause) {
        if (generation === this.#previewGeneration) this.#publish({ status: 'error', error: message(cause, 'The style import could not be previewed. Please try again.') });
        return null;
      }
    });
  }

  cancelImport(): void {
    this.#previewGeneration += 1;
    this.#preview = null;
    this.#previewInvalidation = 'This import preview expired. Preview the file again.';
  }

  importPreview(id: string): Promise<EmojiStyleImportResult | null> {
    const preview = this.#preview;
    return this.#schedule(async () => {
      if (!preview || preview !== this.#preview || preview.value.id !== id) {
        this.#publish({ status: 'error', error: this.#previewInvalidation });
        return null;
      }
      this.cancelImport();
      try {
        const identities = new Set([...preview.expected, ...preview.archive.styles].map((style) => style.id));
        const incoming = preview.plan.styles.map((style) => {
          const identity = this.#createId();
          if (identities.has(identity)) throw new Error('A fresh style identity could not be generated. No styles were imported. Preview and try again.');
          identities.add(identity);
          const decoded = decodeEmojiStyle({ ...style, id: identity });
          if (!decoded.ok) throw new Error(`A fresh style identity could not be generated: ${decoded.error}`);
          return decoded.value;
        });
        const imported = await this.#repository.importStyles(incoming, preview.expected);
        this.#publish({ status: 'ready', error: null, styles: [...imported, ...this.#snapshot.styles] });
        await this.#refreshAfterMutation('Styles imported, but the library could not be refreshed.');
        return { importedCount: imported.length, skippedCount: preview.plan.skippedCount, renamedCount: preview.plan.renamedCount };
      } catch (cause) {
        // Recover the visible collection after a concurrent writer invalidates a preview.
        try { this.#publish({ ...await this.#repository.load() }); } catch { /* Preserve the import error. */ }
        this.#publish({ status: 'error', error: message(cause, 'The style import failed. No styles were imported. Preview and try again.') });
        return null;
      }
    });
  }

  async #refreshAfterMutation(fallback: string): Promise<void> {
    try { this.#publish({ ...await this.#repository.load(), error: null }); }
    catch { this.#publish({ error: `${fallback} Use Refresh to try again.` }); }
  }

  #schedule<T>(operation: () => Promise<T>): Promise<T> {
    this.#pending += 1;
    this.#publish({ busy: true, ...(this.#snapshot.status === 'idle' ? { status: 'loading' as const } : {}) });
    const result = this.#tail.then(operation);
    this.#tail = result.catch(() => undefined);
    return result.finally(() => {
      this.#pending -= 1;
      this.#publish({ busy: this.#pending > 0 });
    });
  }

  #publish(patch: Partial<EmojiStyleLibrarySnapshot>): void {
    this.#snapshot = { ...this.#snapshot, ...patch };
    for (const listener of this.#listeners) listener();
  }
}

const message = (cause: unknown, fallback: string): string => cause instanceof Error ? cause.message : fallback;
