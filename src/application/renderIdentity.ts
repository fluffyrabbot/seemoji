import type { DesignDocument, SceneLayer } from '../domain/design';

const identities = new WeakMap<object, number>();
let sequence = 0;
const identity = (value: object): number => {
  let id = identities.get(value);
  if (id === undefined) { id = ++sequence; identities.set(value, id); }
  return id;
};

/** Documents and their stroke collections are immutable and structurally shared. */
export const renderKey = (design: DesignDocument, size: number): string => `${size}:${identity(design)}`;

const layerKeys = new WeakMap<SceneLayer, string>();
export function layerRenderKey(layer: SceneLayer, size: number): string {
  let key = layerKeys.get(layer);
  if (key === undefined) {
    const { id: _id, name: _name, transform, visible: _visible, opacity: _opacity, mask, ...paint } = layer;
    key = JSON.stringify({ ...paint, mask: identity(mask),
      ...(layer.kind === 'emoji' ? { transform } : {}),
      ...(layer.kind === 'strokes' ? { strokes: identity(layer.strokes) } : {}),
      ...(layer.kind === 'raster' ? { runs: identity(layer.runs) } : {}),
    });
    layerKeys.set(layer, key);
  }
  return `${size}:${key}`;
}
