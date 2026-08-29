import { createEmojiAssetRef, type EmojiAssetRef } from './emoji';

export interface Transform {
  /** Position as a fraction of the output square, relative to its center. */
  readonly x: number;
  readonly y: number;
  readonly rotate: number;
  readonly scaleX: number;
  readonly scaleY: number;
  readonly skewX: number;
  readonly skewY: number;
  readonly flipH: boolean;
  readonly flipV: boolean;
}

export interface Outline {
  /** Width as a fraction of the output square. */
  readonly width: number;
  readonly color: string;
}

export interface Appearance {
  readonly hue: number;
  /** Multipliers: 1 is unchanged. */
  readonly saturation: number;
  readonly brightness: number;
  /** Blur radius as a fraction of the output square. */
  readonly blur: number;
  readonly outline: Outline | null;
}

export interface StrokePoint {
  /** Canvas-relative coordinates and normalized pointer pressure. */
  readonly x: number;
  readonly y: number;
  readonly pressure: number;
}

export interface BrushStroke {
  readonly id: string;
  readonly points: readonly StrokePoint[];
  /** Width as a fraction of the output square. */
  readonly width: number;
  readonly color: string;
  readonly opacity: number;
}

export interface MaskStroke {
  readonly id: string;
  readonly mode: 'erase' | 'restore';
  readonly points: readonly StrokePoint[];
  /** Width as a fraction of the output square. */
  readonly width: number;
}

export interface LayerBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Every editable scene node shares the same composition contract. */
export interface SceneNode {
  readonly id: string;
  readonly name: string;
  readonly visible: boolean;
  readonly opacity: number;
  readonly transform: Transform;
  readonly mask: readonly MaskStroke[];
}

/** The persisted recipe used before the scene/layer model. */
export interface DesignDocumentV1 {
  readonly version: 1;
  readonly source: EmojiAssetRef;
  readonly transform: Omit<Transform, 'x' | 'y'>;
  readonly appearance: Appearance;
}

export interface EmojiLayer extends SceneNode {
  readonly kind: 'emoji';
  readonly source: EmojiAssetRef;
  readonly appearance: Appearance;
}

export interface StrokeLayer extends SceneNode {
  readonly kind: 'strokes';
  readonly strokes: readonly BrushStroke[];
}

export interface ShapeLayer extends SceneNode {
  readonly kind: 'shape';
  readonly shape: 'rectangle' | 'ellipse' | 'line';
  readonly bounds: LayerBounds;
  readonly fill: string | null;
  readonly stroke: { readonly color: string; readonly width: number } | null;
}

export interface TextLayer extends SceneNode {
  readonly kind: 'text';
  readonly bounds: LayerBounds;
  readonly text: string;
  /** Font size as a fraction of the output square. */
  readonly fontSize: number;
  readonly color: string;
  readonly fontFamily: 'sans-serif' | 'serif' | 'monospace';
  readonly align: 'left' | 'center' | 'right';
}

/** A compact horizontal run in a bounded, layer-local pixel grid. */
export interface RasterRun {
  readonly y: number;
  readonly xStart: number;
  readonly xEnd: number;
  readonly color: string;
}

export interface RasterLayer extends SceneNode {
  readonly kind: 'raster';
  readonly resolution: number;
  readonly runs: readonly RasterRun[];
}

export type SceneLayer = EmojiLayer | StrokeLayer | ShapeLayer | TextLayer | RasterLayer;

export interface DesignDocumentV2 {
  readonly version: 2;
  readonly canvas: {
    readonly background: 'transparent';
  };
  /** Back-to-front paint order. */
  readonly layers: readonly SceneLayer[];
}

export type DesignDocument = DesignDocumentV2;

export const DESIGN_LIMITS = {
  x: [-0.5, 0.5],
  y: [-0.5, 0.5],
  rotate: [-180, 180],
  scaleX: [0.25, 3],
  scaleY: [0.25, 3],
  skewX: [-60, 60],
  skewY: [-60, 60],
  hue: [-180, 180],
  saturation: [0, 4],
  brightness: [0, 3],
  blur: [0, 0.08],
  outlineWidth: [0, 0.08],
  strokeWidth: [0.002, 0.2],
  opacity: [0, 1],
  fontSize: [0.01, 0.5],
  rasterResolution: [16, 256],
} as const;

export const DEFAULT_TRANSFORM: Transform = {
  x: 0,
  y: 0,
  rotate: 0,
  scaleX: 1,
  scaleY: 1,
  skewX: 0,
  skewY: 0,
  flipH: false,
  flipV: false,
};

export const DEFAULT_APPEARANCE: Appearance = {
  hue: 0,
  saturation: 1,
  brightness: 1,
  blur: 0,
  outline: null,
};

export const PRIMARY_EMOJI_LAYER_ID = 'emoji-1';

export const DEFAULT_EMOJI_LAYER: EmojiLayer = {
  id: PRIMARY_EMOJI_LAYER_ID,
  kind: 'emoji',
  name: 'Emoji',
  visible: true,
  opacity: 1,
  source: createEmojiAssetRef('😀'),
  transform: DEFAULT_TRANSFORM,
  appearance: DEFAULT_APPEARANCE,
  mask: [],
};

export const DEFAULT_DESIGN: DesignDocumentV2 = {
  version: 2,
  canvas: { background: 'transparent' },
  layers: [DEFAULT_EMOJI_LAYER],
};

export function getEmojiLayer(design: DesignDocument): EmojiLayer {
  const layer = design.layers.find((candidate) => candidate.kind === 'emoji');
  if (!layer) throw new RangeError('design must contain an emoji layer');
  return layer;
}

export function replaceEmojiLayer(
  design: DesignDocument,
  replacement: EmojiLayer,
): DesignDocumentV2 {
  return {
    ...design,
    layers: design.layers.map((layer) =>
      layer.id === replacement.id ? replacement : layer,
    ),
  };
}

export function getLayer(design: DesignDocument, id: string): SceneLayer | undefined {
  return design.layers.find((layer) => layer.id === id);
}

export function replaceLayer(
  design: DesignDocument,
  replacement: SceneLayer,
): DesignDocumentV2 {
  return {
    ...design,
    layers: design.layers.map((layer) =>
      layer.id === replacement.id ? replacement : layer,
    ),
  };
}

export function updateEmojiLayer(
  design: DesignDocument,
  update: (layer: EmojiLayer) => EmojiLayer,
): DesignDocumentV2 {
  return replaceEmojiLayer(design, update(getEmojiLayer(design)));
}

export function resetDesign(design: DesignDocument): DesignDocumentV2 {
  const source = getEmojiLayer(design).source;
  return {
    ...DEFAULT_DESIGN,
    layers: [{ ...DEFAULT_EMOJI_LAYER, source }],
  };
}
