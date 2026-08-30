import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_DESIGN } from '../domain/design';
import type { Project } from '../domain/project';
import { createProject } from '../domain/project';
import {
  createProjectQuarantineRecord,
  sameProjectQuarantineRecord,
  type ProjectQuarantineRecord,
} from '../domain/projectQuarantine';
import { createWorkspaceArchive } from '../domain/workspaceArchive';
import {
  ProjectConflictError,
  ProjectQuarantineConflictError,
  type ProjectRepository,
  type ProjectSaveOptions,
  type ProjectWorkspace,
  type ResolveProjectConflictInput,
} from '../ports/projectRepository';
import type { WorkspaceChange, WorkspaceSync } from '../ports/workspaceSync';
import { WorkspaceController } from './workspaceController';

class MemoryProjectRepository implements ProjectRepository {
  projects: Project[] = [];
  activeProjectId: string | null = null;
  issues: ProjectWorkspace['issues'] = [];
  writes: string[] = [];
  beforeLoad: (() => Promise<void>) | null = null;
  beforeSave: ((project: Project) => Promise<void>) | null = null;
  beforePreserve: ((project: Project) => Promise<void>) | null = null;
  beforeSetActive: ((id: string, expectedRevision: number) => Promise<void>) | null = null;
  beforeDeleteAndActivate: ((id: string, activeProjectId: string) => Promise<void>) | null = null;

  async load(): Promise<ProjectWorkspace> {
    await this.beforeLoad?.();
    return { projects: this.projects, activeProjectId: this.activeProjectId, issues: this.issues };
  }

  async save(project: Project, options: ProjectSaveOptions): Promise<Project> {
    await this.beforeSave?.(project);
    const existing = this.projects.find(({ id }) => id === project.id) ?? null;
    const matches = options.expectedRevision === null
      ? existing === null : existing?.revision === options.expectedRevision;
    if (!matches) throw new ProjectConflictError('stale project', existing);
    const persisted = { ...project, revision: (options.expectedRevision ?? 0) + 1 };
    this.projects = [...this.projects.filter(({ id }) => id !== project.id), persisted];
    if (options.activate) this.activeProjectId = project.id;
    this.writes.push(`save:${project.id}:${project.name}`);
    return persisted;
  }

  async importProjects(projects: readonly Project[], activeProjectId: string): Promise<void> {
    if (projects.some((project) => this.projects.some(({ id }) => id === project.id))) {
      throw new Error('import identity collision');
    }
    const persisted = projects.map((project) => ({ ...project, revision: 1 }));
    this.projects = [...this.projects, ...persisted];
    this.activeProjectId = activeProjectId;
    this.writes.push(`import:${projects.map(({ id }) => id).join(',')}`);
  }

  async readQuarantinedRecord(
    expected: ProjectQuarantineRecord,
  ): Promise<ProjectQuarantineRecord> {
    const current = this.issues.find((issue) => sameProjectQuarantineRecord(issue, expected));
    if (!current) throw new ProjectQuarantineConflictError();
    return current;
  }

  async purgeQuarantinedRecord(expected: ProjectQuarantineRecord): Promise<void> {
    const current = this.issues.find((issue) => sameProjectQuarantineRecord(issue, expected));
    if (!current) throw new ProjectQuarantineConflictError();
    this.issues = this.issues.filter((issue) => issue !== current);
    this.writes.push(`purge:${current.contentHash}`);
  }

  async preserveConflict(project: Project, expectedSourceRevision: number): Promise<Project> {
    await this.beforePreserve?.(project);
    const source = this.projects.find(({ id }) => id === project.conflict?.sourceProjectId) ?? null;
    if (this.projects.some(({ id }) => id === project.id)
        || source?.revision !== expectedSourceRevision) {
      throw new ProjectConflictError('stale conflict source', source);
    }
    const persisted = { ...project, revision: 1 };
    this.projects.push(persisted);
    this.activeProjectId = persisted.id;
    this.writes.push(`preserve:${project.id}:${source.id}`);
    return persisted;
  }

  async setActive(id: string, expectedRevision: number): Promise<void> {
    await this.beforeSetActive?.(id, expectedRevision);
    const project = this.projects.find((candidate) => candidate.id === id) ?? null;
    if (project?.revision !== expectedRevision) {
      throw new ProjectConflictError('stale active project', project);
    }
    this.activeProjectId = id;
    this.writes.push(`active:${id}`);
  }

