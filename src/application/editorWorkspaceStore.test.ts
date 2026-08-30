import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { IndexedDbProjectRepository } from '../adapters/browser/indexedDbProjectRepository';
import { DEFAULT_TRANSFORM } from '../domain/design';
import type { Project } from '../domain/project';
import type { ProjectQuarantineRecord } from '../domain/projectQuarantine';
import type {
  ProjectRepository,
  ProjectSaveOptions,
  ProjectWorkspace,
  ResolveProjectConflictInput,
} from '../ports/projectRepository';
import type { WorkspaceChange, WorkspaceSync } from '../ports/workspaceSync';
import { EditorWorkspaceStore } from './editorWorkspaceStore';
import { WorkspaceController } from './workspaceController';

class SyncBus {
  readonly endpoints = new Set<SyncEndpoint>();

  endpoint(): SyncEndpoint {
    const endpoint = new SyncEndpoint(this);
    this.endpoints.add(endpoint);
    return endpoint;
  }

  publish(source: SyncEndpoint, change: WorkspaceChange): void {
    for (const endpoint of this.endpoints) {
      if (endpoint !== source) endpoint.deliver(change);
    }
  }
}

class SyncEndpoint implements WorkspaceSync {
  readonly #bus: SyncBus;
  #listener: ((change: WorkspaceChange) => void) | null = null;

  constructor(bus: SyncBus) {
    this.#bus = bus;
  }

