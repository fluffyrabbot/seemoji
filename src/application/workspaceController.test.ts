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
import { WorkspaceController } from './workspaceController';

class MemoryProjectRepository implements ProjectRepository {
  projects: Project[] = [];
  activeProjectId: string | null = null;
  issues: ProjectWorkspace['issues'] = [];
  writes: string[] = [];
  beforeSave: ((project: Project) => Promise<void>) | null = null;

  async load(): Promise<ProjectWorkspace> {
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

  async setActive(id: string): Promise<void> {
    this.activeProjectId = id;
    this.writes.push(`active:${id}`);
  }

  async deleteAndActivate(
    id: string,
    expectedRevision: number,
    activeProjectId: string,
    replacement: Project | null,
  ): Promise<Project | null> {
    const existing = this.projects.find((project) => project.id === id) ?? null;
    if (existing?.revision !== expectedRevision) {
      throw new ProjectConflictError('stale project', existing);
    }
    if (this.projects.some((project) => project.conflict?.sourceProjectId === id)) {
      throw new ProjectConflictError('project has unresolved conflicts', existing);
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
