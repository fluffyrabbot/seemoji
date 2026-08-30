import { decodeProject, type Project } from '../../domain/project';
import {
  createProjectQuarantineRecord,
  sameProjectQuarantineRecord,
  type ProjectQuarantineRecord,
} from '../../domain/projectQuarantine';
import {
  ProjectConflictError,
  ProjectQuarantineConflictError,
  type ProjectRecordIssue,
  type ProjectRepository,
  type ProjectSaveOptions,
  type ProjectWorkspace,
  type ResolveProjectConflictInput,
} from '../../ports/projectRepository';

const DATABASE_NAME = 'seemoji';
const DATABASE_VERSION = 2;
const PROJECT_SCHEMA_VERSION = 2;
const PROJECTS_STORE = 'projects';
const WORKSPACE_STORE = 'workspace';
const ACTIVE_PROJECT_KEY = 'activeProjectId';
const SCHEMA_KEY = 'schema';

interface WorkspaceRecord {
  readonly key: typeof ACTIVE_PROJECT_KEY;
  readonly value: string;
}

interface SchemaRecord {
  readonly key: typeof SCHEMA_KEY;
  readonly databaseVersion: typeof DATABASE_VERSION;
  readonly projectSchemaVersion: typeof PROJECT_SCHEMA_VERSION;
}

export class ProjectRepositoryError extends Error {
  readonly kind: 'unavailable' | 'corrupt' | 'write-failed'
    | 'upgrade-blocked' | 'migration-failed' | 'schema-mismatch';

  constructor(
    message: string,
    kind: ProjectRepositoryError['kind'],
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'ProjectRepositoryError';
    this.kind = kind;
  }
}

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

const assertStore = (
  transaction: IDBTransaction,
  name: string,
  keyPath: string,
): IDBObjectStore => {
  const store = transaction.objectStore(name);
  if (store.keyPath !== keyPath || store.autoIncrement) {
    throw new Error(`Object store ${name} has an incompatible key configuration`);
  }
  return store;
};

const assertStoreNames = (database: IDBDatabase): void => {
  const actual = Array.from(database.objectStoreNames).sort().join(',');
  if (actual !== `${PROJECTS_STORE},${WORKSPACE_STORE}`) {
    throw new Error(`Object stores are incompatible: ${actual || 'none'}`);
  }
};

const migrateDatabase = (
  database: IDBDatabase,
  transaction: IDBTransaction,
  oldVersion: number,
): void => {
  for (let version = oldVersion + 1; version <= DATABASE_VERSION; version += 1) {
    if (version === 1) {
      database.createObjectStore(PROJECTS_STORE, { keyPath: 'id' });
      database.createObjectStore(WORKSPACE_STORE, { keyPath: 'key' });
    } else if (version === 2) {
      assertStoreNames(database);
      assertStore(transaction, PROJECTS_STORE, 'id');
      assertStore(transaction, WORKSPACE_STORE, 'key').put({
        key: SCHEMA_KEY,
        databaseVersion: DATABASE_VERSION,
        projectSchemaVersion: PROJECT_SCHEMA_VERSION,
      } satisfies SchemaRecord);
    }
  }
};

const verifyDatabaseSchema = async (database: IDBDatabase): Promise<void> => {
  if (database.version !== DATABASE_VERSION) {
    throw new Error(`Database version ${database.version} is unsupported`);
  }
  assertStoreNames(database);
  const transaction = database.transaction([PROJECTS_STORE, WORKSPACE_STORE], 'readonly');
  const completed = transactionDone(transaction);
  assertStore(transaction, PROJECTS_STORE, 'id');
  const workspace = assertStore(transaction, WORKSPACE_STORE, 'key');
  const metadata = await requestResult(workspace.get(SCHEMA_KEY)) as SchemaRecord | undefined;
  await completed;
  if (metadata?.key !== SCHEMA_KEY
      || metadata.databaseVersion !== DATABASE_VERSION
      || metadata.projectSchemaVersion !== PROJECT_SCHEMA_VERSION) {
    throw new Error('Database schema metadata is missing or incompatible');
  }
};

export class IndexedDbProjectRepository implements ProjectRepository {
  readonly #factory: IDBFactory | null;
  readonly #databaseName: string;
  #database: Promise<IDBDatabase> | null = null;

  constructor(
    factory: IDBFactory | null = globalThis.indexedDB ?? null,
    databaseName = DATABASE_NAME,
  ) {
    this.#factory = factory;
    this.#databaseName = databaseName;
  }

