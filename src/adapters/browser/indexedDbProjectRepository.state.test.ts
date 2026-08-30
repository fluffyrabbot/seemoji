import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { DEFAULT_DESIGN } from '../../domain/design';
import { createProject, type Project } from '../../domain/project';
import {
  createProjectQuarantineRecord,
  type ProjectQuarantineRecord,
} from '../../domain/projectQuarantine';
import {
  ProjectConflictError,
  ProjectQuarantineConflictError,
  type ProjectConflictResolution,
} from '../../ports/projectRepository';
import { IndexedDbProjectRepository } from './indexedDbProjectRepository';

const DEFAULT_STEPS = 48;
const REGRESSION_SEEDS = [0x5e30_0a11, 0x7f4a_7c15, 0xc0de_2026, 0xdead_beef];
const environment = (globalThis as typeof globalThis & {
  readonly process?: { readonly env?: Readonly<Record<string, string | undefined>> };
}).process?.env ?? {};
const configuredSeed = environment.SEEMOJI_STATE_SEED;
const seedCount = Number(environment.SEEMOJI_STATE_SEEDS ?? 6);
const steps = Number(environment.SEEMOJI_STATE_STEPS ?? DEFAULT_STEPS);
const seeds = configuredSeed === undefined
  ? Array.from({ length: seedCount }, (_, index) =>
    REGRESSION_SEEDS[index] ?? (0x9e37_79b9 * (index + 1)) >>> 0)
  : [Number(configuredSeed) >>> 0];

const requestResult = <T>(request: IDBRequest<T>): Promise<T> => new Promise((resolve, reject) => {
  request.addEventListener('success', () => resolve(request.result), { once: true });
  request.addEventListener('error', () => reject(request.error), { once: true });
});

const transactionDone = (transaction: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    transaction.addEventListener('complete', () => resolve(), { once: true });
    transaction.addEventListener('abort', () => reject(transaction.error), { once: true });
    transaction.addEventListener('error', () => reject(transaction.error), { once: true });
  });

const openDatabase = (factory: IDBFactory, name: string, version?: number): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = version === undefined ? factory.open(name) : factory.open(name, version);
    request.addEventListener('success', () => resolve(request.result), { once: true });
    request.addEventListener('error', () => reject(request.error), { once: true });
  });

class Generator {
  #state: number;

  constructor(seed: number) {
    this.#state = seed || 1;
  }

  integer(limit: number): number {
    let value = this.#state;
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    this.#state = value >>> 0;
    return this.#state % limit;
  }

  pick<T>(values: readonly T[]): T {
    const value = values[this.integer(values.length)];
    if (value === undefined) throw new Error('Generated choice is empty');
    return value;
  }
}

interface QuarantineFixture {
  readonly raw: Record<string, unknown>;
  readonly issue: ProjectQuarantineRecord;
}

class WorkspaceModel {
  readonly projects = new Map<string, Project>();
  readonly quarantines = new Map<string, QuarantineFixture>();
  readonly highestRevisions = new Map<string, number>();
  activeProjectId: string | null = null;
}

type Operation = readonly [name: string, run: () => Promise<void>];

class PersistenceStateMachine {
  readonly #factory = new IDBFactory();
  readonly #databaseName: string;
  readonly #random: Generator;
  readonly #model = new WorkspaceModel();
  readonly #trace: string[] = [];
  readonly #first: IndexedDbProjectRepository;
  readonly #second: IndexedDbProjectRepository;
  #identity = 0;
  #time: number;

  private constructor(seed: number) {
    this.#databaseName = `project-state-${seed.toString(16)}`;
    this.#random = new Generator(seed);
    this.#time = 10_000 + seed;
    this.#first = new IndexedDbProjectRepository(this.#factory, this.#databaseName);
    this.#second = new IndexedDbProjectRepository(this.#factory, this.#databaseName);
  }

