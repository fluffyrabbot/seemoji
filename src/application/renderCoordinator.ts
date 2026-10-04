import type { DesignDocument } from '../domain/design';
import type { EmojiAssetRef } from '../domain/emoji';
import { createEmojiRenderPlan, createLayerMatrix } from '../domain/renderPlan';
import type { EmojiAssetSource } from '../ports/emojiAssetSource';
import type { RenderedFrame, RendererPort } from '../ports/renderer';

import { WeightedCache } from './weightedCache';
import { renderKey, layerRenderKey } from './renderIdentity';

export class RenderCoordinator {
  readonly #frames = new WeightedCache<string, Promise<RenderedFrame>>(16 * 1024 * 1024);
  readonly #pngs = new WeightedCache<string, Promise<Blob>>(8 * 1024 * 1024);
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
    const key = renderKey(design, size);
    const existing = this.#frames.get(key);
    if (existing) {
      return existing;
    }
    const pending = Promise.all(
      design.layers.filter((layer) => layer.visible && layer.opacity > 0).map(async (layer) => {
        if (layer.kind === 'emoji') {
          return {
            kind: 'emoji' as const,
            asset: await this.#assets.load(layer.source),
            plan: createEmojiRenderPlan(layer, size),
            opacity: layer.opacity,
            mask: layer.mask,
            cacheKey: layerRenderKey(layer, size),
          };
        }
        const common = {
          visible: layer.visible,
          opacity: layer.opacity,
          matrix: createLayerMatrix(layer.transform, size),
          mask: layer.mask,
          cacheKey: layerRenderKey(layer, size),
        };
        if (layer.kind === 'strokes') return { kind: 'strokes' as const, ...common, strokes: layer.strokes };
        if (layer.kind === 'shape') return { kind: 'shape' as const, ...common, shape: layer.shape,
          bounds: layer.bounds, fill: layer.fill, stroke: layer.stroke };
        if (layer.kind === 'text') return { kind: 'text' as const, ...common, bounds: layer.bounds,
          ...(layer.bubble ? { bubble: layer.bubble } : {}), text: layer.text, fontSize: layer.fontSize, color: layer.color,
          fontFamily: layer.fontFamily, align: layer.align };
        return { kind: 'raster' as const, ...common, resolution: layer.resolution, runs: layer.runs };
      }),
    )
      .then((layers) => this.#renderer.render({ size, layers, layout: design.canvas.layout }))
      .catch((cause: unknown) => {
        if (this.#frames.get(key) === pending) this.#frames.delete(key);
        throw cause;
      });
    this.#frames.set(key, pending, size * size * 4);
    return pending;
  }

  png(design: DesignDocument, size: number): Promise<Blob> {
    const key = renderKey(design, size);
    const existing = this.#pngs.get(key);
    if (existing) {
      return existing;
    }
    const pending = this.render(design, size)
      .then((frame) => this.#renderer.toPng(frame))
      .catch((cause: unknown) => {
        if (this.#pngs.get(key) === pending) this.#pngs.delete(key);
        throw cause;
      });
    this.#pngs.set(key, pending, size * size * 4);
    return pending;
  }
}
