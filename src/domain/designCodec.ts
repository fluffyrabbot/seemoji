import {
  DEFAULT_APPEARANCE,
  DEFAULT_TRANSFORM,
  DESIGN_LIMITS,
  type Appearance,
  type DesignDocumentV1,
  type Outline,
  type Transform,
} from './design';
import { createEmojiAssetRef, toCodepoint, type EmojiAssetRef } from './emoji';

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

function decodeTransform(value: unknown): DecodeResult<Transform> {
  const transform = record(value);
  if (!transform) return { ok: false, error: 'transform must be an object' };

  const rotate = finite(transform.rotate, 'transform.rotate', DESIGN_LIMITS.rotate);
  const scaleX = finite(transform.scaleX, 'transform.scaleX', DESIGN_LIMITS.scaleX);
  const scaleY = finite(transform.scaleY, 'transform.scaleY', DESIGN_LIMITS.scaleY);
  const skewX = finite(transform.skewX, 'transform.skewX', DESIGN_LIMITS.skewX);
  const skewY = finite(transform.skewY, 'transform.skewY', DESIGN_LIMITS.skewY);
  const flipH = boolean(transform.flipH, 'transform.flipH');
  const flipV = boolean(transform.flipV, 'transform.flipV');
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

function decodeOutline(value: unknown): DecodeResult<Outline | null> {
  if (value === null) return { ok: true, value: null };
  const outline = record(value);
  if (!outline) return { ok: false, error: 'appearance.outline must be an object or null' };
  const width = finite(
    outline.width,
    'appearance.outline.width',
    DESIGN_LIMITS.outlineWidth,
  );
  if (!width.ok) return width;
  if (width.value === 0) {
    return { ok: false, error: 'appearance.outline.width must be greater than zero' };
  }
  if (typeof outline.color !== 'string' || !HEX_COLOR.test(outline.color)) {
    return { ok: false, error: 'appearance.outline.color must be a six-digit hex color' };
  }
  return { ok: true, value: { width: width.value, color: outline.color } };
}

function decodeAppearance(value: unknown): DecodeResult<Appearance> {
  const appearance = record(value);
  if (!appearance) return { ok: false, error: 'appearance must be an object' };
  const hue = finite(appearance.hue, 'appearance.hue', DESIGN_LIMITS.hue);
  const saturation = finite(
    appearance.saturation,
    'appearance.saturation',
    DESIGN_LIMITS.saturation,
  );
  const brightness = finite(
    appearance.brightness,
    'appearance.brightness',
    DESIGN_LIMITS.brightness,
  );
  const blur = finite(appearance.blur, 'appearance.blur', DESIGN_LIMITS.blur);
  const outline = decodeOutline(appearance.outline);
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

export function decodeDesignDocument(value: unknown): DecodeResult<DesignDocumentV1> {
  const document = record(value);
  if (!document) return { ok: false, error: 'design document must be an object' };
  if (document.version !== 1) {
    return { ok: false, error: `unsupported design document version: ${String(document.version)}` };
  }
  const source = decodeSource(document.source);
  if (!source.ok) return source;
  const transform = decodeTransform(document.transform);
  if (!transform.ok) return transform;
  const appearance = decodeAppearance(document.appearance);
  if (!appearance.ok) return appearance;
  return {
    ok: true,
    value: { version: 1, source: source.value, transform: transform.value, appearance: appearance.value },
  };
}

const clamp = (value: unknown, fallback: number, range: readonly [number, number]) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(range[1], Math.max(range[0], value));
};

/** Explicit one-way migration from the prototype's EditParams shape. */
export function migrateLegacyEditParams(
  grapheme: string,
  value: unknown,
): DecodeResult<DesignDocumentV1> {
  const legacy = record(value);
  if (!legacy || legacy.v !== 1) {
    return { ok: false, error: 'unsupported legacy edit parameters' };
  }

  const rawOutline = record(legacy.outline);
  const outlineWidth = rawOutline
    ? clamp(rawOutline.width, 0, [0, DESIGN_LIMITS.outlineWidth[1] * 128]) / 128
    : 0;
  const outline =
    rawOutline &&
    outlineWidth > 0 &&
    typeof rawOutline.color === 'string' &&
    HEX_COLOR.test(rawOutline.color)
      ? { width: outlineWidth, color: rawOutline.color }
      : null;

  return {
    ok: true,
    value: {
      version: 1,
      source: createEmojiAssetRef(grapheme),
      transform: {
        rotate: clamp(legacy.rotate, DEFAULT_TRANSFORM.rotate, DESIGN_LIMITS.rotate),
        scaleX: clamp(legacy.scaleX, DEFAULT_TRANSFORM.scaleX, DESIGN_LIMITS.scaleX),
        scaleY: clamp(legacy.scaleY, DEFAULT_TRANSFORM.scaleY, DESIGN_LIMITS.scaleY),
        skewX: clamp(legacy.skewX, DEFAULT_TRANSFORM.skewX, DESIGN_LIMITS.skewX),
        skewY: clamp(legacy.skewY, DEFAULT_TRANSFORM.skewY, DESIGN_LIMITS.skewY),
        flipH: typeof legacy.flipH === 'boolean' ? legacy.flipH : false,
        flipV: typeof legacy.flipV === 'boolean' ? legacy.flipV : false,
      },
      appearance: {
        hue: clamp(legacy.hue, DEFAULT_APPEARANCE.hue, DESIGN_LIMITS.hue),
        saturation: clamp(
          typeof legacy.saturate === 'number' ? legacy.saturate / 100 : undefined,
          DEFAULT_APPEARANCE.saturation,
          DESIGN_LIMITS.saturation,
        ),
        brightness: clamp(
          typeof legacy.brightness === 'number' ? legacy.brightness / 100 : undefined,
          DEFAULT_APPEARANCE.brightness,
          DESIGN_LIMITS.brightness,
        ),
        blur: clamp(
          typeof legacy.blur === 'number' ? legacy.blur / 128 : undefined,
          DEFAULT_APPEARANCE.blur,
          DESIGN_LIMITS.blur,
        ),
        outline,
      },
    },
  };
}
