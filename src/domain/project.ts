import type { DesignDocument } from './design';
import { decodeDesignDocument, type DecodeResult } from './designCodec';

export interface Project {
  readonly schemaVersion: 2;
  readonly id: string;
  readonly revision: number;
  readonly name: string;
  readonly design: DesignDocument;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly starredAt: number | null;
  readonly conflict: ProjectConflict | null;
}

export interface ProjectConflict {
  readonly sourceProjectId: string;
  readonly sourceRevision: number;
  readonly createdAt: number;
}

export interface CreateProjectInput {
  readonly id: string;
  readonly revision?: number;
  readonly name: string;
  readonly design: DesignDocument;
  readonly createdAt: number;
  readonly updatedAt?: number;
  readonly starredAt?: number | null;
  readonly conflict?: ProjectConflict | null;
}

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;

const validTimestamp = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

export function decodeProject(value: unknown): DecodeResult<Project> {
  const raw = record(value);
  if (!raw || raw.schemaVersion !== 2) {
    return { ok: false, error: 'project schema version is unsupported' };
  }
  if (typeof raw.id !== 'string' || !raw.id) {
    return { ok: false, error: 'project id is invalid' };
  }
  if (!Number.isInteger(raw.revision) || (raw.revision as number) < 0) {
    return { ok: false, error: 'project revision is invalid' };
  }
  if (typeof raw.name !== 'string' || !raw.name.trim() || raw.name.length > 80) {
    return { ok: false, error: 'project name is invalid' };
  }
  if (!validTimestamp(raw.createdAt) || !validTimestamp(raw.updatedAt)
      || raw.updatedAt < raw.createdAt) {
    return { ok: false, error: 'project timestamps are invalid' };
  }
  if (raw.starredAt !== null && !validTimestamp(raw.starredAt)) {
    return { ok: false, error: 'project starred timestamp is invalid' };
  }
  const rawConflict = raw.conflict === null ? null : record(raw.conflict);
  if (raw.conflict !== null && !rawConflict) {
    return { ok: false, error: 'project conflict lineage is invalid' };
  }
  if (rawConflict
      && (typeof rawConflict.sourceProjectId !== 'string' || !rawConflict.sourceProjectId
        || rawConflict.sourceProjectId === raw.id
        || !Number.isInteger(rawConflict.sourceRevision)
        || (rawConflict.sourceRevision as number) < 1
        || !validTimestamp(rawConflict.createdAt))) {
    return { ok: false, error: 'project conflict lineage is invalid' };
  }
  const design = decodeDesignDocument(raw.design);
  if (!design.ok) return { ok: false, error: `project design: ${design.error}` };
  return {
    ok: true,
    value: {
      schemaVersion: 2,
      id: raw.id,
      revision: raw.revision as number,
      name: raw.name.trim(),
      design: design.value,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
      starredAt: raw.starredAt as number | null,
      conflict: rawConflict ? {
        sourceProjectId: rawConflict.sourceProjectId as string,
        sourceRevision: rawConflict.sourceRevision as number,
        createdAt: rawConflict.createdAt as number,
      } : null,
    },
  };
}

export function createProject(input: CreateProjectInput): Project {
  const value = {
    schemaVersion: 2,
    id: input.id,
    revision: input.revision ?? 0,
    name: input.name,
    design: input.design,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt ?? input.createdAt,
    starredAt: input.starredAt ?? null,
    conflict: input.conflict ?? null,
  } as const;
  const decoded = decodeProject(value);
  if (!decoded.ok) throw new RangeError(decoded.error);
  return decoded.value;
}
