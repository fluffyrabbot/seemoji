import type { EmojiAssetRef } from '../domain/emoji';
import type {
  PackId,
  PackManifest,
  PackSnapshot,
  PackSummary,
} from '../domain/pack';

export type CatalogFailureKind = 'missing' | 'unavailable' | 'invalid';
export type CatalogResult<T> = { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly kind: CatalogFailureKind; readonly error: string };

export interface EmojiPackCatalog {
  list(): Promise<CatalogResult<readonly PackSummary[]>>;
  get(snapshot: PackSnapshot): Promise<CatalogResult<PackManifest>>;
  hasGlyph(snapshot: PackSnapshot, codepoint: string): Promise<CatalogResult<boolean>>;
  assetUrl(ref: EmojiAssetRef): Promise<CatalogResult<URL>>;
  summaryFor(pack: PackId): PackSummary | null;
}
