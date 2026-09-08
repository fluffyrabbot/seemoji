import type { EmojiStyle } from '../domain/emojiStyle';

export interface EmojiStyleRecordIssue {
  readonly id: string | null;
  readonly error: string;
  /** Opaque local capability; absent for collection-level issues and never exported. */
  readonly recoveryToken?: string;
}
export interface EmojiStyleCollection {
  readonly styles: readonly EmojiStyle[];
  readonly issues: readonly EmojiStyleRecordIssue[];
}

export class EmojiStyleRepositoryError extends Error {
  readonly kind: 'unavailable' | 'read-failed' | 'write-failed' | 'upgrade-blocked' | 'schema-mismatch' | 'capacity' | 'duplicate' | 'conflict' | 'corrupt';
  constructor(message: string, kind: EmojiStyleRepositoryError['kind'], options?: ErrorOptions) {
    super(message, options);
    this.name = 'EmojiStyleRepositoryError';
    this.kind = kind;
  }
}

/** Immutable records: create never overwrites, and delete targets only that identity. */
export interface EmojiStyleRepository {
  load(): Promise<EmojiStyleCollection>;
  create(style: EmojiStyle): Promise<EmojiStyle>;
  /** Insert the whole batch only if the complete persisted library still matches the preview. */
  importStyles(styles: readonly EmojiStyle[], expected: readonly EmojiStyle[]): Promise<readonly EmojiStyle[]>;
  /** Delete only the unreadable record observed when this token was issued. */
  removeUnreadable(recoveryToken: string): Promise<void>;
  delete(id: string): Promise<void>;
}
