import { decodeEmojiStyle, EMOJI_STYLE_CAPACITY, EMOJI_STYLE_NAME_LIMIT, emojiStyleNameKey, type EmojiStyle } from './emojiStyle';
import type { DecodeResult } from './designCodec';

export const EMOJI_STYLE_ARCHIVE_MAX_BYTES = 256 * 1024;
export interface EmojiStyleArchiveOmission { readonly id: string | null; readonly error: string }
export interface EmojiStyleArchive {
  readonly format: 'seemoji-styles';
  readonly version: 1;
  readonly exportedAt: number;
  readonly styles: readonly EmojiStyle[];
  readonly omissions: readonly EmojiStyleArchiveOmission[];
}
export type EmojiStyleImportPolicy = 'keep-both' | 'skip-matching';
export interface EmojiStyleImportEntry {
  readonly sourceId: string;
  readonly originalName: string;
  readonly name: string;
  readonly action: 'import' | 'skip';
}
export interface EmojiStyleImportPlan {
  readonly policy: EmojiStyleImportPolicy;
  readonly incomingCount: number;
  readonly importCount: number;
  readonly skippedCount: number;
  readonly renamedCount: number;
  readonly entries: readonly EmojiStyleImportEntry[];
  readonly styles: readonly EmojiStyle[];
  readonly omissions: readonly EmojiStyleArchiveOmission[];
}

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;

export function decodeEmojiStyleArchive(value: unknown): DecodeResult<EmojiStyleArchive> {
  const archive = record(value);
  if (!archive || archive.format !== 'seemoji-styles') return { ok: false, error: 'This file is not a seemoji style backup.' };
  if (archive.version !== 1) return { ok: false, error: 'This style backup version is not supported.' };
  if (!Number.isSafeInteger(archive.exportedAt) || (archive.exportedAt as number) < 0) return { ok: false, error: 'The style backup has an invalid export time.' };
  if (!Array.isArray(archive.styles) || archive.styles.length > EMOJI_STYLE_CAPACITY) return { ok: false, error: `A style backup can contain up to ${EMOJI_STYLE_CAPACITY} styles.` };
  if (!Array.isArray(archive.omissions) || archive.omissions.length > EMOJI_STYLE_CAPACITY + 1) return { ok: false, error: 'The style backup has an invalid omission report.' };
  const ids = new Set<string>();
  const styles: EmojiStyle[] = [];
  for (const [index, raw] of archive.styles.entries()) {
    const decoded = decodeEmojiStyle(raw);
    if (!decoded.ok) return { ok: false, error: `Style ${index + 1}: ${decoded.error}` };
    if (ids.has(decoded.value.id)) return { ok: false, error: 'The style backup contains duplicate identities.' };
    ids.add(decoded.value.id);
    styles.push(decoded.value);
  }
  const omissions: EmojiStyleArchiveOmission[] = [];
  for (const raw of archive.omissions) {
    const omission = record(raw);
    if (!omission || (omission.id !== null && (typeof omission.id !== 'string' || omission.id.length > 100))
      || typeof omission.error !== 'string' || !omission.error || omission.error.length > 500) {
      return { ok: false, error: 'The style backup has an invalid omission report.' };
    }
    omissions.push({ id: omission.id as string | null, error: omission.error });
  }
  return { ok: true, value: { format: 'seemoji-styles', version: 1, exportedAt: archive.exportedAt as number, styles, omissions } };
}

export function parseEmojiStyleArchive(text: string): DecodeResult<EmojiStyleArchive> {
  if (text.length > EMOJI_STYLE_ARCHIVE_MAX_BYTES || new TextEncoder().encode(text).byteLength > EMOJI_STYLE_ARCHIVE_MAX_BYTES) {
    return { ok: false, error: 'Style backups must be 256 KiB or smaller.' };
  }
  try { return decodeEmojiStyleArchive(JSON.parse(text)); }
  catch { return { ok: false, error: 'The style backup is not valid JSON.' }; }
}

export function serializeEmojiStyleArchive(archive: EmojiStyleArchive): DecodeResult<string> {
  const decoded = decodeEmojiStyleArchive(archive);
  if (!decoded.ok) return decoded;
  const encoded = JSON.stringify(decoded.value, null, 2);
  return new TextEncoder().encode(encoded).byteLength <= EMOJI_STYLE_ARCHIVE_MAX_BYTES
    ? { ok: true, value: encoded } : { ok: false, error: 'Style backups must be 256 KiB or smaller.' };
}

/** Canonical persisted state is small and bounded, so compare it without a lossy hash. */
export const emojiStyleSnapshotKey = (styles: readonly EmojiStyle[]): string =>
  JSON.stringify([...styles].sort((left, right) => left.id.localeCompare(right.id)));

export function planEmojiStyleImport(archive: EmojiStyleArchive, existing: readonly EmojiStyle[], policy: EmojiStyleImportPolicy): DecodeResult<EmojiStyleImportPlan> {
  if (policy !== 'keep-both' && policy !== 'skip-matching') return { ok: false, error: 'Choose Keep both or Skip matching names.' };
  const names = new Set(existing.map(({ name }) => emojiStyleNameKey(name)));
  const entries: EmojiStyleImportEntry[] = [];
  const styles: EmojiStyle[] = [];
  let skippedCount = 0;
  let renamedCount = 0;
  for (const source of archive.styles) {
    const duplicate = names.has(emojiStyleNameKey(source.name));
    if (duplicate && policy === 'skip-matching') {
      entries.push({ sourceId: source.id, originalName: source.name, name: source.name, action: 'skip' });
      skippedCount += 1;
      continue;
    }
    let name = source.name;
    if (duplicate) {
      for (let suffix = 2; names.has(emojiStyleNameKey(name)); suffix += 1) {
        const ending = ` (${suffix})`;
        name = `${source.name.slice(0, EMOJI_STYLE_NAME_LIMIT - ending.length).trimEnd()}${ending}`;
      }
      renamedCount += 1;
    }
    names.add(emojiStyleNameKey(name));
    entries.push({ sourceId: source.id, originalName: source.name, name, action: 'import' });
    styles.push({ ...source, name });
  }
  if (existing.length + styles.length > EMOJI_STYLE_CAPACITY) return { ok: false,
    error: `This import would exceed ${EMOJI_STYLE_CAPACITY} saved styles. Choose Skip matching names or delete styles, then preview again.`,
  };
  return { ok: true, value: { policy, incomingCount: archive.styles.length, importCount: styles.length,
    skippedCount, renamedCount, entries, styles, omissions: archive.omissions,
  } };
}
