import type { DesignDocument } from './design';
import { decodeDesignDocument, type DecodeResult } from './designCodec';

export interface WorkspaceDocument {
  readonly version: 1;
  readonly id: string;
  readonly name: string;
  readonly design: DesignDocument;
  readonly updatedAt: number;
}

export interface WorkspaceDraft {
  readonly version: 1;
  readonly documentId: string | null;
  readonly name: string;
  readonly design: DesignDocument;
  readonly updatedAt: number;
}

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;

const decodeCommon = (value: unknown, kind: 'document' | 'draft') => {
  const raw = record(value);
  if (!raw || raw.version !== 1) return { ok: false as const, error: `${kind} version is unsupported` };
  if (typeof raw.name !== 'string' || !raw.name.trim() || raw.name.length > 80) {
    return { ok: false as const, error: `${kind} name is invalid` };
  }
  if (typeof raw.updatedAt !== 'number' || !Number.isFinite(raw.updatedAt) || raw.updatedAt < 0) {
    return { ok: false as const, error: `${kind} timestamp is invalid` };
  }
  const design = decodeDesignDocument(raw.design);
  if (!design.ok) return { ok: false as const, error: `${kind} design: ${design.error}` };
  return { ok: true as const, value: { raw, name: raw.name.trim(), updatedAt: raw.updatedAt, design: design.value } };
};

export function decodeWorkspaceDocument(value: unknown): DecodeResult<WorkspaceDocument> {
  const decoded = decodeCommon(value, 'document');
  if (!decoded.ok) return decoded;
  if (typeof decoded.value.raw.id !== 'string' || !decoded.value.raw.id) {
    return { ok: false, error: 'document id is invalid' };
  }
  return { ok: true, value: { version: 1, id: decoded.value.raw.id,
    name: decoded.value.name, design: decoded.value.design, updatedAt: decoded.value.updatedAt } };
}

export function decodeWorkspaceDraft(value: unknown): DecodeResult<WorkspaceDraft> {
  const decoded = decodeCommon(value, 'draft');
  if (!decoded.ok) return decoded;
  const id = decoded.value.raw.documentId;
  if (id !== null && (typeof id !== 'string' || !id)) {
    return { ok: false, error: 'draft document id is invalid' };
  }
  return { ok: true, value: { version: 1, documentId: id as string | null,
    name: decoded.value.name, design: decoded.value.design, updatedAt: decoded.value.updatedAt } };
}
