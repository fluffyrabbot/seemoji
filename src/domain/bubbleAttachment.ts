import type { DesignDocument, TextLayer } from './design';
import { layerLocalBounds, layerLocalPointToWorld, worldPointToLayerLocal } from './sceneGeometry';

export function detachBubble(layer: TextLayer): TextLayer {
  if (!layer.bubble?.speakerId) return layer;
  const { speakerId: _speakerId, speakerAnchor: _speakerAnchor, ...bubble } = layer.bubble;
  return { ...layer, bubble };
}

/** Materialize attachments in the same document transaction as their speaker's edit. */
export function resolveBubbleAttachments(design: DesignDocument): DesignDocument {
  let changed = false;
  const layers = design.layers.map((layer) => {
    if (layer.kind !== 'text' || !layer.bubble?.speakerId) return layer;
    const speaker = design.layers.find((candidate) => candidate.id === layer.bubble!.speakerId && candidate.kind === 'emoji');
    if (!speaker) { changed = true; return detachBubble(layer); }
    const target = layerLocalPointToWorld(speaker, layer.bubble.speakerAnchor ?? { x: 0.5, y: 0.62 });
    const local = worldPointToLayerLocal(layer, target);
    if (!local) return layer;
    const tail = local;
    if (tail.x === layer.bubble.tail.x && tail.y === layer.bubble.tail.y) return layer;
    changed = true;
    return { ...layer, bubble: { ...layer.bubble, tail } };
  });
  return changed ? { ...design, layers } : design;
}

/** Pick the topmost visible emoji using its transformed local bounds. */
export function bubbleSpeakerAt(design: DesignDocument, point: { x: number; y: number }) {
  return [...design.layers].reverse().find((layer) => {
    if (layer.kind !== 'emoji' || !layer.visible || layer.opacity === 0) return false;
    const local = worldPointToLayerLocal(layer, point);
    if (!local) return false;
    const box = layerLocalBounds(layer);
    return local.x >= box.x && local.x <= box.x + box.width
      && local.y >= box.y && local.y <= box.y + box.height;
  });
}

/** Retain the rendered endpoint when migrating attachments from before explicit anchors. */
export function preserveLegacyAnchors(design: DesignDocument): DesignDocument {
  return { ...design, layers: design.layers.map((layer) => {
    if (layer.kind !== 'text' || !layer.bubble?.speakerId || layer.bubble.speakerAnchor) return layer;
    const speaker = design.layers.find((candidate) => candidate.id === layer.bubble!.speakerId);
    const anchor = speaker && worldPointToLayerLocal(speaker, layerLocalPointToWorld(layer, layer.bubble.tail));
    return anchor ? { ...layer, bubble: { ...layer.bubble, speakerAnchor: anchor } } : layer;
  }) };
}
