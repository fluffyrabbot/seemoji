import {
  DEFAULT_TRANSFORM,
  DESIGN_LIMITS,
  type Appearance,
  type BrushStroke,
  type DesignDocument,
  type DesignDocumentV1,
  type DesignDocumentV2,
  type EmojiLayer,
  type MaskStroke,
  type Outline,
  type RasterLayer,
  type RasterRun,
  type SceneLayer,
  type ShapeLayer,
  type StrokeLayer,
  type StrokePoint,
  type TextLayer,
  type Transform,
} from './design';
import { toCodepoint, type EmojiAssetRef } from './emoji';

export type DecodeResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: string };

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const CODEPOINT = /^[0-9a-f]+(?:-[0-9a-f]+)*$/;
const PACK_VERSION = /^\d+\.\d+\.\d+$/;

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const finite = (
  value: unknown,
  path: string,
  [minimum, maximum]: readonly [number, number],
): DecodeResult<number> => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return { ok: false, error: `${path} must be a finite number` };
  }
  if (value < minimum || value > maximum) {
    return { ok: false, error: `${path} must be between ${minimum} and ${maximum}` };
  }
  return { ok: true, value };
};

const boolean = (value: unknown, path: string): DecodeResult<boolean> =>
  typeof value === 'boolean'
    ? { ok: true, value }
    : { ok: false, error: `${path} must be a boolean` };

function decodeSource(value: unknown): DecodeResult<EmojiAssetRef> {
  const source = record(value);
  if (!source) return { ok: false, error: 'source must be an object' };
  if (source.pack !== 'twemoji') {
    return { ok: false, error: 'source.pack must be "twemoji"' };
  }
  if (typeof source.packVersion !== 'string' || !PACK_VERSION.test(source.packVersion)) {
    return { ok: false, error: 'source.packVersion must be a pinned semantic version' };
  }
  if (typeof source.grapheme !== 'string' || !source.grapheme) {
    return { ok: false, error: 'source.grapheme must be a non-empty string' };
  }
  if (typeof source.codepoint !== 'string' || !CODEPOINT.test(source.codepoint)) {
    return { ok: false, error: 'source.codepoint is invalid' };
  }
  if (toCodepoint(source.grapheme) !== source.codepoint) {
    return { ok: false, error: 'source.codepoint does not match source.grapheme' };
  }
  return {
    ok: true,
    value: {
      pack: 'twemoji',
      packVersion: source.packVersion,
      codepoint: source.codepoint,
      grapheme: source.grapheme,
    },
  };
}

function decodeTransform(value: unknown, path = 'transform'): DecodeResult<Transform> {
  const transform = record(value);
  if (!transform) return { ok: false, error: `${path} must be an object` };

  const x = finite(transform.x, `${path}.x`, DESIGN_LIMITS.x);
  const y = finite(transform.y, `${path}.y`, DESIGN_LIMITS.y);
  const rotate = finite(transform.rotate, `${path}.rotate`, DESIGN_LIMITS.rotate);
  const scaleX = finite(transform.scaleX, `${path}.scaleX`, DESIGN_LIMITS.scaleX);
  const scaleY = finite(transform.scaleY, `${path}.scaleY`, DESIGN_LIMITS.scaleY);
  const skewX = finite(transform.skewX, `${path}.skewX`, DESIGN_LIMITS.skewX);
  const skewY = finite(transform.skewY, `${path}.skewY`, DESIGN_LIMITS.skewY);
  const flipH = boolean(transform.flipH, `${path}.flipH`);
  const flipV = boolean(transform.flipV, `${path}.flipV`);
  if (!x.ok) return x;
  if (!y.ok) return y;
  if (!rotate.ok) return rotate;
  if (!scaleX.ok) return scaleX;
  if (!scaleY.ok) return scaleY;
  if (!skewX.ok) return skewX;
  if (!skewY.ok) return skewY;
  if (!flipH.ok) return flipH;
  if (!flipV.ok) return flipV;

  return {
    ok: true,
    value: {
      x: x.value,
      y: y.value,
      rotate: rotate.value,
      scaleX: scaleX.value,
      scaleY: scaleY.value,
      skewX: skewX.value,
      skewY: skewY.value,
      flipH: flipH.value,
      flipV: flipV.value,
    },
  };
}

