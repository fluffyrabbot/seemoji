import type { DecodeResult } from '../domain/designCodec';
import type { EmojiAssetRef } from '../domain/emoji';
import type {
  PackId,
  PackManifest,
  PackSnapshot,
  PackSummary,
} from '../domain/pack';

export interface EmojiPackCatalog {
  list(): Promise<DecodeResult<readonly PackSummary[]>>;
  get(snapshot: PackSnapshot): Promise<DecodeResult<PackManifest>>;
  hasGlyph(snapshot: PackSnapshot, codepoint: string): Promise<boolean>;
  assetUrl(ref: EmojiAssetRef): Promise<DecodeResult<URL>>;
  summaryFor(pack: PackId): PackSummary | null;
}
