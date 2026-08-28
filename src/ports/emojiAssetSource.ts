import type { EmojiAssetRef } from '../domain/emoji';

export interface EmojiAssetSource {
  load(ref: EmojiAssetRef): Promise<CanvasImageSource>;
}
