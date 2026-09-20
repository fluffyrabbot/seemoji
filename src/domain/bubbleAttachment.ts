import type { DesignDocument, TextLayer } from './design';
import { layerLocalPointToWorld, worldPointToLayerLocal } from './sceneGeometry';

export function detachBubble(layer: TextLayer): TextLayer {
  if (!layer.bubble?.speakerId) return layer;
  const { speakerId: _speakerId, ...bubble } = layer.bubble;
  return { ...layer, bubble };
}

/** Materialize attachments in the same document transaction as their speaker's edit. */
export function resolveBubbleAttachments(design: DesignDocument): DesignDocument {
  let changed = false;
  const layers = design.layers.map((layer) => {
    if (layer.kind !== 'text' || !layer.bubble?.speakerId) return layer;
    const speaker = design.layers.find((candidate) => candidate.id === layer.bubble!.speakerId && candidate.kind === 'emoji');
    if (!speaker) { changed = true; return detachBubble(layer); }
    const target = layerLocalPointToWorld(speaker, { x: 0.5, y: 0.62 });
    const body = layerLocalPointToWorld(layer, { x: layer.bounds.x + layer.bounds.width / 2, y: layer.bounds.y + layer.bounds.height / 2 });
    const local = worldPointToLayerLocal(layer, { x: body.x + (target.x - body.x) * 0.8, y: body.y + (target.y - body.y) * 0.8 });
    if (!local) return layer;
    const tail = { x: Math.max(0, Math.min(1, local.x)), y: Math.max(0, Math.min(1, local.y)) };
    if (tail.x === layer.bubble.tail.x && tail.y === layer.bubble.tail.y) return layer;
    changed = true;
    return { ...layer, bubble: { ...layer.bubble, tail } };
  });
  return changed ? { ...design, layers } : design;
}