  subscribe(listener: (change: WorkspaceChange) => void): () => void {
    this.#listener = listener;
    return () => { if (this.#listener === listener) this.#listener = null; };
  }

  publish(change: WorkspaceChange): void {
    this.#bus.publish(this, change);
  }

  deliver(change: WorkspaceChange): void {
    this.#listener?.(change);
  }

  close(): void {
    this.#listener = null;
    this.#bus.endpoints.delete(this);
  }
}

interface DeferredGate {
  readonly started: Promise<void>;
  readonly wait: Promise<void>;
  start(): void;
  release(): void;
}

const deferredGate = (): DeferredGate => {
  let start!: () => void;
  let release!: () => void;
  return {
    started: new Promise<void>((resolve) => { start = resolve; }),
    wait: new Promise<void>((resolve) => { release = resolve; }),
    start: () => start(),
    release: () => release(),
  };
};

class GatedProjectRepository implements ProjectRepository {
  readonly #delegate: ProjectRepository;
  #setActiveGate: DeferredGate | null = null;
  #starSaveGate: DeferredGate | null = null;

  constructor(delegate: ProjectRepository) {
    this.#delegate = delegate;
  }

  gateNextSetActive(): DeferredGate {
    return this.#setActiveGate = deferredGate();
  }

  gateNextStarSave(): DeferredGate {
    return this.#starSaveGate = deferredGate();
  }

  load(): Promise<ProjectWorkspace> {
    return this.#delegate.load();
  }

  async save(project: Project, options: ProjectSaveOptions): Promise<Project> {
    if (project.starredAt !== null && this.#starSaveGate) {
      const gate = this.#starSaveGate;
      this.#starSaveGate = null;
      gate.start();
      await gate.wait;
    }
    return this.#delegate.save(project, options);
  }

  importProjects(projects: readonly Project[], activeProjectId: string): Promise<void> {
    return this.#delegate.importProjects(projects, activeProjectId);
  }

  readQuarantinedRecord(expected: ProjectQuarantineRecord): Promise<ProjectQuarantineRecord> {
    return this.#delegate.readQuarantinedRecord(expected);
  }

  purgeQuarantinedRecord(expected: ProjectQuarantineRecord): Promise<void> {
    return this.#delegate.purgeQuarantinedRecord(expected);
  }

  preserveConflict(project: Project, expectedSourceRevision: number): Promise<Project> {
    return this.#delegate.preserveConflict(project, expectedSourceRevision);
  }

  async setActive(id: string, expectedRevision: number): Promise<void> {
    if (this.#setActiveGate) {
      const gate = this.#setActiveGate;
      this.#setActiveGate = null;
      gate.start();
      await gate.wait;
    }
    return this.#delegate.setActive(id, expectedRevision);
  }

  deleteAndActivate(
    id: string,
    expectedRevision: number,
    activeProjectId: string,
    replacement: Project | null,
  ): Promise<Project | null> {
    return this.#delegate.deleteAndActivate(
      id,
      expectedRevision,
      activeProjectId,
      replacement,
    );
  }

  resolveConflict(input: ResolveProjectConflictInput): Promise<void> {
    return this.#delegate.resolveConflict(input);
  }
}

describe('EditorWorkspaceStore', () => {
  it('journals accepted name and design edits synchronously before an immediate flush', async () => {
    const factory = new IDBFactory();
    const databaseName = 'editor-workspace-synchronous-journal';
    const repository = new IndexedDbProjectRepository(factory, databaseName);
    const store = new EditorWorkspaceStore(new WorkspaceController(repository, {
      createId: () => 'project-1',
      debounceMilliseconds: 60_000,
    }));
    await store.load();

    let notifications = 0;
    const unsubscribe = store.subscribe(() => { notifications += 1; });
    store.renameActive('Accepted immediately');
    store.dispatch({
      type: 'update-transform',
      transform: { ...DEFAULT_TRANSFORM, x: 0.25, rotate: 30 },
    });

    expect(store.getSnapshot()).toMatchObject({
      projectName: 'Accepted immediately',
      workspace: { activeProject: { name: 'Accepted immediately' } },
      editor: { design: { layers: [{ transform: { x: 0.25, rotate: 30 } }] } },
    });
    expect(notifications).toBe(2);
    await store.flush();
    unsubscribe();
    store.dispose();

    const reopenedRepository = new IndexedDbProjectRepository(factory, databaseName);
    const reopened = new EditorWorkspaceStore(new WorkspaceController(reopenedRepository));
    const loaded = await reopened.load();
    expect(loaded.activeProject.name).toBe('Accepted immediately');
    expect(loaded.activeProject.design.layers[0]?.transform).toMatchObject({
      x: 0.25,
      rotate: 30,
    });
    reopened.dispose();
  });

  it('preserves session history and name drafts across metadata-only cross-tab refreshes', async () => {
    const factory = new IDBFactory();
    const databaseName = 'editor-workspace-metadata-refresh';
    const sync = new SyncBus();
    const first = new EditorWorkspaceStore(new WorkspaceController(
      new IndexedDbProjectRepository(factory, databaseName),
      { createId: () => 'project-1', debounceMilliseconds: 60_000, sync: sync.endpoint() },
    ));
    const second = new EditorWorkspaceStore(new WorkspaceController(
      new IndexedDbProjectRepository(factory, databaseName),
      { createId: () => 'project-2', debounceMilliseconds: 60_000, sync: sync.endpoint() },
    ));
    await first.load();
    await second.load();

    first.renameActive('');
    first.dispatch({
      type: 'update-transform',
      transform: { ...DEFAULT_TRANSFORM, rotate: 20 },
    });
    await first.flush();
    await second.flush();
    const before = first.getSnapshot();
    expect(before.editor.past).toHaveLength(1);
    expect(before.projectName).toBe('');

    await second.toggleStar(second.snapshot().activeProject.id);
    await first.flush();
    const after = first.getSnapshot();
    expect(after.editor).toBe(before.editor);
    expect(after.editor.past).toHaveLength(1);
    expect(after.projectName).toBe('');
    expect(after.editorSessionEpoch).toBe(before.editorSessionEpoch);

    let notifications = 0;
    const unsubscribe = first.subscribe(() => { notifications += 1; });
    await first.activate(first.snapshot().activeProject.id);
    expect(notifications).toBe(0);
    unsubscribe();
    first.dispose();
    second.dispose();
  });

  it('adopts a remote name without discarding unchanged design history', async () => {
    const factory = new IDBFactory();
    const databaseName = 'editor-workspace-name-refresh';
    const sync = new SyncBus();
    const first = new EditorWorkspaceStore(new WorkspaceController(
      new IndexedDbProjectRepository(factory, databaseName),
      { createId: () => 'project-1', debounceMilliseconds: 60_000, sync: sync.endpoint() },
    ));
    const second = new EditorWorkspaceStore(new WorkspaceController(
      new IndexedDbProjectRepository(factory, databaseName),
      { createId: () => 'project-2', debounceMilliseconds: 60_000, sync: sync.endpoint() },
    ));
    await first.load();
    await second.load();

    first.dispatch({
      type: 'update-transform',
      transform: { ...DEFAULT_TRANSFORM, rotate: 20 },
    });
    await first.flush();
    await second.flush();
    const editorBeforeRename = first.getSnapshot().editor;
    expect(editorBeforeRename.past).toHaveLength(1);

    second.renameActive('Renamed elsewhere');
    await second.flush();
    await first.flush();

    expect(first.getSnapshot().projectName).toBe('Renamed elsewhere');
    expect(first.getSnapshot().editor).toBe(editorBeforeRename);
    expect(first.getSnapshot().editor.past).toHaveLength(1);
    first.dispose();
    second.dispose();
  });

  it('adopts remote active content and rejects mutations after disposal', async () => {
    const factory = new IDBFactory();
    const databaseName = 'editor-workspace-content-refresh';
    const sync = new SyncBus();
    const first = new EditorWorkspaceStore(new WorkspaceController(
      new IndexedDbProjectRepository(factory, databaseName),
      { createId: () => 'project-1', debounceMilliseconds: 60_000, sync: sync.endpoint() },
    ));
    const second = new EditorWorkspaceStore(new WorkspaceController(
      new IndexedDbProjectRepository(factory, databaseName),
      { createId: () => 'project-2', debounceMilliseconds: 60_000, sync: sync.endpoint() },
    ));
    await first.load();
    await second.load();
    const sessionEpochBeforeRemoteEdit = first.getSnapshot().editorSessionEpoch;

    second.renameActive('Remote edit');
    second.dispatch({
      type: 'update-transform',
      transform: { ...DEFAULT_TRANSFORM, x: 0.2, rotate: -35 },
    });
    await second.flush();
    await first.flush();

    expect(first.getSnapshot()).toMatchObject({
      projectName: 'Remote edit',
      editor: {
        past: [],
        design: { layers: [{ transform: { x: 0.2, rotate: -35 } }] },
      },
    });
    expect(first.getSnapshot().editorSessionEpoch).toBe(sessionEpochBeforeRemoteEdit + 1);
    first.dispose();
    expect(() => first.dispatch({ type: 'undo' })).toThrow('disposed');
    second.dispose();
  });

  it('rejects editor mutations while project activation crosses the repository boundary', async () => {
    const factory = new IDBFactory();
    const repository = new GatedProjectRepository(
      new IndexedDbProjectRepository(factory, 'editor-workspace-activation-race'),
    );
    const ids = ['project-1', 'project-2'];
    const store = new EditorWorkspaceStore(new WorkspaceController(repository, {
      createId: () => ids.shift()!,
      debounceMilliseconds: 60_000,
    }));
    const first = await store.load();
    const second = await store.create(undefined, 'Second');
    await store.activate(first.activeProject.id);

    const gate = repository.gateNextSetActive();
    const activation = store.activate(second.activeProject.id);
    await gate.started;
    const before = store.getSnapshot();
    expect(before.workspaceMutationInProgress).toBe(true);
    expect(store.dispatch({
      type: 'update-transform',
      transform: { ...DEFAULT_TRANSFORM, rotate: 73 },
    })).toBe(before.editor);
    expect(store.renameActive('Must not leak')).toBe(before.workspace);
    expect(store.getSnapshot()).toBe(before);

    gate.release();
    await activation;
    expect(store.getSnapshot()).toMatchObject({
      workspaceMutationInProgress: false,
      projectName: 'Second',
      workspace: { activeProject: { id: 'project-2', name: 'Second' } },
      editor: { design: { layers: [{ transform: { rotate: 0 } }] } },
    });
    store.dispose();
  });

  it('keeps star metadata and the editor coherent across a delayed star write', async () => {
    const factory = new IDBFactory();
    const repository = new GatedProjectRepository(
      new IndexedDbProjectRepository(factory, 'editor-workspace-star-race'),
    );
    const store = new EditorWorkspaceStore(new WorkspaceController(repository, {
      createId: () => 'project-1',
      debounceMilliseconds: 60_000,
    }));
    const loaded = await store.load();

    const gate = repository.gateNextStarSave();
    const toggle = store.toggleStar(loaded.activeProject.id);
    await gate.started;
    const before = store.getSnapshot();
    expect(before.workspaceMutationInProgress).toBe(true);
    expect(store.dispatch({
      type: 'update-transform',
      transform: { ...DEFAULT_TRANSFORM, x: 0.33 },
    })).toBe(before.editor);
    gate.release();
    await toggle;

    expect(store.getSnapshot()).toMatchObject({
      workspaceMutationInProgress: false,
      workspace: { activeProject: { starredAt: expect.any(Number) } },
      editor: { design: { layers: [{ transform: { x: 0 } }] } },
    });
    store.dispose();
  });
});
