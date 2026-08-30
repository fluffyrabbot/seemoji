import { DEFAULT_DESIGN, type DesignDocument } from '../domain/design';
import { createProject, type Project } from '../domain/project';
import {
  createProjectQuarantineExport,
  type ProjectQuarantineExport,
  type ProjectQuarantineRecord,
} from '../domain/projectQuarantine';
import {
  createWorkspaceArchive,
  decodeWorkspaceArchive,
  type WorkspaceArchive,
  type WorkspaceArchiveOmission,
} from '../domain/workspaceArchive';
import {
  ProjectConflictError,
  ProjectQuarantineConflictError,
  type ProjectConflictResolution,
  type ProjectRecordIssue,
  type ProjectRepository,
} from '../ports/projectRepository';
import type { WorkspaceChange, WorkspaceSync } from '../ports/workspaceSync';

export type { ProjectConflictResolution } from '../ports/projectRepository';

export type WorkspacePersistenceStatus = 'saved' | 'saving' | 'conflict' | 'error';

export interface WorkspaceSnapshot {
  readonly projects: readonly Project[];
  readonly activeProject: Project;
  readonly issues: readonly ProjectRecordIssue[];
}

export interface WorkspaceArchiveImportResult {
  readonly workspace: WorkspaceSnapshot;
  readonly importedProjectCount: number;
  readonly archivedOmissions: readonly WorkspaceArchiveOmission[];
}

interface ControllerOptions {
  readonly clock?: () => number;
  readonly createId?: () => string;
  readonly debounceMilliseconds?: number;
  readonly sync?: WorkspaceSync | null;
  readonly scheduler?: WorkspaceScheduler;
}

export interface WorkspaceScheduler {
  schedule(callback: () => void, delayMilliseconds: number): unknown;
  cancel(handle: unknown): void;
  defer(callback: () => void): void;
}

const DEFAULT_SCHEDULER: WorkspaceScheduler = {
  schedule: (callback, delayMilliseconds) => globalThis.setTimeout(callback, delayMilliseconds),
  cancel: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>),
  defer: (callback) => queueMicrotask(callback),
};

const byUpdatedAt = (projects: readonly Project[]): readonly Project[] =>
  [...projects].sort((a, b) => b.updatedAt - a.updatedAt);

export class WorkspaceController {
  readonly #repository: ProjectRepository;
  readonly #clock: () => number;
  readonly #createId: () => string;
  readonly #debounceMilliseconds: number;
  readonly #sync: WorkspaceSync | null;
  readonly #scheduler: WorkspaceScheduler;
  readonly #statusListeners = new Set<(status: WorkspacePersistenceStatus) => void>();
  readonly #workspaceListeners = new Set<(workspace: WorkspaceSnapshot) => void>();
  readonly #persistedRevisions = new Map<string, number>();
  #projects: readonly Project[] = [];
  #activeProjectId: string | null = null;
  #issues: readonly ProjectRecordIssue[] = [];
  #pendingProject: Project | null = null;
  #saveTimer: unknown | null = null;
  #writeChain: Promise<void> = Promise.resolve();
  #writesInFlight = 0;
  #remoteRefreshPending = false;
  #loaded = false;
  #disposed = false;
  #status: WorkspacePersistenceStatus = 'saved';
  #unsubscribeSync: (() => void) | null = null;

