import { createEmojiAssetRef, type EmojiAssetRef } from './emoji';

export interface Transform {
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

export interface DesignDocumentV1 {
  readonly version: 1;
  readonly source: EmojiAssetRef;
  readonly transform: Transform;
  readonly appearance: Appearance;
}

export type DesignDocument = DesignDocumentV1;

export const DESIGN_LIMITS = {
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
} as const;

export const DEFAULT_TRANSFORM: Transform = {
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

export const DEFAULT_DESIGN: DesignDocumentV1 = {
  version: 1,
  source: createEmojiAssetRef('😀'),
  transform: DEFAULT_TRANSFORM,
  appearance: DEFAULT_APPEARANCE,
};

export function resetDesign(design: DesignDocument): DesignDocumentV1 {
  return {
    ...DEFAULT_DESIGN,
    source: design.source,
  };
}
