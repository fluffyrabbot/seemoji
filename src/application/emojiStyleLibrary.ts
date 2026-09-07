import type { EmojiLayer } from '../domain/design';
import { createEmojiStyle, type EmojiStyle } from '../domain/emojiStyle';
import type { EmojiStyleRecordIssue, EmojiStyleRepository } from '../ports/emojiStyleRepository';

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
  readonly #listeners = new Set<() => void>();
  #tail: Promise<unknown> = Promise.resolve();
  #pending = 0;
  #snapshot: EmojiStyleLibrarySnapshot = { status: 'idle', busy: false, styles: [], issues: [], error: null };

  constructor(repository: EmojiStyleRepository, options: { readonly createId?: () => string; readonly now?: () => number } = {}) {
    this.#repository = repository;
    this.#createId = options.createId ?? (() => crypto.randomUUID());
    this.#now = options.now ?? Date.now;
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
        this.#publish({ ...collection, status: 'ready', error: null });
      } catch (cause) {
        this.#publish({ status: 'error', error: message(cause, 'Saved styles could not be loaded. Please try again.') });
      }
    });
  }

  save(name: string, layer: EmojiLayer): Promise<boolean> {
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