  async load(): Promise<ProjectWorkspace> {
    const database = await this.#open();
    try {
      const transaction = database.transaction([PROJECTS_STORE, WORKSPACE_STORE], 'readonly');
      const completed = transactionDone(transaction);
      const projectsRequest = requestResult(transaction.objectStore(PROJECTS_STORE).getAll());
      const activeRequest = requestResult(
        transaction.objectStore(WORKSPACE_STORE).get(ACTIVE_PROJECT_KEY),
      );
      const [rawProjects, active] = await Promise.all([
        projectsRequest,
        activeRequest,
        completed,
      ]) as [unknown[], WorkspaceRecord | undefined, void];

      const issues: ProjectRecordIssue[] = [];
      const projects = rawProjects.flatMap((raw) => {
        const decoded = decodeProject(raw);
        if (decoded.ok) return [decoded.value];
        issues.push(createProjectQuarantineRecord(raw, decoded.error));
        return [];
      }).sort((a, b) => b.updatedAt - a.updatedAt);
      return {
        projects,
        activeProjectId: typeof active?.value === 'string' ? active.value : null,
        issues,
      };
    } catch (cause) {
      throw new ProjectRepositoryError('The project workspace could not be read', 'corrupt', { cause });
    }
  }

  async save(project: Project, options: ProjectSaveOptions): Promise<Project> {
    const decoded = decodeProject(project);
    if (!decoded.ok) throw new ProjectRepositoryError(decoded.error, 'write-failed');
    if (decoded.value.revision !== (options.expectedRevision ?? 0)) {
      throw new ProjectRepositoryError('Project revision does not match the expected revision', 'write-failed');
    }
    const database = await this.#open();
    let conflict: ProjectConflictError | null = null;
    let persisted: Project | null = null;
    try {
      const transaction = database.transaction([PROJECTS_STORE, WORKSPACE_STORE], 'readwrite');
      const completed = transactionDone(transaction);
      const projects = transaction.objectStore(PROJECTS_STORE);
      const existingRequest = projects.get(project.id);
      existingRequest.addEventListener('success', () => {
        const existing = existingRequest.result === undefined
          ? null : decodeProject(existingRequest.result);
        const latest = existing?.ok ? existing.value : null;
        const matches = options.expectedRevision === null
          ? existingRequest.result === undefined
          : latest?.revision === options.expectedRevision;
        if (!matches) {
          conflict = new ProjectConflictError(
            `Project ${project.id} changed in another workspace`,
            latest,
          );
          transaction.abort();
          return;
        }
        persisted = { ...decoded.value, revision: (options.expectedRevision ?? 0) + 1 };
        projects.put(persisted);
        if (options.activate) {
          transaction.objectStore(WORKSPACE_STORE).put({ key: ACTIVE_PROJECT_KEY, value: project.id });
        }
      }, { once: true });
      await completed;
    } catch (cause) {
      if (conflict) throw conflict;
      throw new ProjectRepositoryError('The project could not be saved', 'write-failed', { cause });
    }
    if (!persisted) throw new ProjectRepositoryError('The project save produced no result', 'write-failed');
    return persisted;
  }

  async importProjects(projectsToImport: readonly Project[], activeProjectId: string): Promise<void> {
    if (projectsToImport.length === 0 || projectsToImport.length > 1_000) {
      throw new ProjectRepositoryError('Project import size is invalid', 'write-failed');
    }
    const decoded = projectsToImport.map((project) => decodeProject(project));
    if (decoded.some((project) => !project.ok || project.value.revision !== 0)) {
      throw new ProjectRepositoryError('Imported projects must be new and valid', 'write-failed');
    }
    const projects = decoded.map((project) => project.ok ? project.value : null)
      .filter((project): project is Project => project !== null);
    const ids = new Set(projects.map((project) => project.id));
    if (ids.size !== projects.length || !ids.has(activeProjectId)
        || projects.some((project) => project.conflict
          && !ids.has(project.conflict.sourceProjectId))) {
      throw new ProjectRepositoryError('Imported project identities are invalid', 'write-failed');
    }
    const database = await this.#open();
    try {
      const transaction = database.transaction([PROJECTS_STORE, WORKSPACE_STORE], 'readwrite');
      const completed = transactionDone(transaction);
      const store = transaction.objectStore(PROJECTS_STORE);
      for (const project of projects) store.add({ ...project, revision: 1 });
      transaction.objectStore(WORKSPACE_STORE).put({
        key: ACTIVE_PROJECT_KEY,
        value: activeProjectId,
      });
      await completed;
    } catch (cause) {
      throw new ProjectRepositoryError(
        'The workspace archive could not be imported atomically',
        'write-failed',
        { cause },
      );
    }
  }

