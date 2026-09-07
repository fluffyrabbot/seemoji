import type { EmojiStyle } from '../domain/emojiStyle';

export interface EmojiStyleRecordIssue {
  readonly id: string | null;
  readonly error: string;
}
export interface EmojiStyleCollection {
  readonly styles: readonly EmojiStyle[];
  readonly issues: readonly EmojiStyleRecordIssue[];
}

export class EmojiStyleRepositoryError extends Error {
  readonly kind: 'unavailable' | 'read-failed' | 'write-failed' | 'upgrade-blocked' | 'schema-mismatch' | 'capacity' | 'duplicate';
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
  delete(id: string): Promise<void>;
}