function decodeOutline(value: unknown, path = 'appearance.outline'): DecodeResult<Outline | null> {
  if (value === null) return { ok: true, value: null };
  const outline = record(value);
  if (!outline) return { ok: false, error: `${path} must be an object or null` };
  const width = finite(
    outline.width,
    `${path}.width`,
    DESIGN_LIMITS.outlineWidth,
  );
  if (!width.ok) return width;
  if (width.value === 0) {
    return { ok: false, error: `${path}.width must be greater than zero` };
  }
  if (typeof outline.color !== 'string' || !HEX_COLOR.test(outline.color)) {
    return { ok: false, error: `${path}.color must be a six-digit hex color` };
  }
  return { ok: true, value: { width: width.value, color: outline.color } };
}

function decodeAppearance(value: unknown, path = 'appearance'): DecodeResult<Appearance> {
  const appearance = record(value);
  if (!appearance) return { ok: false, error: `${path} must be an object` };
  const hue = finite(appearance.hue, `${path}.hue`, DESIGN_LIMITS.hue);
  const saturation = finite(
    appearance.saturation,
    `${path}.saturation`,
    DESIGN_LIMITS.saturation,
  );
  const brightness = finite(
    appearance.brightness,
    `${path}.brightness`,
    DESIGN_LIMITS.brightness,
  );
  const blur = finite(appearance.blur, `${path}.blur`, DESIGN_LIMITS.blur);
  const outline = decodeOutline(appearance.outline, `${path}.outline`);
  if (!hue.ok) return hue;
  if (!saturation.ok) return saturation;
  if (!brightness.ok) return brightness;
  if (!blur.ok) return blur;
  if (!outline.ok) return outline;
  return {
    ok: true,
    value: {
      hue: hue.value,
      saturation: saturation.value,
      brightness: brightness.value,
      blur: blur.value,
      outline: outline.value,
    },
  };
}

function decodeDesignDocumentV1(document: Record<string, unknown>): DecodeResult<DesignDocumentV1> {
  const source = decodeSource(document.source);
  if (!source.ok) return source;
  const legacyTransform = record(document.transform);
  if (!legacyTransform) return { ok: false, error: 'transform must be an object' };
  const transform = decodeTransform(
    { ...legacyTransform, x: DEFAULT_TRANSFORM.x, y: DEFAULT_TRANSFORM.y },
  );
  if (!transform.ok) return transform;
  const appearance = decodeAppearance(document.appearance);
  if (!appearance.ok) return appearance;
  const { x: _x, y: _y, ...positionlessTransform } = transform.value;
  return {
    ok: true,
    value: {
      version: 1,
      source: source.value,
      transform: positionlessTransform,
      appearance: appearance.value,
    },
  };
}

export function migrateDesignDocumentV1(document: DesignDocumentV1): DesignDocumentV2 {
  return {
    version: 2,
    canvas: { background: 'transparent' },
    layers: [
      {
        id: 'emoji-1',
        kind: 'emoji',
        name: 'Emoji',
        visible: true,
        opacity: 1,
        source: document.source,
        transform: { ...DEFAULT_TRANSFORM, ...document.transform },
        appearance: document.appearance,
        mask: [],
      },
    ],
  };
}

function decodeStrokePoint(value: unknown, path: string): DecodeResult<StrokePoint> {
  const point = record(value);
  if (!point) return { ok: false, error: `${path} must be an object` };
  const x = finite(point.x, `${path}.x`, [0, 1]);
  const y = finite(point.y, `${path}.y`, [0, 1]);
  const pressure = finite(point.pressure, `${path}.pressure`, [0, 1]);
  if (!x.ok) return x;
  if (!y.ok) return y;
  if (!pressure.ok) return pressure;
  return { ok: true, value: { x: x.value, y: y.value, pressure: pressure.value } };
}