  constructor(repository: ProjectRepository, options: ControllerOptions = {}) {
    this.#repository = repository;
    this.#clock = options.clock ?? Date.now;
    this.#createId = options.createId ?? (() => crypto.randomUUID());
    this.#debounceMilliseconds = options.debounceMilliseconds ?? 250;
    this.#sync = options.sync ?? null;
    this.#scheduler = options.scheduler ?? DEFAULT_SCHEDULER;
    this.#unsubscribeSync = this.#sync?.subscribe((change) => {
      void this.#onExternalChange(change).catch(() => this.#notifyStatus('error'));
    }) ?? null;
  }

  subscribeStatus(listener: (status: WorkspacePersistenceStatus) => void): () => void {
    this.#statusListeners.add(listener);
    return () => this.#statusListeners.delete(listener);
  }

  subscribeWorkspace(listener: (workspace: WorkspaceSnapshot) => void): () => void {
    this.#workspaceListeners.add(listener);
    return () => this.#workspaceListeners.delete(listener);
  }

  get persistenceStatus(): WorkspacePersistenceStatus {
    return this.#status;
  }

  async load(): Promise<WorkspaceSnapshot> {
    const loaded = await this.#repository.load();
    this.#adoptLoaded(loaded.projects, loaded.activeProjectId, loaded.issues);
    const requested = this.#projects.find((project) => project.id === this.#activeProjectId);
    if (requested) {
      this.#loaded = true;
      return this.snapshot();
    }
    const existing = this.#projects[0];
    if (existing) {
      this.#activeProjectId = existing.id;
      await this.#repository.setActive(existing.id);
      this.#loaded = true;
      return this.snapshot();
    }
    const created = this.#newProject(DEFAULT_DESIGN, 'Untitled design');
    const persisted = await this.#repository.save(created, {
      activate: true,
      expectedRevision: null,
    });
    this.#projects = [persisted];
    this.#persistedRevisions.set(persisted.id, persisted.revision);
    this.#activeProjectId = persisted.id;
    this.#loaded = true;
    this.#publish([persisted.id]);
    return this.snapshot();
  }

  snapshot(): WorkspaceSnapshot {
    const activeProject = this.#projects.find((project) => project.id === this.#activeProjectId);
    if (!activeProject) throw new Error('Workspace has no active project');
    return { projects: this.#projects, activeProject, issues: this.#issues };
  }

  updateActive(name: string, design: DesignDocument): WorkspaceSnapshot {
    const current = this.snapshot().activeProject;
    const project: Project = {
      ...current,
      name: name.trim() || 'Untitled design',
      design,
      updatedAt: Math.max(this.#clock(), current.createdAt),
    };
    this.#replace(project);
    this.#pendingProject = project;
    this.#scheduleSave();
    return this.snapshot();
  }

  async flush(): Promise<void> {
    if (this.#saveTimer !== null) {
      this.#scheduler.cancel(this.#saveTimer);
      this.#saveTimer = null;
    }
    const pending = this.#pendingProject;
    if (!pending) return this.#writeChain;
    this.#pendingProject = null;
    await this.#enqueue(async () => {
      try {
        await this.#persistExisting(pending);
        if (!this.#pendingProject) this.#notifyStatus('saved');
      } catch (cause) {
        if (cause instanceof ProjectConflictError) {
          await this.#preserveConflictCopy(pending, cause);
          return;
        }
        this.#notifyStatus('error');
        throw cause;
      }
    });
  }

  async create(
    design: DesignDocument = DEFAULT_DESIGN,
    name = 'Untitled design',
  ): Promise<WorkspaceSnapshot> {
    await this.flush();
    const created = this.#newProject(design, name.trim() || 'Untitled design');
    const persisted = await this.#enqueue(() => this.#repository.save(created, {
      activate: true,
      expectedRevision: null,
    }));
    this.#projects = byUpdatedAt([...this.#projects, persisted]);
    this.#persistedRevisions.set(persisted.id, persisted.revision);
    this.#activeProjectId = persisted.id;
    this.#publish([persisted.id]);
    this.#notifyStatus('saved');
    return this.snapshot();
  }

  async activate(id: string): Promise<WorkspaceSnapshot> {
    if (id === this.#activeProjectId) return this.snapshot();
    if (!this.#projects.some((project) => project.id === id)) {
      throw new Error(`Project ${id} does not exist`);
    }
    await this.flush();
    await this.#enqueue(() => this.#repository.setActive(id));
    this.#activeProjectId = id;
    this.#publish([id]);
    this.#notifyStatus('saved');
    return this.snapshot();
  }

  async deleteActive(): Promise<WorkspaceSnapshot> {
    await this.flush();
    const deleting = this.snapshot().activeProject;
    const remaining = this.#projects.filter((project) => project.id !== deleting.id);
    const existing = remaining[0] ?? null;
    const replacement = existing ? null : this.#newProject(DEFAULT_DESIGN, 'Untitled design');
    const active = existing ?? replacement!;
    try {
      const persistedReplacement = await this.#enqueue(() => this.#repository.deleteAndActivate(
        deleting.id,
        this.#revisionOf(deleting.id),
        active.id,
        replacement,
      ));
      this.#persistedRevisions.delete(deleting.id);
      if (persistedReplacement) {
        this.#persistedRevisions.set(persistedReplacement.id, persistedReplacement.revision);
      }
      this.#projects = byUpdatedAt(persistedReplacement ? [persistedReplacement] : remaining);
      this.#activeProjectId = active.id;
      this.#publish([deleting.id, active.id]);
      this.#notifyStatus('saved');
      return this.snapshot();
    } catch (cause) {
      if (cause instanceof ProjectConflictError) {
        await this.#refreshFromRepository();
        this.#notifyStatus('conflict');
      }
      throw cause;
    }
  }

  async toggleStar(id: string): Promise<WorkspaceSnapshot> {
    await this.flush();
    const project = this.#projects.find((candidate) => candidate.id === id);
    if (!project) throw new Error(`Project ${id} does not exist`);
    const updated: Project = {
      ...project,
      starredAt: project.starredAt === null ? this.#clock() : null,
    };
    try {
      const persisted = await this.#enqueue(() => this.#repository.save(updated, {
        activate: false,
        expectedRevision: this.#revisionOf(id),
      }));
      this.#persistedRevisions.set(id, persisted.revision);
      this.#replace(persisted);
      this.#publish([id]);
      this.#notifyStatus('saved');
      return this.snapshot();
    } catch (cause) {
      if (cause instanceof ProjectConflictError) {
        await this.#refreshFromRepository();
        this.#notifyStatus('conflict');
      }
      throw cause;
    }
  }

  async useAsTemplate(id: string): Promise<WorkspaceSnapshot> {
    await this.flush();
    const source = this.#projects.find((project) => project.id === id);
    if (!source) throw new Error(`Project ${id} does not exist`);
    const created = this.#newProject(source.design, `${source.name} copy`.slice(0, 80));
    const persisted = await this.#enqueue(() => this.#repository.save(created, {
      activate: true,
      expectedRevision: null,
    }));
    this.#persistedRevisions.set(persisted.id, persisted.revision);
    this.#projects = byUpdatedAt([...this.#projects, persisted]);
    this.#activeProjectId = persisted.id;
    this.#publish([persisted.id]);
    this.#notifyStatus('saved');
    return this.snapshot();
  }

  async resolveConflict(
    conflictProjectId: string,
    resolution: ProjectConflictResolution,
  ): Promise<WorkspaceSnapshot> {
    await this.flush();
    const conflictProject = this.#projects.find((project) => project.id === conflictProjectId);
    if (!conflictProject?.conflict) {
      throw new Error(`Project ${conflictProjectId} is not an unresolved conflict`);
    }
    const source = this.#projects.find(
      (project) => project.id === conflictProject.conflict!.sourceProjectId,
    );
    if (!source) throw new Error('The original project is no longer available');
    try {
      await this.#enqueue(() => this.#repository.resolveConflict({
        conflictProjectId,
        expectedConflictRevision: this.#revisionOf(conflictProjectId),
        sourceProjectId: source.id,
        expectedSourceRevision: this.#revisionOf(source.id),
        resolution,
        resolvedAt: this.#clock(),
      }));
      const loaded = await this.#repository.load();
      const activeProjectId = loaded.projects.some(
        (project) => project.id === loaded.activeProjectId,
      ) ? loaded.activeProjectId : loaded.projects[0]?.id ?? null;
      this.#adoptLoaded(loaded.projects, activeProjectId, loaded.issues);
      this.#publish([conflictProjectId, source.id]);
      this.#notifyWorkspace();
      this.#notifyStatus('saved');
      return this.snapshot();
    } catch (cause) {
      if (cause instanceof ProjectConflictError) {
        await this.#refreshFromRepository();
        this.#notifyStatus('conflict');
      }
      throw cause;
    }
  }

  async exportArchive(): Promise<WorkspaceArchive> {
    await this.flush();
    const workspace = this.snapshot();
    return createWorkspaceArchive({
      exportedAt: this.#clock(),
      activeProjectId: workspace.activeProject.id,
      projects: workspace.projects,
      omissions: workspace.issues.map((issue) => ({
        recordId: issue.recordId,
        error: issue.error,
        contentHash: issue.contentHash,
        byteSize: issue.byteSize,
      })),
    });
  }

  async exportQuarantinedRecord(
    expected: ProjectQuarantineRecord,
  ): Promise<ProjectQuarantineExport> {
    await this.flush();
    try {
      const current = await this.#enqueue(() => this.#repository.readQuarantinedRecord(expected));
      return createProjectQuarantineExport(current, this.#clock());
    } catch (cause) {
      if (cause instanceof ProjectQuarantineConflictError) await this.#refreshFromRepository();
      throw cause;
    }
  }

  async purgeQuarantinedRecord(
    expected: ProjectQuarantineRecord,
  ): Promise<WorkspaceSnapshot> {
    await this.flush();
    try {
      await this.#enqueue(() => this.#repository.purgeQuarantinedRecord(expected));
      await this.#refreshFromRepository();
      this.#publish([expected.recordId ?? expected.contentHash]);
      this.#notifyStatus('saved');
      return this.snapshot();
    } catch (cause) {
      if (cause instanceof ProjectQuarantineConflictError) await this.#refreshFromRepository();
      throw cause;
    }
  }

  async importArchive(value: unknown): Promise<WorkspaceArchiveImportResult> {
    const archive = decodeWorkspaceArchive(value);
    if (!archive.ok) throw new Error(archive.error);
    await this.flush();
    const reservedIds = new Set(this.#projects.map((project) => project.id));
    const importedIds = new Map<string, string>();
    for (const project of archive.value.projects) {
      const importedId = this.#createId();
      if (!importedId || reservedIds.has(importedId)) {
        throw new Error(`Imported project identity collided with ${importedId || 'an empty id'}`);
      }
      reservedIds.add(importedId);
      importedIds.set(project.id, importedId);
    }
    const projects = archive.value.projects.map((project) => createProject({
      id: importedIds.get(project.id)!,
      name: project.name,
      design: project.design,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      starredAt: project.starredAt,
      conflict: project.conflict ? {
        sourceProjectId: importedIds.get(project.conflict.sourceProjectId)!,
        sourceRevision: 1,
        createdAt: project.conflict.createdAt,
      } : null,
    }));
    const activeProjectId = importedIds.get(archive.value.activeProjectId)!;
    await this.#enqueue(() => this.#repository.importProjects(projects, activeProjectId));
    const loaded = await this.#repository.load();
    this.#adoptLoaded(loaded.projects, activeProjectId, loaded.issues);
    this.#publish(projects.map((project) => project.id));
    this.#notifyWorkspace();
    this.#notifyStatus('saved');
    return {
      workspace: this.snapshot(),
      importedProjectCount: projects.length,
      archivedOmissions: archive.value.omissions,
    };
  }

  dispose(): void {
    if (this.#disposed) return;
    void this.flush().catch(() => this.#notifyStatus('error'));
    this.#disposed = true;
    this.#unsubscribeSync?.();
    this.#unsubscribeSync = null;
    this.#sync?.close();
    this.#workspaceListeners.clear();
    this.#statusListeners.clear();
  }

  #newProject(design: DesignDocument, name: string): Project {
    const now = this.#clock();
    return createProject({ id: this.#createId(), name, design, createdAt: now });
  }

  async #persistExisting(desired: Project): Promise<void> {
    const expectedRevision = this.#revisionOf(desired.id);
    const candidate = { ...desired, revision: expectedRevision };
    const persisted = await this.#repository.save(candidate, {
      activate: false,
      expectedRevision,
    });
    this.#persistedRevisions.set(persisted.id, persisted.revision);
    const current = this.#projects.find((project) => project.id === persisted.id);
    this.#replace(current === desired ? persisted : { ...(current ?? persisted), revision: persisted.revision });
    this.#publish([persisted.id]);
  }

  async #preserveConflictCopy(stale: Project, conflict: ProjectConflictError): Promise<void> {
    const current = this.#projects.find((project) => project.id === stale.id) ?? stale;
    if (this.#pendingProject?.id === stale.id) this.#pendingProject = null;
    const now = this.#clock();
    const sourceRevision = this.#revisionOf(stale.id);
    let copy = createProject({
      id: this.#createId(),
      name: `${current.name.replace(/ \(conflict copy\)$/u, '')} (conflict copy)`.slice(0, 80),
      design: current.design,
      createdAt: now,
      updatedAt: now,
      conflict: {
        sourceProjectId: stale.id,
        sourceRevision,
        createdAt: now,
      },
    });
    let latestSource = conflict.latestProject;
    let persistedCopy: Project | null = null;
    for (let attempt = 0; latestSource && attempt < 3 && !persistedCopy; attempt += 1) {
      try {
        persistedCopy = await this.#repository.preserveConflict(copy, latestSource.revision);
      } catch (cause) {
        if (!(cause instanceof ProjectConflictError)) throw cause;
        latestSource = cause.latestProject;
      }
    }
    if (!persistedCopy) {
      copy = { ...copy,
        name: `${current.name.replace(/ \(conflict copy\)$/u, '')} (recovered copy)`.slice(0, 80),
        conflict: null };
      persistedCopy = await this.#repository.save(copy, {
        activate: true,
        expectedRevision: null,
      });
    }
    const loaded = await this.#repository.load();
    this.#adoptLoaded(loaded.projects, persistedCopy.id, loaded.issues);
    this.#publish([stale.id, persistedCopy.id]);
    this.#notifyWorkspace();
    this.#notifyStatus('conflict');
  }

  async #onExternalChange(_change: WorkspaceChange): Promise<void> {
    if (!this.#loaded || this.#disposed) return;
    if (this.#pendingProject || this.#writesInFlight > 0) {
      this.#remoteRefreshPending = true;
      return;
    }
    await this.#enqueue(() => this.#refreshFromRepository());
  }

  async #refreshFromRepository(): Promise<void> {
    if (this.#disposed) return;
    const loaded = await this.#repository.load();
    const previousActive = this.#activeProjectId;
    const nextActive = loaded.projects.some((project) => project.id === loaded.activeProjectId)
      ? loaded.activeProjectId
      : loaded.projects.some((project) => project.id === previousActive)
        ? previousActive
        : loaded.projects[0]?.id ?? null;
    this.#adoptLoaded(loaded.projects, nextActive, loaded.issues);
    if (this.#projects.length === 0 || !this.#activeProjectId) return;
    this.#notifyWorkspace();
  }

  #adoptLoaded(
    projects: readonly Project[],
    activeProjectId: string | null,
    issues: readonly ProjectRecordIssue[],
  ): void {
    this.#projects = byUpdatedAt(projects);
    this.#activeProjectId = activeProjectId;
    this.#issues = issues;
    this.#persistedRevisions.clear();
    for (const project of projects) this.#persistedRevisions.set(project.id, project.revision);
  }

  #revisionOf(id: string): number {
    const revision = this.#persistedRevisions.get(id);
    if (revision === undefined) throw new Error(`Project ${id} has no persisted revision`);
    return revision;
  }

  #replace(project: Project): void {
    this.#projects = byUpdatedAt(this.#projects.map((current) =>
      current.id === project.id ? project : current));
  }

  #scheduleSave(): void {
    if (this.#saveTimer !== null) this.#scheduler.cancel(this.#saveTimer);
    this.#notifyStatus('saving');
    this.#saveTimer = this.#scheduler.schedule(() => {
      this.#saveTimer = null;
      void this.flush().catch(() => undefined);
    }, this.#debounceMilliseconds);
  }

  #enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const execute = async () => {
      this.#writesInFlight += 1;
      try {
        return await operation();
      } finally {
        this.#writesInFlight -= 1;
        if (this.#writesInFlight === 0 && this.#remoteRefreshPending && !this.#pendingProject) {
          this.#remoteRefreshPending = false;
          this.#scheduler.defer(() => {
            void this.#refreshFromRepository().catch(() => this.#notifyStatus('error'));
          });
        }
      }
    };
    const pending = this.#writeChain.then(execute, execute);
    this.#writeChain = pending.then(() => undefined, () => undefined);
    return pending;
  }

  #publish(projectIds: readonly string[]): void {
    this.#sync?.publish({ projectIds });
  }

  #notifyStatus(status: WorkspacePersistenceStatus): void {
    this.#status = status;
    for (const listener of this.#statusListeners) listener(status);
  }

  #notifyWorkspace(): void {
    const workspace = this.snapshot();
    for (const listener of this.#workspaceListeners) listener(workspace);
  }
}
