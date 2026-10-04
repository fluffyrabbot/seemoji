import { createEmojiAssetRef, type EmojiAssetRef } from '../domain/emoji';
import type { PackSnapshot } from '../domain/pack';
import type { EmojiPackCatalog, CatalogResult } from '../ports/emojiPackCatalog';

export function artworkMissingMessage(
  packName: string,
  packVersion: string,
  grapheme: string,
): string {
  return `No ${packName} ${packVersion} artwork exists for ${grapheme}`;
}

export async function remapSource(
  current: EmojiAssetRef,
  target: PackSnapshot,
  catalog: EmojiPackCatalog,
): Promise<CatalogResult<EmojiAssetRef>> {
  const summary = catalog.summaryFor(target.pack);
  const name = summary?.name ?? target.pack;
  const coverage = await catalog.hasGlyph(target, current.codepoint);
  if (!coverage.ok) return coverage;
  if (!coverage.value) {
    return {
      ok: false, kind: 'missing',
      error: artworkMissingMessage(name, target.packVersion, current.grapheme),
    };
  }
  return { ok: true, value: createEmojiAssetRef(current.grapheme, target) };
}