function decodeStrokePoints(value: unknown, path: string): DecodeResult<readonly StrokePoint[]> {
  if (!Array.isArray(value) || value.length === 0 || value.length > 50_000) {
    return { ok: false, error: `${path} must contain between 1 and 50000 points` };
  }
  const points: StrokePoint[] = [];
  for (const [index, rawPoint] of value.entries()) {
    const point = decodeStrokePoint(rawPoint, `${path}[${index}]`);
    if (!point.ok) return point;
    points.push(point.value);
  }
  return { ok: true, value: points };
}

function decodeMaskStroke(value: unknown, path: string): DecodeResult<MaskStroke> {
  const stroke = record(value);
  if (!stroke) return { ok: false, error: `${path} must be an object` };
  if (typeof stroke.id !== 'string' || !stroke.id) {
    return { ok: false, error: `${path}.id must be a non-empty string` };
  }
  const points = decodeStrokePoints(stroke.points, `${path}.points`);
  if (!points.ok) return points;
  const width = finite(stroke.width, `${path}.width`, DESIGN_LIMITS.strokeWidth);
  if (!width.ok) return width;
  const mode = stroke.mode ?? 'erase';
  if (mode !== 'erase' && mode !== 'restore') {
    return { ok: false, error: `${path}.mode must be "erase" or "restore"` };
  }
  return {
    ok: true,
    value: { id: stroke.id, mode, points: points.value, width: width.value },
  };
}

function decodeBrushStroke(value: unknown, path: string): DecodeResult<BrushStroke> {
  const stroke = record(value);
  if (!stroke) return { ok: false, error: `${path} must be an object` };
  if (typeof stroke.id !== 'string' || !stroke.id) {
    return { ok: false, error: `${path}.id must be a non-empty string` };
  }
  const points = decodeStrokePoints(stroke.points, `${path}.points`);
  if (!points.ok) return points;
  const width = finite(stroke.width, `${path}.width`, DESIGN_LIMITS.strokeWidth);
  if (!width.ok) return width;
  const opacity = finite(stroke.opacity, `${path}.opacity`, DESIGN_LIMITS.opacity);
  if (!opacity.ok) return opacity;
  if (typeof stroke.color !== 'string' || !HEX_COLOR.test(stroke.color)) {
    return { ok: false, error: `${path}.color must be a six-digit hex color` };
  }
  return {
    ok: true,
    value: {
      id: stroke.id,
      points: points.value,
      width: width.value,
      color: stroke.color,
      opacity: opacity.value,
    },
  };
}

function decodeMask(value: unknown, path: string): DecodeResult<readonly MaskStroke[]> {
  if (value === undefined) return { ok: true, value: [] };
  if (!Array.isArray(value) || value.length > 10_000) {
    return { ok: false, error: `${path} must be an array with at most 10000 strokes` };
  }
  const mask: MaskStroke[] = [];
  for (const [index, rawStroke] of value.entries()) {
    const stroke = decodeMaskStroke(rawStroke, `${path}[${index}]`);
    if (!stroke.ok) return stroke;
    mask.push(stroke.value);
  }
  return { ok: true, value: mask };
}

function decodeLayerIdentity(
  layer: Record<string, unknown>,
  path: string,
): DecodeResult<{ readonly id: string; readonly name: string; readonly visible: boolean; readonly opacity: number }> {
  if (typeof layer.id !== 'string' || !layer.id.trim()) {
    return { ok: false, error: `${path}.id must be a non-empty string` };
  }
  if (typeof layer.name !== 'string' || !layer.name.trim() || layer.name.length > 80) {
    return { ok: false, error: `${path}.name is invalid` };
  }
  const visible = boolean(layer.visible, `${path}.visible`);
  if (!visible.ok) return visible;
  const opacity = layer.opacity === undefined
    ? { ok: true as const, value: 1 }
    : finite(layer.opacity, `${path}.opacity`, DESIGN_LIMITS.opacity);
  if (!opacity.ok) return opacity;
  return {
    ok: true,
    value: { id: layer.id, name: layer.name.trim(), visible: visible.value, opacity: opacity.value },
  };
}

