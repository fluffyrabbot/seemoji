import type { Project } from '../domain/project';
import type { ProjectQuarantineRecord } from '../domain/projectQuarantine';

export interface ProjectWorkspace {
  readonly projects: readonly Project[];
  readonly activeProjectId: string | null;
  readonly issues: readonly ProjectRecordIssue[];
}

export type ProjectRecordIssue = ProjectQuarantineRecord;

export class ProjectQuarantineConflictError extends Error {
  constructor(message = 'The quarantined record changed before the operation completed') {
    super(message);
    this.name = 'ProjectQuarantineConflictError';
  }
}

export class ProjectConflictError extends Error {
  readonly latestProject: Project | null;

  constructor(message: string, latestProject: Project | null) {
    super(message);
    this.name = 'ProjectConflictError';
    this.latestProject = latestProject;
  }
}

export interface ProjectSaveOptions {
  readonly activate: boolean;
  readonly expectedRevision: number | null;
}

export type ProjectConflictResolution = 'keep-source' | 'keep-conflict' | 'keep-both';

export interface ResolveProjectConflictInput {
  readonly conflictProjectId: string;
  readonly expectedConflictRevision: number;
  readonly sourceProjectId: string;
  readonly expectedSourceRevision: number;
  readonly resolution: ProjectConflictResolution;
  readonly resolvedAt: number;
}

export interface ProjectRepository {
  load(): Promise<ProjectWorkspace>;
  save(project: Project, options: ProjectSaveOptions): Promise<Project>;
  importProjects(projects: readonly Project[], activeProjectId: string): Promise<void>;
  readQuarantinedRecord(expected: ProjectQuarantineRecord): Promise<ProjectQuarantineRecord>;
  purgeQuarantinedRecord(expected: ProjectQuarantineRecord): Promise<void>;
  preserveConflict(project: Project, expectedSourceRevision: number): Promise<Project>;
  setActive(id: string): Promise<void>;
  deleteAndActivate(
    id: string,
    expectedRevision: number,
    activeProjectId: string,
    replacement: Project | null,
  ): Promise<Project | null>;
  resolveConflict(input: ResolveProjectConflictInput): Promise<void>;
}
