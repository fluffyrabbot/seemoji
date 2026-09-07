import { DESIGN_LIMITS, type Appearance, type EmojiLayer, type Transform } from './design';
import type { DecodeResult } from './designCodec';

export const EMOJI_STYLE_CAPACITY = 64;
export const EMOJI_STYLE_NAME_LIMIT = 48;
export type EmojiStyleTransform = Omit<Transform, 'x' | 'y'>;

/** A reusable look contains no source, object identity, position, or scene edits. */
export interface EmojiStyle {
  readonly version: 1;
  readonly id: string;
  readonly name: string;
  readonly createdAt: number;
  readonly transform: EmojiStyleTransform;
  readonly appearance: Appearance;
}

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
const within = (value: unknown, [minimum, maximum]: readonly [number, number]): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum;
const color = (value: unknown): value is string => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
export const emojiStyleNameKey = (name: string): string => name.trim().normalize('NFKC').toLowerCase();

export function decodeEmojiStyle(value: unknown): DecodeResult<EmojiStyle> {
  const style = record(value);
  if (!style || style.version !== 1) return { ok: false, error: 'Saved style has an unsupported format.' };
  if (typeof style.id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(style.id)) {
    return { ok: false, error: 'Saved style has an invalid identity.' };
  }
  if (typeof style.name !== 'string' || !style.name.trim()
    || style.name.trim().length > EMOJI_STYLE_NAME_LIMIT
    || Array.from(style.name).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) {
    return { ok: false, error: `Give the style a name between 1 and ${EMOJI_STYLE_NAME_LIMIT} characters.` };
  }
  if (!Number.isSafeInteger(style.createdAt) || (style.createdAt as number) < 0) {
    return { ok: false, error: 'Saved style has an invalid creation time.' };
  }
  const transform = record(style.transform);
  if (!transform) return { ok: false, error: 'Saved style is missing its transform.' };
  for (const key of ['rotate', 'scaleX', 'scaleY', 'skewX', 'skewY'] as const) {
    if (!within(transform[key], DESIGN_LIMITS[key])) return { ok: false, error: `Saved style ${key} is outside the supported range.` };
  }
  if (typeof transform.flipH !== 'boolean' || typeof transform.flipV !== 'boolean') {
    return { ok: false, error: 'Saved style mirror settings must be booleans.' };
  }
  const appearance = record(style.appearance);
  if (!appearance) return { ok: false, error: 'Saved style is missing its appearance.' };
  for (const key of ['hue', 'saturation', 'brightness', 'blur'] as const) {
    if (!within(appearance[key], DESIGN_LIMITS[key])) return { ok: false, error: `Saved style ${key} is outside the supported range.` };
  }
  const outline = record(appearance.outline);
  if (appearance.outline !== null && (!outline || !within(outline.width, DESIGN_LIMITS.outlineWidth)
    || !color(outline.color))) {
    return { ok: false, error: 'Saved style outline must have a supported width and six-digit hex color.' };
  }
  return { ok: true, value: {
    version: 1, id: style.id, name: style.name.trim(), createdAt: style.createdAt as number,
    transform: {
      rotate: transform.rotate as number, scaleX: transform.scaleX as number, scaleY: transform.scaleY as number,
      skewX: transform.skewX as number, skewY: transform.skewY as number,
      flipH: transform.flipH, flipV: transform.flipV,
    },
    appearance: {
      hue: appearance.hue as number, saturation: appearance.saturation as number,
      brightness: appearance.brightness as number, blur: appearance.blur as number,
      outline: outline && outline.width !== 0 ? { width: outline.width as number, color: (outline.color as string).toLowerCase() } : null,
    },
  } };
}

export function createEmojiStyle(id: string, name: string, createdAt: number, layer: EmojiLayer): DecodeResult<EmojiStyle> {
  return decodeEmojiStyle({ version: 1, id, name, createdAt, transform: layer.transform, appearance: layer.appearance });
}

/** Applying a style never changes where an object is or what artwork it uses. */
export function applyEmojiStyle(layer: EmojiLayer, style: EmojiStyle): EmojiLayer {
  return {
    ...layer,
    transform: { ...style.transform, x: layer.transform.x, y: layer.transform.y },
    appearance: { ...style.appearance, outline: style.appearance.outline ? { ...style.appearance.outline } : null },
  };
}