  async readQuarantinedRecord(
    expected: ProjectQuarantineRecord,
  ): Promise<ProjectQuarantineRecord> {
    const database = await this.#open();
    try {
      const transaction = database.transaction(PROJECTS_STORE, 'readonly');
      const completed = transactionDone(transaction);
      const rawRecords = await requestResult(transaction.objectStore(PROJECTS_STORE).getAll());
      await completed;
      for (const raw of rawRecords) {
        const decoded = decodeProject(raw);
        if (decoded.ok) continue;
        const current = createProjectQuarantineRecord(raw, decoded.error);
        if (sameProjectQuarantineRecord(current, expected)) return current;
      }
    } catch (cause) {
      throw new ProjectRepositoryError('The quarantined record could not be read', 'corrupt', {
        cause,
      });
    }
    throw new ProjectQuarantineConflictError();
  }

  async purgeQuarantinedRecord(expected: ProjectQuarantineRecord): Promise<void> {
    const database = await this.#open();
    let conflict: ProjectQuarantineConflictError | null = null;
    try {
      const transaction = database.transaction(PROJECTS_STORE, 'readwrite');
      const completed = transactionDone(transaction);
      const store = transaction.objectStore(PROJECTS_STORE);
      const recordsRequest = store.getAll();
      const keysRequest = store.getAllKeys();
      let requestsCompleted = 0;
      const purge = () => {
        requestsCompleted += 1;
        if (requestsCompleted !== 2) return;
        const index = recordsRequest.result.findIndex((raw) => {
          const decoded = decodeProject(raw);
          return !decoded.ok && sameProjectQuarantineRecord(
            createProjectQuarantineRecord(raw, decoded.error),
            expected,
          );
        });
        const key = keysRequest.result[index];
        if (index < 0 || key === undefined) {
          conflict = new ProjectQuarantineConflictError();
          transaction.abort();
          return;
        }
        store.delete(key);
      };
      recordsRequest.addEventListener('success', purge, { once: true });
      keysRequest.addEventListener('success', purge, { once: true });
      await completed;
    } catch (cause) {
      if (conflict) throw conflict;
      throw new ProjectRepositoryError('The quarantined record could not be purged', 'write-failed', {
        cause,
      });
    }
  }

  async preserveConflict(project: Project, expectedSourceRevision: number): Promise<Project> {
    const decoded = decodeProject(project);
    if (!decoded.ok || decoded.value.revision !== 0 || !decoded.value.conflict) {
      throw new ProjectRepositoryError('Conflict copy is invalid', 'write-failed');
    }
    const database = await this.#open();
    let conflictError: ProjectConflictError | null = null;
    let persisted: Project | null = null;
    try {
      const transaction = database.transaction([PROJECTS_STORE, WORKSPACE_STORE], 'readwrite');
      const completed = transactionDone(transaction);
      const projects = transaction.objectStore(PROJECTS_STORE);
      const copyRequest = projects.get(project.id);
      const sourceRequest = projects.get(decoded.value.conflict.sourceProjectId);
      let requestsCompleted = 0;
      const preserve = () => {
        requestsCompleted += 1;
        if (requestsCompleted !== 2) return;
        const source = decodeProject(sourceRequest.result);
        const latestSource = source.ok ? source.value : null;
        if (copyRequest.result !== undefined || latestSource?.revision !== expectedSourceRevision) {
          conflictError = new ProjectConflictError(
            'The original project changed before its conflict copy was preserved',
            latestSource,
          );
          transaction.abort();
          return;
        }
        persisted = { ...decoded.value, revision: 1 };
        projects.put(persisted);
        transaction.objectStore(WORKSPACE_STORE).put({
          key: ACTIVE_PROJECT_KEY,
          value: persisted.id,
        });
      };
      copyRequest.addEventListener('success', preserve, { once: true });
      sourceRequest.addEventListener('success', preserve, { once: true });
      await completed;
    } catch (cause) {
      if (conflictError) throw conflictError;
      throw new ProjectRepositoryError('The conflict copy could not be preserved', 'write-failed', {
        cause,
      });
    }
    if (!persisted) {
      throw new ProjectRepositoryError('Conflict preservation produced no result', 'write-failed');
    }
    return persisted;
  }