function decodeEmojiLayer(value: unknown, index: number): DecodeResult<EmojiLayer> {
  const path = `layers[${index}]`;
  const layer = record(value);
  if (!layer) return { ok: false, error: `${path} must be an object` };
  const identity = decodeLayerIdentity(layer, path);
  if (!identity.ok) return identity;
  const source = decodeSource(layer.source);
  if (!source.ok) return { ok: false, error: `${path}.${source.error}` };
  const transform = decodeTransform(layer.transform, `${path}.transform`);
  if (!transform.ok) return transform;
  const appearance = decodeAppearance(layer.appearance, `${path}.appearance`);
  if (!appearance.ok) return appearance;
  const mask = decodeMask(layer.mask, `${path}.mask`);
  if (!mask.ok) return mask;
  return {
    ok: true,
    value: {
      ...identity.value,
      kind: 'emoji',
      source: source.value,
      transform: transform.value,
      appearance: appearance.value,
      mask: mask.value,
    },
  };
}

function decodeStrokeLayer(value: unknown, index: number): DecodeResult<StrokeLayer> {
  const path = `layers[${index}]`;
  const layer = record(value);
  if (!layer) return { ok: false, error: `${path} must be an object` };
  const identity = decodeLayerIdentity(layer, path);
  if (!identity.ok) return identity;
  const transform = layer.transform === undefined
    ? { ok: true as const, value: DEFAULT_TRANSFORM }
    : decodeTransform(layer.transform, `${path}.transform`);
  if (!transform.ok) return transform;
  if (!Array.isArray(layer.strokes) || layer.strokes.length > 10_000) {
    return { ok: false, error: `${path}.strokes must contain at most 10000 strokes` };
  }
  const strokes: BrushStroke[] = [];
  for (const [index, rawStroke] of layer.strokes.entries()) {
    const stroke = decodeBrushStroke(rawStroke, `${path}.strokes[${index}]`);
    if (!stroke.ok) return stroke;
    strokes.push(stroke.value);
  }
  const mask = decodeMask(layer.mask, `${path}.mask`);
  if (!mask.ok) return mask;
  return {
    ok: true,
    value: {
      ...identity.value,
      kind: 'strokes',
      transform: transform.value,
      strokes,
      mask: mask.value,
    },
  };
}

function decodeNodeFields(layer: Record<string, unknown>, path: string) {
  const identity = decodeLayerIdentity(layer, path);
  if (!identity.ok) return identity;
  const transform = layer.transform === undefined
    ? { ok: true as const, value: DEFAULT_TRANSFORM }
    : decodeTransform(layer.transform, `${path}.transform`);
  if (!transform.ok) return transform;
  const mask = decodeMask(layer.mask, `${path}.mask`);
  if (!mask.ok) return mask;
  return { ok: true as const, value: { ...identity.value, transform: transform.value, mask: mask.value } };
}

function decodeBounds(value: unknown, path: string) {
  const bounds = record(value);
  if (!bounds) return { ok: false as const, error: `${path} must be an object` };
  const x = finite(bounds.x, `${path}.x`, [0, 1]);
  const y = finite(bounds.y, `${path}.y`, [0, 1]);
  const width = finite(bounds.width, `${path}.width`, [0.001, 1]);
  const height = finite(bounds.height, `${path}.height`, [0.001, 1]);
  if (!x.ok) return x;
  if (!y.ok) return y;
  if (!width.ok) return width;
  if (!height.ok) return height;
  if (x.value + width.value > 1 || y.value + height.value > 1) {
    return { ok: false as const, error: `${path} must fit inside the canvas` };
  }
  return { ok: true as const, value: { x: x.value, y: y.value, width: width.value, height: height.value } };
}

