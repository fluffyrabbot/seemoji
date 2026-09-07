import {
  getEmojiLayer,
  type DesignDocument,
  type EmojiLayer,
  type Transform,
} from './design';

const DEG = Math.PI / 180;
export const BASE_GLYPH_RATIO = 0.72;

export interface LinearMatrix {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
}

export interface AffineMatrix extends LinearMatrix {
  readonly e: number;
  readonly f: number;
}

export interface RenderPlan {
  readonly size: number;
  readonly visible: boolean;
  readonly glyphSize: number;
  readonly matrix: AffineMatrix;
  readonly blurPixels: number;
  readonly outline: { readonly widthPixels: number; readonly color: string } | null;
  readonly filters: readonly string[];
  readonly contentBounds: {
    readonly left: number;
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
  };
}

const multiply = (left: LinearMatrix, right: LinearMatrix): LinearMatrix => ({
  a: left.a * right.a + left.c * right.b,
  b: left.b * right.a + left.d * right.b,
  c: left.a * right.c + left.c * right.d,
  d: left.b * right.c + left.d * right.d,
});

export function createLinearTransform(transform: Transform): LinearMatrix {
  const flip: LinearMatrix = {
    a: transform.flipH ? -1 : 1,
    b: 0,
    c: 0,
    d: transform.flipV ? -1 : 1,
  };
  const angle = transform.rotate * DEG;
  const rotate: LinearMatrix = {
    a: Math.cos(angle),
    b: Math.sin(angle),
    c: -Math.sin(angle),
    d: Math.cos(angle),
  };
  const skew: LinearMatrix = {
    a: 1,
    b: Math.tan(transform.skewY * DEG),
    c: Math.tan(transform.skewX * DEG),
    d: 1,
  };
  const scale: LinearMatrix = {
    a: transform.scaleX,
    b: 0,
    c: 0,
    d: transform.scaleY,
  };
  return multiply(multiply(multiply(flip, rotate), skew), scale);
}

export function createLayerMatrix(transform: Transform, size: number): AffineMatrix {
  return {
    ...createLinearTransform(transform),
    e: size / 2 + transform.x * size,
    f: size / 2 + transform.y * size,
  };
}

/** Converts a center-origin layer matrix to one that accepts top-left-origin canvas coordinates. */
export function toTopLeftOrigin(matrix: AffineMatrix, size: number): AffineMatrix {
  return {
    ...matrix,
    e: matrix.e - (matrix.a + matrix.c) * size / 2,
    f: matrix.f - (matrix.b + matrix.d) * size / 2,
  };
}

export function createEmojiRenderPlan(layer: EmojiLayer, size: number): RenderPlan {
  if (!Number.isInteger(size) || size < 16 || size > 2048) {
    throw new RangeError('render size must be an integer between 16 and 2048');
  }

  const { transform, appearance, visible } = layer;
  const matrix = createLayerMatrix(transform, size);

  const glyphSize = size * BASE_GLYPH_RATIO;
  const half = glyphSize / 2;
  const extentX = Math.abs(matrix.a) * half + Math.abs(matrix.c) * half;
  const extentY = Math.abs(matrix.b) * half + Math.abs(matrix.d) * half;
  const blurPixels = appearance.blur * size;
  const outlinePixels = (appearance.outline?.width ?? 0) * size;
  const padding = blurPixels * 3 + outlinePixels;

  const filters: string[] = [];
  if (appearance.hue !== 0) filters.push(`hue-rotate(${appearance.hue}deg)`);
  if (appearance.saturation !== 1) filters.push(`saturate(${appearance.saturation * 100}%)`);
  if (appearance.brightness !== 1) filters.push(`brightness(${appearance.brightness * 100}%)`);
  if (blurPixels > 0) filters.push(`blur(${blurPixels}px)`);

  return {
    size,
    visible,
    glyphSize,
    // Every layer obeys the same explicit scene transform. Content outside the
    // canvas is clipped by the output surface, never silently scaled to fit.
    matrix,
    blurPixels,
    outline: appearance.outline
      ? { widthPixels: outlinePixels, color: appearance.outline.color }
      : null,
    filters,
    contentBounds: {
      left: matrix.e - extentX - padding,
      top: matrix.f - extentY - padding,
      right: matrix.e + extentX + padding,
      bottom: matrix.f + extentY + padding,
    },
  };
}

export function createRenderPlan(design: DesignDocument, size: number): RenderPlan {
  return createEmojiRenderPlan(getEmojiLayer(design), size);
}