  async deleteAndActivate(
    id: string,
    expectedRevision: number,
    activeProjectId: string,
    replacement: Project | null,
  ): Promise<Project | null> {
    await this.beforeDeleteAndActivate?.(id, activeProjectId);
    const existing = this.projects.find((project) => project.id === id) ?? null;
    if (existing?.revision !== expectedRevision) {
      throw new ProjectConflictError('stale project', existing);
    }
    if (this.projects.some((project) => project.conflict?.sourceProjectId === id)) {
      throw new ProjectConflictError('project has unresolved conflicts', existing);
    }
    const requestedActive = this.projects.find((project) => project.id === activeProjectId) ?? null;
    if (!replacement && !requestedActive) {
      throw new ProjectConflictError('active survivor is missing', null);
    }
    if (replacement && (replacement.id !== activeProjectId || requestedActive)) {
      throw new ProjectConflictError('replacement identity is unavailable', requestedActive);
    }
    this.projects = this.projects.filter((project) => project.id !== id);
    const persistedReplacement = replacement ? { ...replacement, revision: 1 } : null;
    if (persistedReplacement) this.projects.push(persistedReplacement);
    this.activeProjectId = activeProjectId;
    this.writes.push(`delete:${id}:active:${activeProjectId}`);
    return persistedReplacement;
  }

  async resolveConflict(input: ResolveProjectConflictInput): Promise<void> {
    const conflict = this.projects.find((project) => project.id === input.conflictProjectId);
    const source = this.projects.find((project) => project.id === input.sourceProjectId);
    if (conflict?.revision !== input.expectedConflictRevision
        || conflict.conflict?.sourceProjectId !== input.sourceProjectId
        || source?.revision !== input.expectedSourceRevision) {
      throw new ProjectConflictError('stale conflict pair', conflict ?? source ?? null);
    }
    if (input.resolution === 'keep-source') {
      this.projects = this.projects.filter((project) => project.id !== conflict.id);
      this.activeProjectId = source.id;
    } else if (input.resolution === 'keep-conflict') {
      const promoted = {
        ...source,
        revision: source.revision + 1,
        name: conflict.name.replace(/ \(conflict copy\)$/u, ''),
        design: conflict.design,
        updatedAt: Math.max(input.resolvedAt, source.updatedAt),
      };
      this.projects = [
        ...this.projects.filter((project) => project.id !== conflict.id && project.id !== source.id),
        promoted,
      ];
      this.activeProjectId = promoted.id;
    } else {
      const independent = {
        ...conflict,
        revision: conflict.revision + 1,
        name: conflict.name.replace(/ \(conflict copy\)$/u, ''),
        updatedAt: Math.max(input.resolvedAt, conflict.updatedAt),
        conflict: null,
      };
      this.projects = [
        ...this.projects.filter((project) => project.id !== conflict.id),
        independent,
      ];
      this.activeProjectId = independent.id;
    }
    this.writes.push(`resolve:${conflict.id}:${input.resolution}`);
  }
}

class ManualWorkspaceSync implements WorkspaceSync {
  listener: ((change: WorkspaceChange) => void) | null = null;

  subscribe(listener: (change: WorkspaceChange) => void): () => void {
    this.listener = listener;
    return () => { if (this.listener === listener) this.listener = null; };
  }

  publish(_change: WorkspaceChange): void {}

  emit(change: WorkspaceChange): void {
    this.listener?.(change);
  }

  close(): void {
    this.listener = null;
  }
}

