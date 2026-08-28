import { decodeDesignDocument, type DecodeResult } from './designCodec';
import type { DesignDocument } from './design';

export interface Favorite {
  readonly id: string;
  readonly name: string;
  readonly design: DesignDocument;
  readonly createdAt: number;
}

interface CreateFavoriteInput {
  readonly id: string;
  readonly name: string;
  readonly design: DesignDocument;
  readonly createdAt: number;
}

export function createFavorite(input: CreateFavoriteInput): Favorite {
  const normalizedName = input.name.trim();
  if (!normalizedName || normalizedName.length > 80) {
    throw new RangeError('favorite name must contain between 1 and 80 characters');
  }
  if (!input.id || !Number.isFinite(input.createdAt) || input.createdAt < 0) {
    throw new RangeError('favorite identity and timestamp must be valid');
  }
  return {
    id: input.id,
    name: normalizedName,
    design: input.design,
    createdAt: input.createdAt,
  };
}

export function decodeFavorite(value: unknown): DecodeResult<Favorite> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, error: 'favorite must be an object' };
  }
  const favorite = value as Record<string, unknown>;
  if (typeof favorite.id !== 'string' || !favorite.id) {
    return { ok: false, error: 'favorite.id must be a non-empty string' };
  }
  if (
    typeof favorite.name !== 'string' ||
    !favorite.name.trim() ||
    favorite.name.length > 80
  ) {
    return { ok: false, error: 'favorite.name is invalid' };
  }
  if (
    typeof favorite.createdAt !== 'number' ||
    !Number.isFinite(favorite.createdAt) ||
    favorite.createdAt < 0
  ) {
    return { ok: false, error: 'favorite.createdAt is invalid' };
  }
  const design = decodeDesignDocument(favorite.design);
  if (!design.ok) return { ok: false, error: `favorite.design: ${design.error}` };
  return {
    ok: true,
    value: {
      id: favorite.id,
      name: favorite.name.trim(),
      design: design.value,
      createdAt: favorite.createdAt,
    },
  };
}