const decodeColor = (value: unknown, path: string): DecodeResult<string> =>
  typeof value === 'string' && HEX_COLOR.test(value)
    ? { ok: true, value }
    : { ok: false, error: `${path} must be a six-digit hex color` };

function decodeShapeLayer(value: unknown, index: number): DecodeResult<ShapeLayer> {
  const path = `layers[${index}]`;
  const layer = record(value)!;
  const common = decodeNodeFields(layer, path);
  if (!common.ok) return common;
  if (layer.shape !== 'rectangle' && layer.shape !== 'ellipse' && layer.shape !== 'line') {
    return { ok: false, error: `${path}.shape is unsupported` };
  }
  const bounds = decodeBounds(layer.bounds, `${path}.bounds`);
  if (!bounds.ok) return bounds;
  const fill = layer.fill === null ? { ok: true as const, value: null } : decodeColor(layer.fill, `${path}.fill`);
  if (!fill.ok) return fill;
  let stroke: ShapeLayer['stroke'] = null;
  if (layer.stroke !== null) {
    const rawStroke = record(layer.stroke);
    if (!rawStroke) return { ok: false, error: `${path}.stroke must be an object or null` };
    const color = decodeColor(rawStroke.color, `${path}.stroke.color`);
    const width = finite(rawStroke.width, `${path}.stroke.width`, DESIGN_LIMITS.strokeWidth);
    if (!color.ok) return color;
    if (!width.ok) return width;
    stroke = { color: color.value, width: width.value };
  }
  if (fill.value === null && stroke === null) return { ok: false, error: `${path} must have a fill or stroke` };
  return { ok: true, value: { ...common.value, kind: 'shape', shape: layer.shape, bounds: bounds.value, fill: fill.value, stroke } };
}

function decodeTextLayer(value: unknown, index: number): DecodeResult<TextLayer> {
  const path = `layers[${index}]`;
  const layer = record(value)!;
  const common = decodeNodeFields(layer, path);
  if (!common.ok) return common;
  const bounds = decodeBounds(layer.bounds, `${path}.bounds`);
  if (!bounds.ok) return bounds;
  if (typeof layer.text !== 'string' || layer.text.length < 1 || layer.text.length > 500) {
    return { ok: false, error: `${path}.text must contain between 1 and 500 characters` };
  }
  const fontSize = finite(layer.fontSize, `${path}.fontSize`, DESIGN_LIMITS.fontSize);
  if (!fontSize.ok) return fontSize;
  const color = decodeColor(layer.color, `${path}.color`);
  if (!color.ok) return color;
  if (layer.fontFamily !== 'sans-serif' && layer.fontFamily !== 'serif' && layer.fontFamily !== 'monospace') {
    return { ok: false, error: `${path}.fontFamily is unsupported` };
  }
  if (layer.align !== 'left' && layer.align !== 'center' && layer.align !== 'right') {
    return { ok: false, error: `${path}.align is unsupported` };
  }
  return { ok: true, value: { ...common.value, kind: 'text', bounds: bounds.value, text: layer.text,
    fontSize: fontSize.value, color: color.value, fontFamily: layer.fontFamily, align: layer.align } };
}

