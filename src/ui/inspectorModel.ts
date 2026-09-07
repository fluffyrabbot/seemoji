import {
  DEFAULT_APPEARANCE,
  DEFAULT_TRANSFORM,
  DESIGN_LIMITS,
  type EmojiLayer,
} from '../domain/design';
import { layerSize } from '../domain/selectionTransforms';
export {
  layerSize,
  selectionSize,
  selectionCenter,
  moveSelection,
  rotateSelection,
  scaleSelection,
  wrapRotation,
  type LayerTransformUpdate,
} from '../domain/selectionTransforms';

export const QUICK_STYLES = [
  { id: 'original', name: 'Original', description: 'Reset color and transforms; keep position' },
  { id: 'squish', name: 'Squish', description: 'Widen the emoji; keep size and color' },
  { id: 'tilt', name: 'Tilt', description: 'Set a playful −12° angle' },
  { id: 'sticker', name: 'Sticker', description: 'Add a white sticker edge' },
] as const;
export type QuickStyle = typeof QUICK_STYLES[number]['id'];

const clamp = (value: number, limits: readonly [number, number]): number =>
  Math.min(limits[1], Math.max(limits[0], value));

/** Recipes replace just their named property and can be safely composed or reapplied. */
export function applyQuickStyle(layer: EmojiLayer, style: QuickStyle): EmojiLayer {
  if (style === 'original') return {
    ...layer,
    transform: { ...DEFAULT_TRANSFORM, x: layer.transform.x, y: layer.transform.y },
    appearance: DEFAULT_APPEARANCE,
  };
  if (style === 'tilt') return { ...layer, transform: { ...layer.transform, rotate: -12 } };
  if (style === 'sticker') return {
    ...layer,
    appearance: { ...layer.appearance, outline: { width: 0.025, color: '#ffffff' } },
  };
  const aspect = Math.sqrt(1.5);
  const size = clamp(layerSize(layer.transform), [
    DESIGN_LIMITS.scaleX[0] * aspect,
    DESIGN_LIMITS.scaleX[1] / aspect,
  ]);
  return { ...layer, transform: { ...layer.transform, scaleX: size * aspect, scaleY: size / aspect } };
}