describe('WorkspaceController', () => {
  it('creates one canonical project and debounces its autosave', async () => {
    vi.useFakeTimers();
    const repository = new MemoryProjectRepository();
    const ids = ['one'];
    const controller = new WorkspaceController(repository, {
      clock: () => 10,
      createId: () => ids.shift()!,
      debounceMilliseconds: 100,
    });
    const loaded = await controller.load();
    expect(loaded.activeProject.id).toBe('one');

    controller.updateActive('Renamed', DEFAULT_DESIGN);
    controller.updateActive('Latest', DEFAULT_DESIGN);
    expect(repository.writes).toEqual(['save:one:Untitled design']);
    await vi.advanceTimersByTimeAsync(100);
    expect(repository.writes).toEqual(['save:one:Untitled design', 'save:one:Latest']);
    vi.useRealTimers();
  });

  it('deletes the last project and installs its replacement atomically', async () => {
    const repository = new MemoryProjectRepository();
    const ids = ['one', 'two'];
    const controller = new WorkspaceController(repository, {
      clock: () => 10,
      createId: () => ids.shift()!,
    });
    await controller.load();
    const workspace = await controller.deleteActive();
    expect(workspace.activeProject.id).toBe('two');
    expect(repository.writes.at(-1)).toBe('delete:one:active:two');
  });

  it('does not activate a project deleted after local validation', async () => {
    const repository = new MemoryProjectRepository();
    const ids = ['one', 'two'];
    const controller = new WorkspaceController(repository, {
      clock: () => 10,
      createId: () => ids.shift()!,
    });
    const first = await controller.load();
    const second = await controller.create(DEFAULT_DESIGN, 'Second');
    await controller.activate(first.activeProject.id);
    let reportActivationStarted!: () => void;
    let releaseActivation!: () => void;
    const activationStarted = new Promise<void>((resolve) => { reportActivationStarted = resolve; });
    repository.beforeSetActive = async (id) => {
      if (id !== second.activeProject.id) return;
      reportActivationStarted();
      await new Promise<void>((resolve) => { releaseActivation = resolve; });
    };

    const activation = controller.activate(second.activeProject.id);
    await activationStarted;
    repository.projects = repository.projects.filter(({ id }) => id !== second.activeProject.id);
    releaseActivation();

    await expect(activation).rejects.toBeInstanceOf(ProjectConflictError);
    expect(repository.activeProjectId).toBe(first.activeProject.id);
    expect(controller.snapshot().activeProject.id).toBe(first.activeProject.id);
    controller.dispose();
  });

  it('does not delete the active project after its chosen survivor disappears', async () => {
    const repository = new MemoryProjectRepository();
    const ids = ['one', 'two'];
    const controller = new WorkspaceController(repository, {
      clock: () => 10,
      createId: () => ids.shift()!,
    });
    const first = await controller.load();
    const second = await controller.create(DEFAULT_DESIGN, 'Second');
    await controller.activate(first.activeProject.id);
    let reportDeletionStarted!: () => void;
    let releaseDeletion!: () => void;
    const deletionStarted = new Promise<void>((resolve) => { reportDeletionStarted = resolve; });
    repository.beforeDeleteAndActivate = async (id) => {
      if (id !== first.activeProject.id) return;
      reportDeletionStarted();
      await new Promise<void>((resolve) => { releaseDeletion = resolve; });
    };

    const deleting = controller.deleteActive();
    await deletionStarted;
    repository.projects = repository.projects.filter(({ id }) => id !== second.activeProject.id);
    releaseDeletion();

    await expect(deleting).rejects.toBeInstanceOf(ProjectConflictError);
    expect(repository.projects).toEqual([
      expect.objectContaining({ id: first.activeProject.id }),
    ]);
    expect(repository.activeProjectId).toBe(first.activeProject.id);
    expect(controller.snapshot().activeProject.id).toBe(first.activeProject.id);
    controller.dispose();
  });

  it('serializes writes so an older save cannot finish after a newer save', async () => {
    const repository = new MemoryProjectRepository();
    const controller = new WorkspaceController(repository, {
      clock: () => 10,
      createId: () => 'one',
    });
    await controller.load();
    let releaseFirst!: () => void;
    repository.beforeSave = (project) => project.name === 'First'
      ? new Promise<void>((resolve) => { releaseFirst = resolve; })
      : Promise.resolve();

    controller.updateActive('First', DEFAULT_DESIGN);
    const first = controller.flush();
    await Promise.resolve();
    controller.updateActive('Latest', DEFAULT_DESIGN);
    const latest = controller.flush();
    await Promise.resolve();
    expect(repository.writes.at(-1)).toBe('save:one:Untitled design');

    releaseFirst();
    await Promise.all([first, latest]);
    expect(repository.writes.slice(-2)).toEqual(['save:one:First', 'save:one:Latest']);
    expect(repository.projects[0]?.name).toBe('Latest');
  });

  it('keeps the persistence guard raised until the latest queued generation is durable', async () => {
    const repository = new MemoryProjectRepository();
    const controller = new WorkspaceController(repository, {
      clock: () => 10,
      createId: () => 'one',
      debounceMilliseconds: 60_000,
    });
    await controller.load();
    let releaseFirst!: () => void;
    let releaseLatest!: () => void;
    let reportFirstStarted!: () => void;
    let reportLatestStarted!: () => void;
    const firstStarted = new Promise<void>((resolve) => { reportFirstStarted = resolve; });
    const latestStarted = new Promise<void>((resolve) => { reportLatestStarted = resolve; });
    repository.beforeSave = (project) => {
      if (project.name === 'First') {
        reportFirstStarted();
        return new Promise<void>((resolve) => { releaseFirst = resolve; });
      }
      if (project.name === 'Latest') {
        reportLatestStarted();
        return new Promise<void>((resolve) => { releaseLatest = resolve; });
      }
      return Promise.resolve();
    };

    controller.updateActive('First', DEFAULT_DESIGN);
    const first = controller.flush();
    await firstStarted;
    controller.updateActive('Latest', DEFAULT_DESIGN);
    const latest = controller.flush();
    releaseFirst();
    await latestStarted;

    expect(controller.persistenceStatus).toBe('saving');
    releaseLatest();
    await Promise.all([first, latest]);
    expect(controller.persistenceStatus).toBe('saved');
    expect(repository.projects[0]?.name).toBe('Latest');
  });

  it('invalidates a newer queued source save when an older save preserves a conflict', async () => {
    const repository = new MemoryProjectRepository();
    const remote = new WorkspaceController(repository, {
      clock: () => 10,
      createId: () => 'shared',
    });
    const local = new WorkspaceController(repository, {
      clock: () => 11,
      createId: () => 'conflict-copy',
      debounceMilliseconds: 60_000,
    });
    await remote.load();
    await local.load();
    remote.updateActive('Remote winner', DEFAULT_DESIGN);
    await remote.flush();

    let releaseStaleSave!: () => void;
    let reportStaleSaveStarted!: () => void;
    const staleSaveStarted = new Promise<void>((resolve) => { reportStaleSaveStarted = resolve; });
    repository.beforeSave = (project) => project.name === 'Local first'
      ? new Promise<void>((resolve) => {
          releaseStaleSave = resolve;
          reportStaleSaveStarted();
        })
      : Promise.resolve();

    local.updateActive('Local first', DEFAULT_DESIGN);
    const first = local.flush();
    await staleSaveStarted;
    local.updateActive('Local latest', DEFAULT_DESIGN);
    const latest = local.flush();
    releaseStaleSave();
    await Promise.all([first, latest]);

    expect(local.persistenceStatus).toBe('conflict');
    expect(repository.projects.find(({ id }) => id === 'shared')).toMatchObject({
      name: 'Remote winner',
      revision: 2,
    });
    expect(repository.projects.find(({ id }) => id === 'conflict-copy')).toMatchObject({
      name: 'Local latest (conflict copy)',
      conflict: { sourceProjectId: 'shared' },
    });
    expect(repository.writes).not.toContain('save:shared:Local latest');
    remote.dispose();
    local.dispose();
  });

  it('rejects stale template intent when its leading save adopts a conflict workspace', async () => {
    const repository = new MemoryProjectRepository();
    const remote = new WorkspaceController(repository, {
      clock: () => 10,
      createId: () => 'shared',
    });
    const localIds = ['conflict-copy', 'must-not-be-created'];
    const local = new WorkspaceController(repository, {
      clock: () => 11,
      createId: () => localIds.shift()!,
      debounceMilliseconds: 60_000,
    });
    await remote.load();
    await local.load();
    remote.updateActive('Remote winner', DEFAULT_DESIGN);
    await remote.flush();
    local.updateActive('Local pending', DEFAULT_DESIGN);

    await expect(local.useAsTemplate('shared')).rejects.toThrow(
      'workspace changed before the command could be applied',
    );
    expect(local.persistenceStatus).toBe('conflict');
    expect(repository.projects.map(({ id }) => id).sort()).toEqual(['conflict-copy', 'shared']);
    expect(repository.projects.find(({ id }) => id === 'shared')?.name).toBe('Remote winner');
    expect(repository.projects.find(({ id }) => id === 'conflict-copy')?.name)
      .toBe('Local pending (conflict copy)');
    remote.dispose();
    local.dispose();
  });

  it('retains a failed non-conflict save for an explicit retry', async () => {
    const repository = new MemoryProjectRepository();
    const controller = new WorkspaceController(repository, {
      clock: () => 10,
      createId: () => 'one',
      debounceMilliseconds: 60_000,
    });
    await controller.load();
    repository.beforeSave = async (project) => {
      if (project.name === 'Retry me') throw new Error('storage unavailable');
    };

    controller.updateActive('Retry me', DEFAULT_DESIGN);
    await expect(controller.flush()).rejects.toThrow('storage unavailable');
    expect(controller.persistenceStatus).toBe('error');
    expect(repository.projects[0]?.name).toBe('Untitled design');

    repository.beforeSave = null;
    await controller.flush();
    expect(controller.persistenceStatus).toBe('saved');
    expect(repository.projects[0]?.name).toBe('Retry me');
  });

  it('does not resurrect a failed older save over a newer queued edit', async () => {
    const repository = new MemoryProjectRepository();
    const controller = new WorkspaceController(repository, {
      clock: () => 10,
      createId: () => 'one',
      debounceMilliseconds: 60_000,
    });
    await controller.load();
    let rejectFirst!: (cause: Error) => void;
    let reportFirstStarted!: () => void;
    const firstStarted = new Promise<void>((resolve) => { reportFirstStarted = resolve; });
    repository.beforeSave = (project) => project.name === 'First'
      ? new Promise<void>((_resolve, reject) => {
          rejectFirst = reject;
          reportFirstStarted();
        })
      : Promise.resolve();

    controller.updateActive('First', DEFAULT_DESIGN);
    const first = controller.flush();
    const firstFailure = expect(first).rejects.toThrow('storage unavailable');
    await firstStarted;
    controller.updateActive('Latest', DEFAULT_DESIGN);
    const latest = controller.flush();
    rejectFirst(new Error('storage unavailable'));

    await firstFailure;
    await latest;
    await controller.flush();
    expect(repository.projects[0]?.name).toBe('Latest');
    expect(repository.writes.filter((write) => write.startsWith('save:one:'))).toEqual([
      'save:one:Untitled design',
      'save:one:Latest',
    ]);
  });

  it('does not let an in-flight remote refresh replace a newly accepted edit', async () => {
    const repository = new MemoryProjectRepository();
    const sync = new ManualWorkspaceSync();
    const controller = new WorkspaceController(repository, {
      clock: () => 10,
      createId: () => 'one',
      debounceMilliseconds: 60_000,
      sync,
    });
    await controller.load();

    let reportLoadStarted!: () => void;
    let releaseLoad!: () => void;
    const loadStarted = new Promise<void>((resolve) => { reportLoadStarted = resolve; });
    const loadGate = new Promise<void>((resolve) => { releaseLoad = resolve; });
    repository.beforeLoad = async () => {
      reportLoadStarted();
      await loadGate;
    };
    sync.emit({ projectIds: ['one'] });
    await loadStarted;

    controller.updateActive('Local during refresh', DEFAULT_DESIGN);
    repository.beforeLoad = null;
    releaseLoad();
    await Promise.resolve();
    await Promise.resolve();
    expect(controller.snapshot().activeProject.name).toBe('Local during refresh');

    await controller.flush();
    expect(controller.snapshot().activeProject.name).toBe('Local during refresh');
    expect(repository.projects[0]?.name).toBe('Local during refresh');
    controller.dispose();
  });

  it('reconciles an invalidation received while the initial workspace load is in flight', async () => {
    const repository = new MemoryProjectRepository();
    const original = createProject({
      id: 'one',
      revision: 1,
      name: 'Initial',
      design: DEFAULT_DESIGN,
      createdAt: 1,
    });
    repository.projects = [original];
    repository.activeProjectId = original.id;
    const originalLoad = repository.load.bind(repository);
    let reportInitialRead!: () => void;
    let releaseInitialRead!: () => void;
    const initialRead = new Promise<void>((resolve) => { reportInitialRead = resolve; });
    const initialGate = new Promise<void>((resolve) => { releaseInitialRead = resolve; });
    let firstLoad = true;
    repository.load = async () => {
      if (!firstLoad) return originalLoad();
      firstLoad = false;
      const captured = await originalLoad();
      reportInitialRead();
      await initialGate;
      return captured;
    };
    const sync = new ManualWorkspaceSync();
    const controller = new WorkspaceController(repository, { sync });

    const loading = controller.load();
    await initialRead;
    repository.projects = [{ ...original, revision: 2, name: 'Remote during load' }];
    sync.emit({ projectIds: ['one'] });
    releaseInitialRead();

    await expect(loading).resolves.toMatchObject({
      activeProject: { id: 'one', revision: 2, name: 'Remote during load' },
    });
    expect(controller.snapshot().activeProject.name).toBe('Remote during load');
    controller.dispose();
  });

  it('treats invalidation transport failure as advisory after a durable commit', async () => {
    const repository = new MemoryProjectRepository();
    const sync: WorkspaceSync = {
      subscribe: () => () => undefined,
      publish: () => { throw new Error('closed channel'); },
      close: () => undefined,
    };
    const controller = new WorkspaceController(repository, {
      clock: () => 10,
      createId: () => 'one',
      sync,
    });

    await expect(controller.load()).resolves.toMatchObject({ activeProject: { id: 'one' } });
    controller.updateActive('Committed despite invalidation failure', DEFAULT_DESIGN);
    await expect(controller.flush()).resolves.toBeUndefined();
    expect(repository.projects[0]?.name).toBe('Committed despite invalidation failure');
    controller.dispose();
  });

  it('blocks edits while a conflicting revision is being preserved', async () => {
    const repository = new MemoryProjectRepository();
    const first = new WorkspaceController(repository, {
      clock: () => 10,
      createId: () => 'shared',
    });
    const second = new WorkspaceController(repository, {
      clock: () => 11,
      createId: () => 'conflict-copy',
    });
    await first.load();
    await second.load();
    first.updateActive('Remote winner', DEFAULT_DESIGN);
    await first.flush();

    let reportPreserveStarted!: () => void;
    let releasePreserve!: () => void;
    const preserveStarted = new Promise<void>((resolve) => { reportPreserveStarted = resolve; });
    const preserveGate = new Promise<void>((resolve) => { releasePreserve = resolve; });
    repository.beforePreserve = async () => {
      reportPreserveStarted();
      await preserveGate;
    };
    second.updateActive('Local conflict', DEFAULT_DESIGN);
    const saving = second.flush();
    await preserveStarted;

    expect(second.persistenceStatus).toBe('reconciling');
    expect(() => second.updateActive('Must be rejected', DEFAULT_DESIGN))
      .toThrow('Conflict recovery is still in progress');
    repository.beforePreserve = null;
    releasePreserve();
    await saving;

    expect(second.persistenceStatus).toBe('conflict');
    expect(second.snapshot().activeProject).toMatchObject({
      id: 'conflict-copy',
      name: 'Local conflict (conflict copy)',
    });
    first.dispose();
    second.dispose();
  });

  it('retains a retryable journal when conflict-copy persistence fails', async () => {
    const repository = new MemoryProjectRepository();
    const first = new WorkspaceController(repository, {
      clock: () => 10,
      createId: () => 'shared',
    });
    const second = new WorkspaceController(repository, {
      clock: () => 11,
      createId: () => 'conflict-copy',
      debounceMilliseconds: 60_000,
    });
    await first.load();
    await second.load();
    first.updateActive('Remote winner', DEFAULT_DESIGN);
    await first.flush();
    repository.beforePreserve = async () => { throw new Error('storage unavailable'); };

    second.updateActive('Retry this conflict', DEFAULT_DESIGN);
    await expect(second.flush()).rejects.toThrow('storage unavailable');
    expect(second.persistenceStatus).toBe('error');

    repository.beforePreserve = null;
    await second.flush();
    expect(second.persistenceStatus).toBe('conflict');
    expect(second.snapshot().activeProject).toMatchObject({
      id: 'conflict-copy',
      name: 'Retry this conflict (conflict copy)',
    });
    expect(repository.projects.some((project) =>
      project.id === 'conflict-copy' && project.name === 'Retry this conflict (conflict copy)'))
      .toBe(true);
    first.dispose();
    second.dispose();
  });

  it('retries adoption after a durable conflict copy is preserved but reload fails', async () => {
    const repository = new MemoryProjectRepository();
    const remote = new WorkspaceController(repository, {
      clock: () => 10,
      createId: () => 'shared',
    });
    const local = new WorkspaceController(repository, {
      clock: () => 11,
      createId: () => 'conflict-copy',
      debounceMilliseconds: 60_000,
    });
    await remote.load();
    await local.load();
    remote.updateActive('Remote winner', DEFAULT_DESIGN);
    await remote.flush();
    let reloadFailures = 1;
    repository.beforeLoad = async () => {
      if (reloadFailures > 0) {
        reloadFailures -= 1;
        throw new Error('reload unavailable');
      }
    };

    local.updateActive('Durable local edit', DEFAULT_DESIGN);
    await expect(local.flush()).rejects.toThrow('reload unavailable');
    expect(local.persistenceStatus).toBe('error');
    expect(repository.projects.find(({ id }) => id === 'conflict-copy')).toMatchObject({
      name: 'Durable local edit (conflict copy)',
    });
    expect(repository.writes.filter((write) => write.startsWith('preserve:'))).toHaveLength(1);

    await local.flush();
    expect(local.persistenceStatus).toBe('conflict');
    expect(local.snapshot().activeProject).toMatchObject({
      id: 'conflict-copy',
      name: 'Durable local edit (conflict copy)',
    });
    expect(repository.writes.filter((write) => write.startsWith('preserve:'))).toHaveLength(1);
    remote.dispose();
    local.dispose();
  });

  it('preserves concurrent stale edits as a separately identified conflict copy', async () => {
    const repository = new MemoryProjectRepository();
    const first = new WorkspaceController(repository, {
      clock: () => 10,
      createId: () => 'shared',
    });
    const second = new WorkspaceController(repository, {
      clock: () => 11,
      createId: () => 'conflict',
    });
    await first.load();
    await second.load();

    first.updateActive('Alpha', DEFAULT_DESIGN);
    await first.flush();
    second.updateActive('Beta', DEFAULT_DESIGN);
    await second.flush();

    expect(second.persistenceStatus).toBe('conflict');
    expect(second.snapshot().activeProject).toMatchObject({
      id: 'conflict',
      name: 'Beta (conflict copy)',
      revision: 1,
      conflict: { sourceProjectId: 'shared', sourceRevision: 1, createdAt: 11 },
    });
    expect(repository.projects.map(({ name }) => name).sort()).toEqual([
      'Alpha',
      'Beta (conflict copy)',
    ]);
  });

  it('reloads durable conflict lineage and resolves both projects as independent', async () => {
    const repository = new MemoryProjectRepository();
    const first = new WorkspaceController(repository, {
      clock: () => 10,
      createId: () => 'shared',
    });
    const second = new WorkspaceController(repository, {
      clock: () => 11,
      createId: () => 'conflict',
    });
    await first.load();
    await second.load();
    first.updateActive('Alpha', DEFAULT_DESIGN);
    await first.flush();
    second.updateActive('Beta', DEFAULT_DESIGN);
    await second.flush();

    const reloaded = new WorkspaceController(repository, { clock: () => 20 });
    expect((await reloaded.load()).activeProject.conflict).toEqual({
      sourceProjectId: 'shared',
      sourceRevision: 1,
      createdAt: 11,
    });
    const resolved = await reloaded.resolveConflict('conflict', 'keep-both');
    expect(resolved.projects.map(({ name }) => name).sort()).toEqual(['Alpha', 'Beta']);
    expect(resolved.projects.every(({ conflict }) => conflict === null)).toBe(true);
    expect(repository.writes.at(-1)).toBe('resolve:conflict:keep-both');
  });

  it('binds a star command to the project revision visible when intent is accepted', async () => {
    const repository = new MemoryProjectRepository();
    const sync = new ManualWorkspaceSync();
    const controller = new WorkspaceController(repository, {
      clock: () => 10,
      createId: () => 'one',
      sync,
    });
    await controller.load();
    const toggling = controller.toggleStar('one');
    const persisted = repository.projects[0]!;
    repository.projects = [{ ...persisted, revision: persisted.revision + 1, name: 'Remote winner' }];
    sync.emit({ projectIds: ['one'] });

    await expect(toggling).rejects.toBeInstanceOf(ProjectConflictError);
    expect(repository.projects).toEqual([
      expect.objectContaining({ id: 'one', revision: 2, name: 'Remote winner', starredAt: null }),
    ]);
    controller.dispose();
  });

  it('binds delete approval to the active project revision visible to the user', async () => {
    const repository = new MemoryProjectRepository();
    const sync = new ManualWorkspaceSync();
    const ids = ['one', 'two'];
    const controller = new WorkspaceController(repository, {
      clock: () => 10,
      createId: () => ids.shift()!,
      sync,
    });
    await controller.load();
    const created = await controller.create(DEFAULT_DESIGN, 'Delete candidate');
    const deleting = controller.deleteActive();
    const persisted = repository.projects.find(({ id }) => id === created.activeProject.id)!;
    repository.projects = repository.projects.map((project) => project.id === persisted.id
      ? { ...project, revision: project.revision + 1, name: 'Changed remotely' }
      : project);
    sync.emit({ projectIds: [persisted.id] });

    await expect(deleting).rejects.toBeInstanceOf(ProjectConflictError);
    expect(repository.projects.find(({ id }) => id === persisted.id)).toMatchObject({
      revision: 2,
      name: 'Changed remotely',
    });
    controller.dispose();
  });

  it('binds conflict resolution to both revisions visible when intent is accepted', async () => {
    const repository = new MemoryProjectRepository();
    const source = createProject({
      id: 'source',
      revision: 1,
      name: 'Source',
      design: DEFAULT_DESIGN,
      createdAt: 1,
    });
    const conflict = createProject({
      id: 'conflict',
      revision: 1,
      name: 'Conflict (conflict copy)',
      design: DEFAULT_DESIGN,
      createdAt: 2,
      conflict: { sourceProjectId: source.id, sourceRevision: 1, createdAt: 2 },
    });
    repository.projects = [source, conflict];
    repository.activeProjectId = conflict.id;
    const sync = new ManualWorkspaceSync();
    const controller = new WorkspaceController(repository, { clock: () => 10, sync });
    await controller.load();
    const resolving = controller.resolveConflict(conflict.id, 'keep-conflict');
    repository.projects = repository.projects.map((project) => project.id === source.id
      ? { ...project, revision: 2, name: 'Remote source' }
      : project);
    sync.emit({ projectIds: [source.id] });

    await expect(resolving).rejects.toBeInstanceOf(ProjectConflictError);
    expect(repository.projects).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: source.id, revision: 2, name: 'Remote source' }),
      expect.objectContaining({ id: conflict.id, conflict: expect.objectContaining({
        sourceProjectId: source.id,
      }) }),
    ]));
    controller.dispose();
  });

  it('stars without duplicating and creates an explicit template copy', async () => {
    const repository = new MemoryProjectRepository();
    const ids = ['source', 'copy'];
    const controller = new WorkspaceController(repository, {
      clock: () => 10,
      createId: () => ids.shift()!,
    });
    await controller.load();
    const starred = await controller.toggleStar('source');
    expect(starred.projects).toHaveLength(1);
    expect(starred.activeProject.starredAt).toBe(10);

    const copied = await controller.useAsTemplate('source');
    expect(copied.projects).toHaveLength(2);
    expect(copied.activeProject).toMatchObject({ id: 'copy', name: 'Untitled design copy' });
    expect(copied.activeProject.design).toEqual(starred.activeProject.design);
  });

  it('exports the complete workspace with structured recovery omissions', async () => {
    const repository = new MemoryProjectRepository();
    repository.issues = [createProjectQuarantineRecord(
      { id: 'broken', schemaVersion: 2 },
      'Broken record was isolated',
    )];
    const issue = repository.issues[0]!;
    const controller = new WorkspaceController(repository, {
      clock: () => 10,
      createId: () => 'one',
    });
    await controller.load();
    expect(await controller.exportArchive()).toMatchObject({
      format: 'seemoji-workspace',
      schemaVersion: 1,
      exportedAt: 10,
      activeProjectId: 'one',
      projects: [{ id: 'one', revision: 1 }],
      omissions: [{
        recordId: 'broken',
        error: 'Broken record was isolated',
        contentHash: issue.contentHash,
        byteSize: issue.byteSize,
      }],
    });
  });

  it('exports a fresh raw quarantine envelope and purges only the matching snapshot', async () => {
    const repository = new MemoryProjectRepository();
    const issue = createProjectQuarantineRecord(
      { schemaVersion: 2, id: 'broken' },
      'Broken record was isolated',
    );
    repository.issues = [issue];
    const controller = new WorkspaceController(repository, {
      clock: () => 10,
      createId: () => 'one',
    });
    await controller.load();

    await expect(controller.exportQuarantinedRecord(issue)).resolves.toMatchObject({
      format: 'seemoji-quarantined-project',
      schemaVersion: 1,
      exportedAt: 10,
      encoding: 'seemoji-structured-json-v1',
      recordId: 'broken',
      contentHash: issue.contentHash,
      encodedRecord: { id: 'broken', schemaVersion: 2 },
    });
    const workspace = await controller.purgeQuarantinedRecord(issue);
    expect(workspace.issues).toEqual([]);
    expect(repository.writes.at(-1)).toBe(`purge:${issue.contentHash}`);
  });

  it('imports an archive additively with new identities and remapped conflict lineage', async () => {
    const repository = new MemoryProjectRepository();
    repository.projects = [createProject({
      id: 'existing', revision: 1, name: 'Existing', design: DEFAULT_DESIGN, createdAt: 1,
    })];
    repository.activeProjectId = 'existing';
    const source = createProject({
      id: 'archived-source', revision: 4, name: 'Source', design: DEFAULT_DESIGN, createdAt: 2,
    });
    const conflict = createProject({
      id: 'archived-conflict',
      revision: 2,
      name: 'Conflict',
      design: DEFAULT_DESIGN,
      createdAt: 3,
      conflict: { sourceProjectId: source.id, sourceRevision: 3, createdAt: 3 },
    });
    const archive = createWorkspaceArchive({
      exportedAt: 4,
      activeProjectId: conflict.id,
      projects: [source, conflict],
      omissions: [{
        recordId: 'old-broken',
        error: 'Old record was omitted',
        contentHash: 'fnv1a32:01234567',
        byteSize: 42,
      }],
    });
    const ids = ['restored-source', 'restored-conflict'];
    const controller = new WorkspaceController(repository, { createId: () => ids.shift()! });
    await controller.load();
    const result = await controller.importArchive(archive);
    expect(result.importedProjectCount).toBe(2);
    expect(result.archivedOmissions).toEqual(archive.omissions);
    expect(result.workspace.projects).toHaveLength(3);
    expect(result.workspace.activeProject.id).toBe('restored-conflict');
    expect(result.workspace.activeProject.conflict).toEqual({
      sourceProjectId: 'restored-source',
      sourceRevision: 1,
      createdAt: 3,
    });
    expect(repository.writes.at(-1)).toBe('import:restored-source,restored-conflict');
  });

  it('rejects invalid archives and generated identity collisions without partial import', async () => {
    const repository = new MemoryProjectRepository();
    const controller = new WorkspaceController(repository, {
      clock: () => 1,
      createId: () => 'existing',
    });
    await controller.load();
    const before = [...repository.projects];
    await expect(controller.importArchive({})).rejects.toThrow('workspace archive');
    const archive = createWorkspaceArchive({
      exportedAt: 2,
      activeProjectId: 'archived',
      projects: [createProject({
        id: 'archived', revision: 1, name: 'Archived', design: DEFAULT_DESIGN, createdAt: 1,
      })],
    });
    await expect(controller.importArchive(archive)).rejects.toThrow('collided');
    expect(repository.projects).toEqual(before);
    expect(repository.writes.filter((write) => write.startsWith('import:'))).toEqual([]);
  });
});