  static async create(seed: number): Promise<PersistenceStateMachine> {
    const machine = new PersistenceStateMachine(seed);
    const initial = machine.#newProject('Initial');
    if ((seed & 1) === 1) {
      const persisted = { ...initial, revision: 1 };
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = machine.#factory.open(machine.#databaseName, 1);
        request.addEventListener('upgradeneeded', () => {
          request.result.createObjectStore('projects', { keyPath: 'id' }).put(persisted);
          request.result.createObjectStore('workspace', { keyPath: 'key' }).put({
            key: 'activeProjectId',
            value: persisted.id,
          });
        }, { once: true });
        request.addEventListener('success', () => resolve(request.result), { once: true });
        request.addEventListener('error', () => reject(request.error), { once: true });
      });
      database.close();
      machine.#model.projects.set(persisted.id, persisted);
      machine.#model.activeProjectId = persisted.id;
      await machine.#first.load();
    } else {
      const persisted = { ...initial, revision: 1 };
      await machine.#first.save(initial, { activate: true, expectedRevision: null });
      machine.#model.projects.set(persisted.id, persisted);
      machine.#model.activeProjectId = persisted.id;
    }
    await machine.#second.load();
    await machine.#assertInvariants('bootstrap');
    return machine;
  }

  async run(sequenceLength: number): Promise<void> {
    const mandatory: readonly Operation[] = [
      ['create', () => this.#create()],
      ['edit', () => this.#edit()],
      ['stale-save-conflict', () => this.#createConflict()],
      ['resolve-race', () => this.#resolveConflict(true)],
      ['import', () => this.#importBatch()],
      ['import-abort', () => this.#abortImport()],
      ['activate', () => this.#activate()],
      ['stale-delete-abort', () => this.#abortDelete()],
      ['quarantine', () => this.#injectQuarantine()],
      ['tampered-purge-abort', () => this.#abortTamperedPurge()],
      ['purge-race', () => this.#racePurge()],
      ['quarantine', () => this.#injectQuarantine()],
      ['purge', () => this.#purge()],
      ['delete', () => this.#delete()],
    ];
    for (const operation of mandatory) await this.#step(operation);
    for (let index = 0; index < sequenceLength; index += 1) {
      await this.#step(this.#random.pick(this.#availableOperations()));
    }
  }

  close(): void {
    this.#first.close();
    this.#second.close();
  }

  trace(): string {
    return this.#trace.slice(-16).join(' -> ');
  }

  async #step([name, run]: Operation): Promise<void> {
    this.#trace.push(name);
    await run();
    await this.#assertInvariants(name);
  }

  #availableOperations(): readonly Operation[] {
    const operations: Operation[] = [
      ['edit', () => this.#edit()],
      ['stale-save-conflict', () => this.#createConflict()],
      ['activate', () => this.#activate()],
      ['stale-delete-abort', () => this.#abortDelete()],
      ['import-abort', () => this.#abortImport()],
      ['quarantine', () => this.#injectQuarantine()],
    ];
    if (this.#model.projects.size < 10) {
      operations.push(['create', () => this.#create()]);
      operations.push(['import', () => this.#importBatch()]);
    }
    if (this.#conflicts().length > 0) {
      operations.push(['resolve', () => this.#resolveConflict(false)]);
      operations.push(['resolve-race', () => this.#resolveConflict(true)]);
    }
    if (this.#deletableProjects().length > 0) operations.push(['delete', () => this.#delete()]);
    if (this.#model.quarantines.size > 0) {
      operations.push(['purge', () => this.#purge()]);
      operations.push(['purge-race', () => this.#racePurge()]);
      operations.push(['tampered-purge-abort', () => this.#abortTamperedPurge()]);
    }
    return operations;
  }

  async #create(): Promise<void> {
    const project = this.#newProject(`Created ${this.#identity}`);
    const repository = this.#random.pick([this.#first, this.#second]);
    await repository.save(project, { activate: true, expectedRevision: null });
    this.#model.projects.set(project.id, { ...project, revision: 1 });
    this.#model.activeProjectId = project.id;
  }

  async #edit(): Promise<void> {
    const current = this.#random.pick([...this.#model.projects.values()]);
    const edited: Project = {
      ...current,
      name: `Edited ${this.#identity++}`,
      updatedAt: this.#tick(),
    };
    const repository = this.#random.pick([this.#first, this.#second]);
    await repository.save(edited, { activate: false, expectedRevision: current.revision });
    this.#model.projects.set(current.id, { ...edited, revision: current.revision + 1 });
  }

  async #createConflict(): Promise<void> {
    const sources = [...this.#model.projects.values()].filter((project) => project.conflict === null);
    const source = this.#random.pick(sources);
    const winner: Project = {
      ...source,
      name: `Winner ${this.#identity++}`,
      updatedAt: this.#tick(),
    };
    const stale: Project = {
      ...source,
      name: `Stale ${this.#identity++}`,
      updatedAt: this.#tick(),
    };
    await this.#first.save(winner, { activate: false, expectedRevision: source.revision });
    const conflict = await this.#second.save(stale, {
      activate: false,
      expectedRevision: source.revision,
    }).catch((cause: unknown) => cause);
    expect(conflict).toBeInstanceOf(ProjectConflictError);
    const latest = { ...winner, revision: source.revision + 1 };
    const createdAt = this.#tick();
    const copy = createProject({
      id: this.#nextId('conflict'),
      name: `${stale.name} (conflict copy)`,
      design: stale.design,
      createdAt,
      conflict: {
        sourceProjectId: source.id,
        sourceRevision: latest.revision,
        createdAt,
      },
    });
    await this.#second.preserveConflict(copy, latest.revision);
    this.#model.projects.set(source.id, latest);
    this.#model.projects.set(copy.id, { ...copy, revision: 1 });
    this.#model.activeProjectId = copy.id;
  }

  async #activate(): Promise<void> {
    const project = this.#random.pick([...this.#model.projects.values()]);
    await this.#random.pick([this.#first, this.#second]).setActive(project.id, project.revision);
    this.#model.activeProjectId = project.id;
  }

  async #delete(): Promise<void> {
    const deleting = this.#random.pick(this.#deletableProjects());
    const replacement = this.#random.pick(
      [...this.#model.projects.values()].filter((project) => project.id !== deleting.id),
    );
    await this.#first.deleteAndActivate(
      deleting.id,
      deleting.revision,
      replacement.id,
      null,
    );
    this.#model.projects.delete(deleting.id);
    this.#model.activeProjectId = replacement.id;
  }

  async #abortDelete(): Promise<void> {
    const deleting = this.#random.pick([...this.#model.projects.values()]);
    const survivor = [...this.#model.projects.values()].find((project) => project.id !== deleting.id);
    const replacement = survivor ? null : this.#newProject('Unused stale-delete replacement');
    const result = await this.#second.deleteAndActivate(
      deleting.id,
      deleting.revision + 1,
      survivor?.id ?? replacement!.id,
      replacement,
    ).catch((cause: unknown) => cause);
    expect(result).toBeInstanceOf(ProjectConflictError);
  }

  async #resolveConflict(concurrent: boolean): Promise<void> {
    const conflict = this.#random.pick(this.#conflicts());
    const source = this.#model.projects.get(conflict.conflict!.sourceProjectId)!;
    const resolution = this.#random.pick<ProjectConflictResolution>([
      'keep-source',
      'keep-conflict',
      'keep-both',
    ]);
    const resolvedAt = this.#tick();
    const input = {
      conflictProjectId: conflict.id,
      expectedConflictRevision: conflict.revision,
      sourceProjectId: source.id,
      expectedSourceRevision: source.revision,
      resolution,
      resolvedAt,
    } as const;
    if (concurrent) {
      const results = await Promise.allSettled([
        this.#first.resolveConflict(input),
        this.#second.resolveConflict(input),
      ]);
      expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
      expect(results.find(({ status }) => status === 'rejected')).toMatchObject({
        reason: expect.any(ProjectConflictError),
      });
    } else {
      await this.#random.pick([this.#first, this.#second]).resolveConflict(input);
    }
    if (resolution === 'keep-source') {
      this.#model.projects.delete(conflict.id);
      this.#model.activeProjectId = source.id;
    } else if (resolution === 'keep-conflict') {
      this.#model.projects.set(source.id, {
        ...source,
        revision: source.revision + 1,
        name: conflict.name.replace(/ \(conflict copy\)$/u, ''),
        design: conflict.design,
        updatedAt: Math.max(resolvedAt, source.updatedAt),
      });
      this.#model.projects.delete(conflict.id);
      this.#model.activeProjectId = source.id;
    } else {
      const independent = {
        ...conflict,
        revision: conflict.revision + 1,
        name: conflict.name.replace(/ \(conflict copy\)$/u, ''),
        updatedAt: Math.max(resolvedAt, conflict.updatedAt),
        conflict: null,
      } satisfies Project;
      this.#model.projects.set(conflict.id, independent);
      this.#model.activeProjectId = independent.id;
    }
  }

  async #importBatch(): Promise<void> {
    const source = this.#newProject(`Imported source ${this.#identity}`);
    const createdAt = this.#tick();
    const conflict = createProject({
      id: this.#nextId('import-conflict'),
      name: `Imported conflict ${this.#identity}`,
      design: DEFAULT_DESIGN,
      createdAt,
      conflict: { sourceProjectId: source.id, sourceRevision: 1, createdAt },
    });
    await this.#first.importProjects([source, conflict], conflict.id);
    this.#model.projects.set(source.id, { ...source, revision: 1 });
    this.#model.projects.set(conflict.id, { ...conflict, revision: 1 });
    this.#model.activeProjectId = conflict.id;
  }

  async #abortImport(): Promise<void> {
    const collision = this.#random.pick([...this.#model.projects.values()]);
    const beforeFailure = this.#newProject(`Rolled back ${this.#identity}`);
    const duplicate = createProject({
      id: collision.id,
      name: 'Existing collision',
      design: DEFAULT_DESIGN,
      createdAt: this.#tick(),
    });
    const result = await this.#second.importProjects(
      [beforeFailure, duplicate],
      beforeFailure.id,
    ).catch((cause: unknown) => cause);
    expect(result).toMatchObject({ kind: 'write-failed' });
  }

  async #injectQuarantine(): Promise<void> {
    const id = this.#nextId('corrupt');
    const raw = { id, schemaVersion: 2, marker: this.#identity++ };
    await this.#putRaw(raw);
    this.#model.quarantines.set(id, {
      raw,
      issue: createProjectQuarantineRecord(raw, 'project revision is invalid'),
    });
  }

  async #purge(): Promise<void> {
    const [id, fixture] = this.#random.pick([...this.#model.quarantines.entries()]);
    await this.#first.purgeQuarantinedRecord(fixture.issue);
    this.#model.quarantines.delete(id);
  }

  async #racePurge(): Promise<void> {
    const [id, fixture] = this.#random.pick([...this.#model.quarantines.entries()]);
    const results = await Promise.allSettled([
      this.#first.purgeQuarantinedRecord(fixture.issue),
      this.#second.purgeQuarantinedRecord(fixture.issue),
    ]);
    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(results.find(({ status }) => status === 'rejected')).toMatchObject({
      reason: expect.any(ProjectQuarantineConflictError),
    });
    this.#model.quarantines.delete(id);
  }

  async #abortTamperedPurge(): Promise<void> {
    const [id, fixture] = this.#random.pick([...this.#model.quarantines.entries()]);
    const raw = { ...fixture.raw, tamperedAt: this.#tick() };
    await this.#putRaw(raw);
    const result = await this.#second.purgeQuarantinedRecord(fixture.issue)
      .catch((cause: unknown) => cause);
    expect(result).toBeInstanceOf(ProjectQuarantineConflictError);
    this.#model.quarantines.set(id, {
      raw,
      issue: createProjectQuarantineRecord(raw, 'project revision is invalid'),
    });
  }

  async #putRaw(raw: Record<string, unknown>): Promise<void> {
    const database = await openDatabase(this.#factory, this.#databaseName);
    const transaction = database.transaction('projects', 'readwrite');
    const completed = transactionDone(transaction);
    transaction.objectStore('projects').put(raw);
    await completed;
    database.close();
  }

  async #assertInvariants(action: string): Promise<void> {
    const actual = await this.#first.load();
    expect(
      [...actual.projects].sort((left, right) => left.id.localeCompare(right.id)),
      `project state after ${action}`,
    ).toEqual([...this.#model.projects.values()].sort((left, right) =>
      left.id.localeCompare(right.id)));
    expect(actual.activeProjectId, `active project after ${action}`)
      .toBe(this.#model.activeProjectId);
    expect(
      [...actual.issues].sort((left, right) => left.contentHash.localeCompare(right.contentHash)),
      `quarantine state after ${action}`,
    ).toEqual([...this.#model.quarantines.values()].map(({ issue }) => issue)
      .sort((left, right) => left.contentHash.localeCompare(right.contentHash)));

    expect(this.#model.activeProjectId).not.toBeNull();
    expect(this.#model.projects.has(this.#model.activeProjectId!)).toBe(true);
    for (const project of this.#model.projects.values()) {
      expect(project.schemaVersion).toBe(2);
      const previous = this.#model.highestRevisions.get(project.id) ?? 0;
      expect(project.revision, `revision of ${project.id}`).toBeGreaterThanOrEqual(previous);
      this.#model.highestRevisions.set(project.id, project.revision);
      if (project.conflict) {
        expect(this.#model.projects.has(project.conflict.sourceProjectId),
          `conflict source of ${project.id}`).toBe(true);
      }
    }
    this.#assertAcyclicConflictLineage();

    const database = await openDatabase(this.#factory, this.#databaseName);
    expect(database.version).toBe(2);
    expect(Array.from(database.objectStoreNames).sort()).toEqual(['projects', 'workspace']);
    const transaction = database.transaction('workspace');
    const completed = transactionDone(transaction);
    const metadata = await requestResult(transaction.objectStore('workspace').get('schema'));
    await completed;
    database.close();
    expect(metadata).toEqual({ key: 'schema', databaseVersion: 2, projectSchemaVersion: 2 });
  }

  #assertAcyclicConflictLineage(): void {
    for (const project of this.#model.projects.values()) {
      const path = new Set<string>();
      let current: Project | undefined = project;
      while (current?.conflict) {
        expect(path.has(current.id), `conflict cycle at ${current.id}`).toBe(false);
        path.add(current.id);
        current = this.#model.projects.get(current.conflict.sourceProjectId);
      }
    }
  }

  #conflicts(): readonly Project[] {
    return [...this.#model.projects.values()].filter((project) => project.conflict !== null);
  }

  #deletableProjects(): readonly Project[] {
    if (this.#model.projects.size < 2) return [];
    const sourceIds = new Set(this.#conflicts().map((project) => project.conflict!.sourceProjectId));
    return [...this.#model.projects.values()].filter((project) => !sourceIds.has(project.id));
  }

  #newProject(name: string): Project {
    return createProject({
      id: this.#nextId('project'),
      name,
      design: DEFAULT_DESIGN,
      createdAt: this.#tick(),
    });
  }

  #nextId(prefix: string): string {
    this.#identity += 1;
    return `${prefix}-${this.#identity}`;
  }

  #tick(): number {
    this.#time += 1;
    return this.#time;
  }
}

describe('IndexedDbProjectRepository model-based state machine', () => {
  it.each(seeds)('preserves every invariant for seed %s', async (seed) => {
    let machine: PersistenceStateMachine | null = null;
    try {
      machine = await PersistenceStateMachine.create(seed);
      await machine.run(steps);
    } catch (cause) {
      throw new Error(
        `Persistence state-machine failure. Replay with SEEMOJI_STATE_SEED=${seed} `
        + `SEEMOJI_STATE_STEPS=${steps}. Recent actions: ${machine?.trace() ?? 'bootstrap'}`,
        { cause },
      );
    } finally {
      machine?.close();
    }
  }, 30_000);
});