  async setActive(id: string): Promise<void> {
    if (!id) throw new ProjectRepositoryError('Active project id is invalid', 'write-failed');
    const database = await this.#open();
    try {
      const transaction = database.transaction(WORKSPACE_STORE, 'readwrite');
      const completed = transactionDone(transaction);
      transaction.objectStore(WORKSPACE_STORE).put({ key: ACTIVE_PROJECT_KEY, value: id });
      await completed;
    } catch (cause) {
      throw new ProjectRepositoryError('The active project could not be updated', 'write-failed', { cause });
    }
  }

  async deleteAndActivate(
    id: string,
    expectedRevision: number,
    activeProjectId: string,
    replacement: Project | null,
  ): Promise<Project | null> {
    if (!id || !activeProjectId) {
      throw new ProjectRepositoryError('Project deletion identity is invalid', 'write-failed');
    }
    if (replacement) {
      const decoded = decodeProject(replacement);
      if (!decoded.ok) throw new ProjectRepositoryError(decoded.error, 'write-failed');
      if (decoded.value.revision !== 0) {
        throw new ProjectRepositoryError('Replacement project must be new', 'write-failed');
      }
    }
    const database = await this.#open();
    let conflict: ProjectConflictError | null = null;
    let persistedReplacement: Project | null = null;
    try {
      const transaction = database.transaction([PROJECTS_STORE, WORKSPACE_STORE], 'readwrite');
      const completed = transactionDone(transaction);
      const projects = transaction.objectStore(PROJECTS_STORE);
      const allRequest = projects.getAll();
      allRequest.addEventListener('success', () => {
        const records = allRequest.result.map((raw) => decodeProject(raw));
        const existing = records.find((record) => record.ok && record.value.id === id)
          ?? decodeProject(undefined);
        const latest = existing.ok ? existing.value : null;
        if (latest?.revision !== expectedRevision) {
          conflict = new ProjectConflictError(`Project ${id} changed before deletion`, latest);
          transaction.abort();
          return;
        }
        const dependent = records.find((record) => record.ok
          && record.value.conflict?.sourceProjectId === id);
        if (dependent?.ok) {
          conflict = new ProjectConflictError(
            `Project ${id} has an unresolved conflict`,
            latest,
          );
          transaction.abort();
          return;
        }
        projects.delete(id);
        if (replacement) {
          persistedReplacement = { ...replacement, revision: 1 };
          projects.put(persistedReplacement);
        }
        transaction.objectStore(WORKSPACE_STORE).put({ key: ACTIVE_PROJECT_KEY, value: activeProjectId });
      }, { once: true });
      await completed;
    } catch (cause) {
      if (conflict) throw conflict;
      throw new ProjectRepositoryError('The project could not be deleted', 'write-failed', { cause });
    }
    return persistedReplacement;
  }

