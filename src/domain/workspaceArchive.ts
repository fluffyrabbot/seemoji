import { decodeProject, type Project } from './project';
import type { DecodeResult } from './designCodec';

const ARCHIVE_FORMAT = 'seemoji-workspace';
const ARCHIVE_SCHEMA_VERSION = 1;
const MAX_PROJECTS = 1_000;

export interface WorkspaceArchiveOmission {
  readonly recordId: string | null;
  readonly error: string;
  readonly contentHash: string;
  readonly byteSize: number;
}

export interface WorkspaceArchive {
  readonly format: typeof ARCHIVE_FORMAT;
  readonly schemaVersion: typeof ARCHIVE_SCHEMA_VERSION;
  readonly exportedAt: number;
  readonly activeProjectId: string;
  readonly projects: readonly Project[];
  readonly omissions: readonly WorkspaceArchiveOmission[];
}

interface CreateWorkspaceArchiveInput {
  readonly exportedAt: number;
  readonly activeProjectId: string;
  readonly projects: readonly Project[];
  readonly omissions?: readonly WorkspaceArchiveOmission[];
}

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;

const decodeOmission = (value: unknown): DecodeResult<WorkspaceArchiveOmission> => {
  const omission = record(value);
  if (!omission
      || (omission.recordId !== null
        && (typeof omission.recordId !== 'string' || !omission.recordId))
      || typeof omission.error !== 'string'
      || !omission.error
      || omission.error.length > 500
      || typeof omission.contentHash !== 'string'
      || !/^fnv1a32:[0-9a-f]{8}$/u.test(omission.contentHash)
      || !Number.isSafeInteger(omission.byteSize)
      || (omission.byteSize as number) < 0) {
    return { ok: false, error: 'workspace archive omission is invalid' };
  }
  return {
    ok: true,
    value: {
      recordId: omission.recordId as string | null,
      error: omission.error,
      contentHash: omission.contentHash,
      byteSize: omission.byteSize as number,
    },
  };
};

const hasConflictCycle = (projects: readonly Project[]): boolean => {
  const byId = new Map(projects.map((project) => [project.id, project]));
  const completed = new Set<string>();
  for (const project of projects) {
    const path = new Set<string>();
    let current: Project | undefined = project;
    while (current?.conflict) {
      if (path.has(current.id)) return true;
      if (completed.has(current.id)) break;
      path.add(current.id);
      current = byId.get(current.conflict.sourceProjectId);
    }
    for (const id of path) completed.add(id);
  }
  return false;
};

export function decodeWorkspaceArchive(value: unknown): DecodeResult<WorkspaceArchive> {
  const archive = record(value);
  if (!archive || archive.format !== ARCHIVE_FORMAT
      || archive.schemaVersion !== ARCHIVE_SCHEMA_VERSION) {
    return { ok: false, error: 'workspace archive format is unsupported' };
  }
  if (typeof archive.exportedAt !== 'number' || !Number.isFinite(archive.exportedAt)
      || archive.exportedAt < 0) {
    return { ok: false, error: 'workspace archive timestamp is invalid' };
  }
  if (typeof archive.activeProjectId !== 'string' || !archive.activeProjectId) {
    return { ok: false, error: 'workspace archive active project is invalid' };
  }
  if (!Array.isArray(archive.projects) || archive.projects.length === 0
      || archive.projects.length > MAX_PROJECTS) {
    return { ok: false, error: `workspace archive must contain 1 to ${MAX_PROJECTS} projects` };
  }
  const projects: Project[] = [];
  const ids = new Set<string>();
  for (const [index, rawProject] of archive.projects.entries()) {
    const project = decodeProject(rawProject);
    if (!project.ok) {
      return { ok: false, error: `workspace archive project ${index + 1}: ${project.error}` };
    }
    if (project.value.revision < 1) {
      return { ok: false, error: `workspace archive project ${index + 1} was never persisted` };
    }
    if (ids.has(project.value.id)) {
      return { ok: false, error: `workspace archive project id ${project.value.id} is duplicated` };
    }
    ids.add(project.value.id);
    projects.push(project.value);
  }
  if (!ids.has(archive.activeProjectId)) {
    return { ok: false, error: 'workspace archive active project is missing' };
  }
  for (const project of projects) {
    if (project.conflict && !ids.has(project.conflict.sourceProjectId)) {
      return { ok: false, error: `workspace archive conflict source ${project.conflict.sourceProjectId} is missing` };
    }
  }
  if (hasConflictCycle(projects)) {
    return { ok: false, error: 'workspace archive conflict lineage contains a cycle' };
  }
  if (!Array.isArray(archive.omissions) || archive.omissions.length > MAX_PROJECTS) {
    return { ok: false, error: 'workspace archive omissions are invalid' };
  }
  const omissions: WorkspaceArchiveOmission[] = [];
  for (const rawOmission of archive.omissions) {
    const omission = decodeOmission(rawOmission);
    if (!omission.ok) return omission;
    omissions.push(omission.value);
  }
  return {
    ok: true,
    value: {
      format: ARCHIVE_FORMAT,
      schemaVersion: ARCHIVE_SCHEMA_VERSION,
      exportedAt: archive.exportedAt,
      activeProjectId: archive.activeProjectId,
      projects,
      omissions,
    },
  };
}

export function createWorkspaceArchive(input: CreateWorkspaceArchiveInput): WorkspaceArchive {
  const decoded = decodeWorkspaceArchive({
    format: ARCHIVE_FORMAT,
    schemaVersion: ARCHIVE_SCHEMA_VERSION,
    exportedAt: input.exportedAt,
    activeProjectId: input.activeProjectId,
    projects: input.projects,
    omissions: input.omissions ?? [],
  });
  if (!decoded.ok) throw new RangeError(decoded.error);
  return decoded.value;
}