function decodeRasterLayer(value: unknown, index: number): DecodeResult<RasterLayer> {
  const path = `layers[${index}]`;
  const layer = record(value)!;
  const common = decodeNodeFields(layer, path);
  if (!common.ok) return common;
  const resolution = finite(layer.resolution, `${path}.resolution`, DESIGN_LIMITS.rasterResolution);
  if (!resolution.ok || !Number.isInteger(resolution.value)) {
    return resolution.ok ? { ok: false, error: `${path}.resolution must be an integer` } : resolution;
  }
  if (!Array.isArray(layer.runs) || layer.runs.length > 65_536) {
    return { ok: false, error: `${path}.runs must contain at most 65536 runs` };
  }
  const runs: RasterRun[] = [];
  for (const [runIndex, raw] of layer.runs.entries()) {
    const run = record(raw);
    const runPath = `${path}.runs[${runIndex}]`;
    if (!run || !Number.isInteger(run.y) || !Number.isInteger(run.xStart) || !Number.isInteger(run.xEnd)
      || (run.y as number) < 0 || (run.y as number) >= resolution.value
      || (run.xStart as number) < 0 || (run.xEnd as number) < (run.xStart as number)
      || (run.xEnd as number) >= resolution.value) {
      return { ok: false, error: `${runPath} is outside the raster grid` };
    }
    const color = decodeColor(run.color, `${runPath}.color`);
    if (!color.ok) return color;
    runs.push({ y: run.y as number, xStart: run.xStart as number, xEnd: run.xEnd as number, color: color.value });
  }
  return { ok: true, value: { ...common.value, kind: 'raster', resolution: resolution.value, runs } };
}

function decodeDesignDocumentV2(document: Record<string, unknown>): DecodeResult<DesignDocumentV2> {
  const canvas = record(document.canvas);
  if (!canvas || canvas.background !== 'transparent') {
    return { ok: false, error: 'canvas.background must be "transparent"' };
  }
  if (!Array.isArray(document.layers) || document.layers.length === 0 || document.layers.length > 100) {
    return { ok: false, error: 'layers must contain between 1 and 100 layers' };
  }
  const layers: SceneLayer[] = [];
  const ids = new Set<string>();
  for (const [index, rawLayer] of document.layers.entries()) {
    const kind = record(rawLayer)?.kind;
    const decoded = kind === 'emoji'
      ? decodeEmojiLayer(rawLayer, index)
      : kind === 'strokes'
        ? decodeStrokeLayer(rawLayer, index)
        : kind === 'shape'
          ? decodeShapeLayer(rawLayer, index)
          : kind === 'text'
            ? decodeTextLayer(rawLayer, index)
            : kind === 'raster'
              ? decodeRasterLayer(rawLayer, index)
        : { ok: false as const, error: `layers[${index}].kind is unsupported: ${String(kind)}` };
    if (!decoded.ok) return decoded;
    if (ids.has(decoded.value.id)) {
      return { ok: false, error: `layers[${index}].id must be unique` };
    }
    ids.add(decoded.value.id);
    layers.push(decoded.value);
  }
  const totalPoints = layers.reduce((sceneTotal, layer) => {
    const maskPoints = layer.mask.reduce(
      (maskTotal, stroke) => maskTotal + stroke.points.length,
      0,
    );
    const paintPoints = layer.kind === 'strokes'
      ? layer.strokes.reduce(
          (strokeTotal, stroke) => strokeTotal + stroke.points.length,
          0,
        )
      : 0;
    return sceneTotal + maskPoints + paintPoints;
  }, 0);
  if (totalPoints > 250_000) {
    return { ok: false, error: 'scene must contain at most 250000 stroke points' };
  }
  if (!layers.some((layer) => layer.kind === 'emoji')) {
    return { ok: false, error: 'scene must contain an emoji layer' };
  }
  return {
    ok: true,
    value: { version: 2, canvas: { background: 'transparent' }, layers },
  };
}

/** Decodes the current format and explicitly promotes persisted V1 recipes into V2 scenes. */
export function decodeDesignDocument(value: unknown): DecodeResult<DesignDocument> {
  const document = record(value);
  if (!document) return { ok: false, error: 'design document must be an object' };
  if (document.version === 1) {
    const decoded = decodeDesignDocumentV1(document);
    return decoded.ok ? { ok: true, value: migrateDesignDocumentV1(decoded.value) } : decoded;
  }
  if (document.version === 2) return decodeDesignDocumentV2(document);
  return {
    ok: false,
    error: `unsupported design document version: ${String(document.version)}`,
  };
}
