import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { DEFAULT_DESIGN } from '../../domain/design';
import { createProject } from '../../domain/project';
import {
  ProjectConflictError,
  ProjectQuarantineConflictError,
} from '../../ports/projectRepository';
import { IndexedDbProjectRepository } from './indexedDbProjectRepository';

const project = (id: string, updatedAt: number) => createProject({
  id,
  name: id,
  design: DEFAULT_DESIGN,
  createdAt: 1,
  updatedAt,
});

const openFixture = (
  factory: IDBFactory,
  name: string,
  version: number,
  upgrade: (database: IDBDatabase, transaction: IDBTransaction) => void,
): Promise<IDBDatabase> => new Promise((resolve, reject) => {
  const request = factory.open(name, version);
  request.addEventListener('upgradeneeded', () => upgrade(request.result, request.transaction!), {
    once: true,
  });
  request.addEventListener('success', () => resolve(request.result), { once: true });
  request.addEventListener('error', () => reject(request.error), { once: true });
});

const requestValue = <T>(request: IDBRequest<T>): Promise<T> => new Promise((resolve, reject) => {
  request.addEventListener('success', () => resolve(request.result), { once: true });
  request.addEventListener('error', () => reject(request.error), { once: true });
});

describe('IndexedDbProjectRepository', () => {
  it('transactionally migrates a version 1 fixture and records authoritative schema metadata', async () => {
    const factory = new IDBFactory();
    const databaseName = 'project-schema-v1-migration';
    const legacyProject = { ...project('legacy', 2), revision: 1 };
    const legacy = await openFixture(factory, databaseName, 1, (database, transaction) => {
      database.createObjectStore('projects', { keyPath: 'id' }).put(legacyProject);
      database.createObjectStore('workspace', { keyPath: 'key' }).put({
        key: 'activeProjectId',
        value: legacyProject.id,
      });
      expect(transaction.mode).toBe('versionchange');
    });
    legacy.close();

    const first = new IndexedDbProjectRepository(factory, databaseName);
    await expect(first.load()).resolves.toMatchObject({
      projects: [{ id: 'legacy', revision: 1 }],
      activeProjectId: 'legacy',
      issues: [],
    });
    first.close();

    const migrated = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open(databaseName);
      request.addEventListener('success', () => resolve(request.result), { once: true });
      request.addEventListener('error', () => reject(request.error), { once: true });
    });
    expect(migrated.version).toBe(2);
    const metadata = await requestValue(
      migrated.transaction('workspace').objectStore('workspace').get('schema'),
    );
    expect(metadata).toEqual({ key: 'schema', databaseVersion: 2, projectSchemaVersion: 2 });
    migrated.close();

    const reopened = new IndexedDbProjectRepository(factory, databaseName);
    expect((await reopened.load()).projects).toEqual([legacyProject]);
    reopened.close();
  });

  it('rolls back the database version and data when a migration fails', async () => {
    const factory = new IDBFactory();
    const databaseName = 'project-schema-migration-rollback';
    const legacyProject = { ...project('legacy', 2), revision: 1 };
    const legacy = await openFixture(factory, databaseName, 1, (database) => {
      database.createObjectStore('projects', { keyPath: 'id' }).put(legacyProject);
      database.createObjectStore('workspace', { keyPath: 'identity' });
    });
    legacy.close();

    const repository = new IndexedDbProjectRepository(factory, databaseName);
    await expect(repository.load()).rejects.toMatchObject({ kind: 'migration-failed' });

    const rolledBack = await openFixture(factory, databaseName, 1, () => undefined);
    expect(rolledBack.version).toBe(1);
    expect(await requestValue(
      rolledBack.transaction('projects').objectStore('projects').get('legacy'),
    )).toEqual(legacyProject);
    rolledBack.close();
  });

  it('reports an actionable blocked upgrade while another version 1 connection is open', async () => {
    const factory = new IDBFactory();
    const databaseName = 'project-schema-upgrade-blocked';
    const held = await openFixture(factory, databaseName, 1, (database) => {
      database.createObjectStore('projects', { keyPath: 'id' });
      database.createObjectStore('workspace', { keyPath: 'key' });
    });
    const repository = new IndexedDbProjectRepository(factory, databaseName);
    await expect(repository.load()).rejects.toMatchObject({
      kind: 'upgrade-blocked',
      message: expect.stringContaining('close other seemoji tabs'),
    });
    held.close();
  });

  it('rejects a current-version database whose schema metadata was tampered with', async () => {
    const factory = new IDBFactory();
    const databaseName = 'project-schema-metadata-mismatch';
    const database = await openFixture(factory, databaseName, 2, (created) => {
      created.createObjectStore('projects', { keyPath: 'id' });
      created.createObjectStore('workspace', { keyPath: 'key' }).put({
        key: 'schema',
        databaseVersion: 2,
        projectSchemaVersion: 999,
      });
    });
    database.close();
    const repository = new IndexedDbProjectRepository(factory, databaseName);
    await expect(repository.load()).rejects.toMatchObject({ kind: 'schema-mismatch' });
  });

  it('stores projects independently and tracks the active project', async () => {
    const repository = new IndexedDbProjectRepository(new IDBFactory(), 'project-round-trip');
    await repository.save(project('old', 2), { activate: true, expectedRevision: null });
    await repository.save(project('new', 3), { activate: false, expectedRevision: null });

    expect(await repository.load()).toMatchObject({
      activeProjectId: 'old',
      projects: [{ id: 'new' }, { id: 'old' }],
      issues: [],
    });
    await repository.setActive('new', 1);
    expect((await repository.load()).activeProjectId).toBe('new');
    repository.close();
  });

  it('activates only the exact project revision validated by the caller', async () => {
    const repository = new IndexedDbProjectRepository(new IDBFactory(), 'project-active-cas');
    await repository.save(project('old', 2), { activate: true, expectedRevision: null });
    const candidate = await repository.save(project('new', 3), {
      activate: false,
      expectedRevision: null,
    });
    const changed = await repository.save({ ...candidate, name: 'Changed remotely' }, {
      activate: false,
      expectedRevision: candidate.revision,
    });

    await expect(repository.setActive(candidate.id, candidate.revision)).rejects.toMatchObject({
      name: 'ProjectConflictError',
      latestProject: { id: candidate.id, revision: changed.revision, name: 'Changed remotely' },
    });
    await expect(repository.setActive('missing', 1)).rejects.toMatchObject({
      name: 'ProjectConflictError',
      latestProject: null,
    });
    expect((await repository.load()).activeProjectId).toBe('old');

    await repository.setActive(changed.id, changed.revision);
    expect((await repository.load()).activeProjectId).toBe(changed.id);
    repository.close();
  });

  it('deletes and replaces the active project in one transaction', async () => {
    const repository = new IndexedDbProjectRepository(new IDBFactory(), 'project-delete');
    const deleted = await repository.save(project('deleted', 2), {
      activate: true,
      expectedRevision: null,
    });
    const replacement = project('replacement', 3);
    await repository.deleteAndActivate('deleted', deleted.revision, replacement.id, replacement);

    const loaded = await repository.load();
    expect(loaded.projects.map(({ id }) => id)).toEqual(['replacement']);
    expect(loaded.activeProjectId).toBe('replacement');
    repository.close();
  });

  it('does not delete the source when its requested survivor was concurrently removed', async () => {
    const repository = new IndexedDbProjectRepository(new IDBFactory(), 'project-delete-survivor-cas');
    const first = await repository.save(project('first', 2), {
      activate: true,
      expectedRevision: null,
    });
    const second = await repository.save(project('second', 3), {
      activate: false,
      expectedRevision: null,
    });
    await repository.deleteAndActivate(second.id, second.revision, first.id, null);

    await expect(
      repository.deleteAndActivate(first.id, first.revision, second.id, null),
    ).rejects.toBeInstanceOf(ProjectConflictError);
    await expect(repository.load()).resolves.toMatchObject({
      activeProjectId: first.id,
      projects: [{ id: first.id, revision: first.revision }],
    });
    repository.close();
  });

  it('requires a replacement to own a new matching active identity', async () => {
    const repository = new IndexedDbProjectRepository(new IDBFactory(), 'project-delete-replacement-cas');
    const first = await repository.save(project('first', 2), {
      activate: true,
      expectedRevision: null,
    });
    const existing = await repository.save(project('existing', 3), {
      activate: false,
      expectedRevision: null,
    });
    await expect(repository.deleteAndActivate(
      first.id,
      first.revision,
      'different',
      project('replacement', 4),
    )).rejects.toMatchObject({ kind: 'write-failed' });
    await expect(repository.deleteAndActivate(
      first.id,
      first.revision,
      existing.id,
      project(existing.id, 4),
    )).rejects.toBeInstanceOf(ProjectConflictError);
    expect((await repository.load()).projects.map(({ id }) => id).sort())
      .toEqual(['existing', 'first']);
    repository.close();
  });

  it('does not overwrite a quarantined raw record at a replacement identity', async () => {
    const factory = new IDBFactory();
    const databaseName = 'project-delete-corrupt-replacement';
    const repository = new IndexedDbProjectRepository(factory, databaseName);
    const source = await repository.save(project('source', 2), {
      activate: true,
      expectedRevision: null,
    });
    const database = await openFixture(factory, databaseName, 2, () => undefined);
    const transaction = database.transaction('projects', 'readwrite');
    transaction.objectStore('projects').put({ id: 'replacement', schemaVersion: 2 });
    await new Promise<void>((resolve, reject) => {
      transaction.addEventListener('complete', () => resolve(), { once: true });
      transaction.addEventListener('error', () => reject(transaction.error), { once: true });
    });
    database.close();

    await expect(repository.deleteAndActivate(
      source.id,
      source.revision,
      'replacement',
      project('replacement', 3),
    )).rejects.toBeInstanceOf(ProjectConflictError);
    await expect(repository.load()).resolves.toMatchObject({
      activeProjectId: source.id,
      projects: [{ id: source.id }],
      issues: [{ recordId: 'replacement' }],
    });
    repository.close();
  });

  it('isolates a corrupt record instead of disabling valid projects', async () => {
    const factory = new IDBFactory();
    const databaseName = 'project-corrupt-record';
    const repository = new IndexedDbProjectRepository(factory, databaseName);
    await repository.save(project('valid', 2), { activate: true, expectedRevision: null });
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open(databaseName);
      request.addEventListener('success', () => resolve(request.result), { once: true });
      request.addEventListener('error', () => reject(request.error), { once: true });
    });
    const transaction = database.transaction('projects', 'readwrite');
    transaction.objectStore('projects').put({ id: 'corrupt', schemaVersion: 2 });
    await new Promise<void>((resolve, reject) => {
      transaction.addEventListener('complete', () => resolve(), { once: true });
      transaction.addEventListener('error', () => reject(transaction.error), { once: true });
    });

    const loaded = await repository.load();
    expect(loaded.projects.map(({ id }) => id)).toEqual(['valid']);
    expect(loaded.issues).toEqual([
      expect.objectContaining({
        recordId: 'corrupt',
        error: 'project revision is invalid',
        contentHash: expect.stringMatching(/^fnv1a32:[0-9a-f]{8}$/u),
        byteSize: 34,
        encodedRecord: { id: 'corrupt', schemaVersion: 2 },
      }),
    ]);
    database.close();
    repository.close();
  });

  it('quarantines an unknown-pack project without dropping it during unrelated CAS saves', async () => {
    const factory = new IDBFactory();
    const databaseName = 'project-unknown-pack-quarantine';
    const repository = new IndexedDbProjectRepository(factory, databaseName);
    const valid = await repository.save(project('valid', 2), {
      activate: true,
      expectedRevision: null,
    });
    const unknown = structuredClone(project('future', 3)) as unknown as {
      design: { layers: Array<{ source?: { pack: string } }> };
      readonly id: string;
    };
    unknown.design.layers[0]!.source!.pack = 'future-pack';
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open(databaseName);
      request.addEventListener('success', () => resolve(request.result), { once: true });
      request.addEventListener('error', () => reject(request.error), { once: true });
    });
    let transaction = database.transaction('projects', 'readwrite');
    transaction.objectStore('projects').put(unknown);
    await new Promise<void>((resolve) => transaction.addEventListener('complete', () => resolve(), {
      once: true,
    }));

    const loaded = await repository.load();
    expect(loaded.projects.map(({ id }) => id)).toEqual(['valid']);
    expect(loaded.issues).toMatchObject([{
      recordId: 'future',
      error: expect.stringContaining('allowlisted pack'),
      encodedRecord: unknown,
    }]);

    await repository.save({ ...valid, name: 'Valid update', updatedAt: 4 }, {
      activate: false,
      expectedRevision: valid.revision,
    });
    transaction = database.transaction('projects', 'readonly');
    const preserved = await requestValue(transaction.objectStore('projects').get('future'));
    expect(preserved).toEqual(unknown);
    const afterSave = await repository.load();
    expect(afterSave.projects).toMatchObject([{ id: 'valid', name: 'Valid update' }]);
    expect(afterSave.issues).toHaveLength(1);
    database.close();
    repository.close();
  });

  it('refuses raw reads and purges after a quarantined record is tampered with', async () => {
    const factory = new IDBFactory();
    const databaseName = 'project-quarantine-tamper';
    const repository = new IndexedDbProjectRepository(factory, databaseName);
    await repository.save(project('valid', 2), { activate: true, expectedRevision: null });
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open(databaseName);
      request.addEventListener('success', () => resolve(request.result), { once: true });
      request.addEventListener('error', () => reject(request.error), { once: true });
    });
    let transaction = database.transaction('projects', 'readwrite');
    transaction.objectStore('projects').put({ id: 'corrupt', schemaVersion: 2 });
    await new Promise<void>((resolve) => transaction.addEventListener('complete', () => resolve(), {
      once: true,
    }));
    const issue = (await repository.load()).issues[0]!;
    await expect(repository.readQuarantinedRecord(issue)).resolves.toEqual(issue);

    transaction = database.transaction('projects', 'readwrite');
    transaction.objectStore('projects').put({ id: 'corrupt', schemaVersion: 2, tampered: true });
    await new Promise<void>((resolve) => transaction.addEventListener('complete', () => resolve(), {
      once: true,
    }));
    await expect(repository.readQuarantinedRecord(issue))
      .rejects.toBeInstanceOf(ProjectQuarantineConflictError);
    await expect(repository.purgeQuarantinedRecord(issue))
      .rejects.toBeInstanceOf(ProjectQuarantineConflictError);
    const remaining = await repository.load();
    expect(remaining.issues).toHaveLength(1);
    expect(remaining.issues[0]!.contentHash).not.toBe(issue.contentHash);
    database.close();
    repository.close();
  });

  it('allows exactly one concurrent purge of the same quarantined snapshot', async () => {
    const factory = new IDBFactory();
    const first = new IndexedDbProjectRepository(factory, 'project-quarantine-purge-race');
    const second = new IndexedDbProjectRepository(factory, 'project-quarantine-purge-race');
    await first.save(project('valid', 2), { activate: true, expectedRevision: null });
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open('project-quarantine-purge-race');
      request.addEventListener('success', () => resolve(request.result), { once: true });
      request.addEventListener('error', () => reject(request.error), { once: true });
    });
    const transaction = database.transaction('projects', 'readwrite');
    transaction.objectStore('projects').put({ id: 'corrupt', schemaVersion: 2 });
    await new Promise<void>((resolve) => transaction.addEventListener('complete', () => resolve(), {
      once: true,
    }));
    const issue = (await first.load()).issues[0]!;

    const results = await Promise.allSettled([
      first.purgeQuarantinedRecord(issue),
      second.purgeQuarantinedRecord(issue),
    ]);
    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(results.find(({ status }) => status === 'rejected')).toMatchObject({
      reason: expect.any(ProjectQuarantineConflictError),
    });
    expect((await first.load()).issues).toEqual([]);
    database.close();
    first.close();
    second.close();
  });

  it('rejects a stale compare-and-swap without overwriting the latest project', async () => {
    const repository = new IndexedDbProjectRepository(new IDBFactory(), 'project-conflict');
    const initial = await repository.save(project('shared', 2), {
      activate: true,
      expectedRevision: null,
    });
    const latest = await repository.save({ ...initial, name: 'Latest', updatedAt: 3 }, {
      activate: false,
      expectedRevision: initial.revision,
    });

    const conflict = await repository.save({ ...initial, name: 'Stale', updatedAt: 4 }, {
      activate: false,
      expectedRevision: initial.revision,
    }).catch((cause: unknown) => cause);
    expect(conflict).toBeInstanceOf(ProjectConflictError);
    expect(conflict).toMatchObject({
      latestProject: latest,
    });
    expect((await repository.load()).projects[0]).toEqual(latest);
    repository.close();
  });

  it.each([
    ['keep-source', ['source'], 'source'],
    ['keep-conflict', ['source'], 'Local edit'],
    ['keep-both', ['conflict', 'source'], 'Local edit'],
  ] as const)('resolves a conflict atomically with %s', async (resolution, ids, activeName) => {
    const repository = new IndexedDbProjectRepository(
      new IDBFactory(),
      `project-resolve-${resolution}`,
    );
    const source = await repository.save(project('source', 2), {
      activate: true,
      expectedRevision: null,
    });
    const conflict = await repository.save(createProject({
      id: 'conflict',
      name: 'Local edit (conflict copy)',
      design: DEFAULT_DESIGN,
      createdAt: 3,
      conflict: {
        sourceProjectId: source.id,
        sourceRevision: source.revision,
        createdAt: 3,
      },
    }), { activate: true, expectedRevision: null });

    await repository.resolveConflict({
      conflictProjectId: conflict.id,
      expectedConflictRevision: conflict.revision,
      sourceProjectId: source.id,
      expectedSourceRevision: source.revision,
      resolution,
      resolvedAt: 4,
    });

    const loaded = await repository.load();
    expect(loaded.projects.map(({ id }) => id).sort()).toEqual([...ids]);
    expect(loaded.projects.find(({ id }) => id === loaded.activeProjectId)?.name).toBe(activeName);
    expect(loaded.projects.every(({ conflict: lineage }) => lineage === null)).toBe(true);
    repository.close();
  });

  it('allows exactly one tab to resolve the same conflict revision', async () => {
    const factory = new IDBFactory();
    const first = new IndexedDbProjectRepository(factory, 'project-resolution-race');
    const second = new IndexedDbProjectRepository(factory, 'project-resolution-race');
    const source = await first.save(project('source', 2), {
      activate: true,
      expectedRevision: null,
    });
    const conflict = await first.save(createProject({
      id: 'conflict',
      name: 'Local edit (conflict copy)',
      design: DEFAULT_DESIGN,
      createdAt: 3,
      conflict: {
        sourceProjectId: source.id,
        sourceRevision: source.revision,
        createdAt: 3,
      },
    }), { activate: true, expectedRevision: null });
    const input = {
      conflictProjectId: conflict.id,
      expectedConflictRevision: conflict.revision,
      sourceProjectId: source.id,
      expectedSourceRevision: source.revision,
      resolution: 'keep-both' as const,
      resolvedAt: 4,
    };

    const results = await Promise.allSettled([
      first.resolveConflict(input),
      second.resolveConflict(input),
    ]);
    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find(({ status }) => status === 'rejected');
    expect(rejected).toMatchObject({ reason: expect.any(ProjectConflictError) });
    expect((await first.load()).projects.find(({ id }) => id === conflict.id)).toMatchObject({
      revision: 2,
      conflict: null,
    });
    first.close();
    second.close();
  });

  it('preserves conflict lineage transactionally and blocks orphaning deletion', async () => {
    const repository = new IndexedDbProjectRepository(new IDBFactory(), 'project-conflict-lineage');
    const source = await repository.save(project('source', 2), {
      activate: true,
      expectedRevision: null,
    });
    const conflict = createProject({
      id: 'conflict',
      name: 'Local edit (conflict copy)',
      design: DEFAULT_DESIGN,
      createdAt: 3,
      conflict: {
        sourceProjectId: source.id,
        sourceRevision: source.revision,
        createdAt: 3,
      },
    });
    const persisted = await repository.preserveConflict(conflict, source.revision);
    expect(persisted).toMatchObject({ revision: 1, conflict: conflict.conflict });

    await expect(repository.deleteAndActivate(
      source.id,
      source.revision,
      persisted.id,
      null,
    )).rejects.toBeInstanceOf(ProjectConflictError);
    expect((await repository.load()).projects.map(({ id }) => id).sort()).toEqual([
      'conflict',
      'source',
    ]);
    repository.close();
  });

  it('imports a complete project batch and activates its requested project', async () => {
    const repository = new IndexedDbProjectRepository(new IDBFactory(), 'project-archive-import');
    await repository.save(project('existing', 1), { activate: true, expectedRevision: null });
    const source = project('import-source', 2);
    const conflict = createProject({
      id: 'import-conflict',
      name: 'Conflict',
      design: DEFAULT_DESIGN,
      createdAt: 2,
      conflict: { sourceProjectId: source.id, sourceRevision: 1, createdAt: 2 },
    });
    await repository.importProjects([source, conflict], conflict.id);
    const loaded = await repository.load();
    expect(loaded.projects.map(({ id }) => id).sort()).toEqual([
      'existing',
      'import-conflict',
      'import-source',
    ]);
    expect(loaded.projects.filter(({ id }) => id.startsWith('import-'))
      .every(({ revision }) => revision === 1)).toBe(true);
    expect(loaded.activeProjectId).toBe(conflict.id);
    repository.close();
  });

  it('rolls back every imported project when one identity collides', async () => {
    const repository = new IndexedDbProjectRepository(new IDBFactory(), 'project-archive-rollback');
    await repository.save(project('existing', 1), { activate: true, expectedRevision: null });
    await expect(repository.importProjects([
      project('new-before-failure', 2),
      project('existing', 3),
    ], 'new-before-failure')).rejects.toMatchObject({ kind: 'write-failed' });
    const loaded = await repository.load();
    expect(loaded.projects.map(({ id }) => id)).toEqual(['existing']);
    expect(loaded.activeProjectId).toBe('existing');
    repository.close();
  });

  it('reports unavailable IndexedDB explicitly', async () => {
    const repository = new IndexedDbProjectRepository(null);
    await expect(repository.load()).rejects.toMatchObject({
      kind: 'unavailable',
    });
  });
});