  async resolveConflict(input: ResolveProjectConflictInput): Promise<void> {
    if (!input.conflictProjectId || !input.sourceProjectId
        || input.conflictProjectId === input.sourceProjectId
        || !Number.isInteger(input.expectedConflictRevision)
        || !Number.isInteger(input.expectedSourceRevision)
        || !Number.isFinite(input.resolvedAt)
        || !['keep-source', 'keep-conflict', 'keep-both'].includes(input.resolution)) {
      throw new ProjectRepositoryError('Conflict resolution input is invalid', 'write-failed');
    }
    const database = await this.#open();
    let conflictError: ProjectConflictError | null = null;
    try {
      const transaction = database.transaction([PROJECTS_STORE, WORKSPACE_STORE], 'readwrite');
      const completed = transactionDone(transaction);
      const projects = transaction.objectStore(PROJECTS_STORE);
      const conflictRequest = projects.get(input.conflictProjectId);
      const sourceRequest = projects.get(input.sourceProjectId);
      let requestsCompleted = 0;
      const resolve = () => {
        requestsCompleted += 1;
        if (requestsCompleted !== 2) return;
        const conflict = decodeProject(conflictRequest.result);
        const source = decodeProject(sourceRequest.result);
        const currentConflict = conflict.ok ? conflict.value : null;
        const currentSource = source.ok ? source.value : null;
        const matches = currentConflict?.revision === input.expectedConflictRevision
          && currentConflict.conflict?.sourceProjectId === input.sourceProjectId
          && currentSource?.revision === input.expectedSourceRevision;
        if (!matches) {
          const latest = currentConflict?.revision !== input.expectedConflictRevision
            ? currentConflict : currentSource;
          conflictError = new ProjectConflictError(
            'The conflict pair changed before it could be resolved',
            latest,
          );
          transaction.abort();
          return;
        }

        if (input.resolution === 'keep-source') {
          projects.delete(currentConflict.id);
          transaction.objectStore(WORKSPACE_STORE).put({
            key: ACTIVE_PROJECT_KEY,
            value: currentSource.id,
          });
          return;
        }

        if (input.resolution === 'keep-conflict') {
          const promoted: Project = {
            ...currentSource,
            revision: currentSource.revision + 1,
            name: currentConflict.name.replace(/ \(conflict copy\)$/u, ''),
            design: currentConflict.design,
            updatedAt: Math.max(input.resolvedAt, currentSource.updatedAt),
          };
          projects.put(promoted);
          projects.delete(currentConflict.id);
          transaction.objectStore(WORKSPACE_STORE).put({
            key: ACTIVE_PROJECT_KEY,
            value: promoted.id,
          });
          return;
        }

        const independent: Project = {
          ...currentConflict,
          revision: currentConflict.revision + 1,
          name: currentConflict.name.replace(/ \(conflict copy\)$/u, ''),
          updatedAt: Math.max(input.resolvedAt, currentConflict.updatedAt),
          conflict: null,
        };
        projects.put(independent);
        transaction.objectStore(WORKSPACE_STORE).put({
          key: ACTIVE_PROJECT_KEY,
          value: independent.id,
        });
      };
      conflictRequest.addEventListener('success', resolve, { once: true });
      sourceRequest.addEventListener('success', resolve, { once: true });
      await completed;
    } catch (cause) {
      if (conflictError) throw conflictError;
      throw new ProjectRepositoryError('The project conflict could not be resolved', 'write-failed', {
        cause,
      });
    }
  }

  close(): void {
    if (!this.#database) return;
    void this.#database.then((database) => database.close());
    this.#database = null;
  }

  #open(): Promise<IDBDatabase> {
    if (!this.#factory) {
      return Promise.reject(new ProjectRepositoryError(
        'IndexedDB is unavailable in this browser',
        'unavailable',
      ));
    }
    if (this.#database) return this.#database;
    this.#database = new Promise((resolve, reject) => {
      const request = this.#factory!.open(this.#databaseName, DATABASE_VERSION);
      let settled = false;
      let migrationFailure: unknown;
      let migrationFrom = 0;
      const fail = (error: ProjectRepositoryError) => {
        if (settled) return;
        settled = true;
        reject(error);
      };
      request.addEventListener('upgradeneeded', (event) => {
        migrationFrom = event.oldVersion;
        try {
          migrateDatabase(request.result, request.transaction!, event.oldVersion);
        } catch (cause) {
          migrationFailure = cause;
          request.transaction?.abort();
        }
      });
      request.addEventListener('success', () => {
        const database = request.result;
        database.addEventListener('versionchange', () => database.close());
        if (settled) {
          database.close();
          return;
        }
        void verifyDatabaseSchema(database).then(() => {
          if (settled) {
            database.close();
            return;
          }
          settled = true;
          resolve(database);
        }, (cause: unknown) => {
          database.close();
          fail(new ProjectRepositoryError(
            'The project database schema is incompatible',
            'schema-mismatch',
            { cause },
          ));
        });
      }, { once: true });
      request.addEventListener('error', () => fail(new ProjectRepositoryError(
        migrationFailure
          ? `The project database migration from version ${migrationFrom} failed`
          : request.error?.name === 'VersionError'
            ? 'The project database was created by a newer incompatible version'
            : 'The project database could not be opened',
        migrationFailure ? 'migration-failed'
          : request.error?.name === 'VersionError' ? 'schema-mismatch' : 'unavailable',
        { cause: migrationFailure ?? request.error },
      )), { once: true });
      request.addEventListener('blocked', () => fail(new ProjectRepositoryError(
        'The project database upgrade is blocked; close other seemoji tabs and retry',
        'upgrade-blocked',
      )), { once: true });
    });
    return this.#database;
  }
}
