import type { DesignDocument, LayerBounds, TextLayer } from './design';
import { comicPanels } from './canvasLayout';
import { layerWorldBounds, worldPointToLayerLocal } from './sceneGeometry';
import { setTextBubble, type BubbleKind } from './textBubble';

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const contains = (box: LayerBounds, point: { x: number; y: number }) => point.x >= box.x && point.x <= box.x + box.width
  && point.y >= box.y && point.y <= box.y + box.height;
const center = (layer: Parameters<typeof layerWorldBounds>[0]) => {
  const box = layerWorldBounds(layer);
  return { x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2 };
};

/** Initial placement only: subsequent style changes preserve the user's geometry. */
export function placeTextBubble(layer: TextLayer, kind: BubbleKind | 'plain', design: DesignDocument): TextLayer {
  if (kind === 'plain' || layer.bubble) return setTextBubble(layer, kind);
  const origin = center(layer);
  const panels = comicPanels(design.canvas.layout);
  const distance = (panel: LayerBounds) => Math.hypot(origin.x - clamp(origin.x, panel.x, panel.x + panel.width),
    origin.y - clamp(origin.y, panel.y, panel.y + panel.height));
  const panel = [...panels].sort((a, b) => distance(a) - distance(b))[0];
  const region = panel ?? { x: 0, y: 0, width: 1, height: 1 };
  const margin = Math.min(region.width, region.height) * 0.06;
  const inner = { x: region.x + margin, y: region.y + margin,
    width: region.width - margin * 2, height: region.height - margin * 2 };
  let placed = layer;
  if (panel) {
    const box = layerWorldBounds(layer);
    const factor = Math.min(1, inner.width / (box.right - box.left), inner.height * 0.45 / (box.bottom - box.top));
    const width = layer.bounds.width * factor, height = layer.bounds.height * factor;
    placed = { ...layer, bounds: { x: layer.bounds.x + (layer.bounds.width - width) / 2,
      y: layer.bounds.y + (layer.bounds.height - height) / 2, width, height } };
    const fitted = layerWorldBounds(placed);
    const dx = clamp(fitted.left, inner.x, inner.x + inner.width - (fitted.right - fitted.left)) - fitted.left;
    const dy = clamp(fitted.top, inner.y, inner.y + inner.height - (fitted.bottom - fitted.top)) - fitted.top;
    placed = { ...placed, transform: { ...placed.transform,
      x: clamp(placed.transform.x + dx, -0.5, 0.5), y: clamp(placed.transform.y + dy, -0.5, 0.5) } };
  }
  let body = center(placed);
  const target = design.layers.filter((candidate) => candidate.kind === 'emoji' && candidate.visible && candidate.opacity > 0)
    .map(center).filter((point) => contains(region, point)
      && Math.hypot(point.x - body.x, point.y - body.y) <= Math.hypot(region.width, region.height) * 0.65)
    .sort((a, b) => Math.hypot(a.x - body.x, a.y - body.y) - Math.hypot(b.x - body.x, b.y - body.y))[0];
  if (panel && target) {
    const box = layerWorldBounds(placed);
    if (target.x >= box.left && target.x <= box.right && target.y >= box.top && target.y <= box.bottom) {
      const top = target.y >= region.y + region.height / 2 ? inner.y : inner.y + inner.height - (box.bottom - box.top);
      placed = { ...placed, transform: { ...placed.transform,
        y: clamp(placed.transform.y + top - box.top, -0.5, 0.5) } };
      body = center(placed);
    }
  }
  const bubble = setTextBubble(placed, kind);
  const box = layerWorldBounds(placed);
  // Stop short of the speaker's center; without a speaker, keep the tail inside the panel.
  const tip = target ? { x: body.x + (target.x - body.x) * 0.8, y: body.y + (target.y - body.y) * 0.8 }
    : { x: body.x - (box.right - box.left) * 0.2,
      y: box.bottom + margin * 2 <= inner.y + inner.height ? box.bottom + margin * 2 : box.top - margin * 2 };
  const local = worldPointToLayerLocal(placed, { x: clamp(tip.x, inner.x, inner.x + inner.width),
    y: clamp(tip.y, inner.y, inner.y + inner.height) });
  return local ? { ...bubble, bubble: { ...bubble.bubble!, tail: { x: clamp(local.x, 0, 1), y: clamp(local.y, 0, 1) } } } : bubble;
}
