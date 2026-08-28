import type { DesignDocument } from '../domain/design';
import type { EmojiAssetRef } from '../domain/emoji';
import { createRenderPlan } from '../domain/renderPlan';
import type { EmojiAssetSource } from '../ports/emojiAssetSource';
import type { RenderedFrame, RendererPort } from '../ports/renderer';

const MAX_FRAME_CACHE = 24;
const MAX_PNG_CACHE = 12;

const cacheKey = (design: DesignDocument, size: number): string =>
  `${size}:${JSON.stringify(design)}`;

const setLru = <T>(map: Map<string, T>, key: string, value: T, maximum: number) => {
  map.delete(key);
  map.set(key, value);
  while (map.size > maximum) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
};

export class RenderCoordinator {
  readonly #frames = new Map<string, Promise<RenderedFrame>>();
  readonly #pngs = new Map<string, Promise<Blob>>();
  readonly #assets: EmojiAssetSource;
  readonly #renderer: RendererPort;

  constructor(assets: EmojiAssetSource, renderer: RendererPort) {
    this.#assets = assets;
    this.#renderer = renderer;
  }

  async validateSource(source: EmojiAssetRef): Promise<void> {
    await this.#assets.load(source);
  }

  render(design: DesignDocument, size: number): Promise<RenderedFrame> {
    const key = cacheKey(design, size);
    const existing = this.#frames.get(key);
    if (existing) {
      setLru(this.#frames, key, existing, MAX_FRAME_CACHE);
      return existing;
    }
    const pending = this.#assets
      .load(design.source)
      .then((asset) => this.#renderer.render(asset, createRenderPlan(design, size)))
      .catch((cause: unknown) => {
        this.#frames.delete(key);
        throw cause;
      });
    setLru(this.#frames, key, pending, MAX_FRAME_CACHE);
    return pending;
  }

  png(design: DesignDocument, size: number): Promise<Blob> {
    const key = cacheKey(design, size);
    const existing = this.#pngs.get(key);
    if (existing) {
      setLru(this.#pngs, key, existing, MAX_PNG_CACHE);
      return existing;
    }
    const pending = this.render(design, size)
      .then((frame) => this.#renderer.toPng(frame))
      .catch((cause: unknown) => {
        this.#pngs.delete(key);
        throw cause;
      });
    setLru(this.#pngs, key, pending, MAX_PNG_CACHE);
    return pending;
  }
}
