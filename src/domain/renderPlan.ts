import {
  getEmojiLayer,
  type DesignDocument,
  type EmojiLayer,
  type Transform,
} from './design';

const DEG = Math.PI / 180;
const BASE_GLYPH_RATIO = 0.72;
const SAFETY_MARGIN_RATIO = 0.02;

export interface LinearMatrix {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
}

export interface RenderPlan {
  readonly size: number;
  readonly visible: boolean;
  readonly glyphSize: number;
  readonly matrix: LinearMatrix & { readonly e: number; readonly f: number };
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

export function createLayerMatrix(transform: Transform, size: number) {
  return {
    ...createLinearTransform(transform),
    e: size / 2 + transform.x * size,
    f: size / 2 + transform.y * size,
  };
}

export function createEmojiRenderPlan(layer: EmojiLayer, size: number): RenderPlan {
  if (!Number.isInteger(size) || size < 16 || size > 2048) {
    throw new RangeError('render size must be an integer between 16 and 2048');
  }

  const { transform, appearance, visible } = layer;
  const linear = createLinearTransform(transform);

  const glyphSize = size * BASE_GLYPH_RATIO;
  const half = glyphSize / 2;
  const extentX = Math.abs(linear.a) * half + Math.abs(linear.c) * half;
  const extentY = Math.abs(linear.b) * half + Math.abs(linear.d) * half;
  const blurPixels = appearance.blur * size;
  const outlinePixels = (appearance.outline?.width ?? 0) * size;
  const effectPadding = blurPixels * 3 + outlinePixels + size * SAFETY_MARGIN_RATIO;
  const availableHalf = size / 2 - effectPadding;
  if (availableHalf <= 0) {
    throw new RangeError('effects leave no drawable area at this export size');
  }
  const fit = Math.min(1, availableHalf / extentX, availableHalf / extentY);
  const fitted: LinearMatrix = {
    a: linear.a * fit,
    b: linear.b * fit,
    c: linear.c * fit,
    d: linear.d * fit,
  };
  const fittedExtentX = extentX * fit;
  const fittedExtentY = extentY * fit;
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
    matrix: {
      ...fitted,
      e: size / 2 + transform.x * size,
      f: size / 2 + transform.y * size,
    },
    blurPixels,
    outline: appearance.outline
      ? { widthPixels: outlinePixels, color: appearance.outline.color }
      : null,
    filters,
    contentBounds: {
      left: size / 2 + transform.x * size - fittedExtentX - padding,
      top: size / 2 + transform.y * size - fittedExtentY - padding,
      right: size / 2 + transform.x * size + fittedExtentX + padding,
      bottom: size / 2 + transform.y * size + fittedExtentY + padding,
    },
  };
}

export function createRenderPlan(design: DesignDocument, size: number): RenderPlan {
  return createEmojiRenderPlan(getEmojiLayer(design), size);
}
