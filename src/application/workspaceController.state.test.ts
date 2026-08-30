import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { IndexedDbProjectRepository } from '../adapters/browser/indexedDbProjectRepository';
import { DEFAULT_DESIGN } from '../domain/design';
import { createProject, type Project } from '../domain/project';
import type { WorkspaceChange, WorkspaceSync } from '../ports/workspaceSync';
import {
  WorkspaceController,
  type WorkspaceScheduler,
} from './workspaceController';

const DEFAULT_STEPS = 36;
const REGRESSION_SEEDS = [0x10ca_1f01, 0x51a7_e001, 0xa11c_e002, 0xc011_ab1e];
const environment = (globalThis as typeof globalThis & {
  readonly process?: { readonly env?: Readonly<Record<string, string | undefined>> };
}).process?.env ?? {};
const configuredSeed = environment.SEEMOJI_CONTROLLER_SEED;
const seedCount = Number(environment.SEEMOJI_CONTROLLER_SEEDS ?? 6);
const steps = Number(environment.SEEMOJI_CONTROLLER_STEPS ?? DEFAULT_STEPS);
const seeds = configuredSeed === undefined
  ? Array.from({ length: seedCount }, (_, index) =>
    REGRESSION_SEEDS[index] ?? (0x6d2b_79f5 * (index + 1)) >>> 0)
  : [Number(configuredSeed) >>> 0];

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

interface ScheduledTask {
  readonly id: number;
  readonly callback: () => void;
  readonly kind: 'timer' | 'deferred';
}

class DeterministicScheduler implements WorkspaceScheduler {
  readonly #tasks = new Map<number, ScheduledTask>();
  #identity = 0;

  schedule(callback: () => void): unknown {
    const task = { id: ++this.#identity, callback, kind: 'timer' as const };
    this.#tasks.set(task.id, task);
    return task.id;
  }

  cancel(handle: unknown): void {
    if (typeof handle === 'number') this.#tasks.delete(handle);
  }

  defer(callback: () => void): void {
    const task = { id: ++this.#identity, callback, kind: 'deferred' as const };
    this.#tasks.set(task.id, task);
  }

  get size(): number {
    return this.#tasks.size;
  }

  runTimer(random: Generator): void {
    const timers = [...this.#tasks.values()].filter(({ kind }) => kind === 'timer');
    const task = random.pick(timers);
    this.#tasks.delete(task.id);
    task.callback();
  }

  runAll(random: Generator): void {
    while (this.#tasks.size > 0) {
      const task = random.pick([...this.#tasks.values()]);
      this.#tasks.delete(task.id);
      task.callback();
    }
  }
}

interface QueuedMessage {
  readonly target: SyncEndpoint;
  readonly change: WorkspaceChange;
}

class ReorderableSyncHub {
  readonly #endpoints = new Set<SyncEndpoint>();
  readonly #messages: QueuedMessage[] = [];

  connect(): SyncEndpoint {
    const endpoint = new SyncEndpoint(this);
    this.#endpoints.add(endpoint);
    return endpoint;
  }

  publish(sender: SyncEndpoint, change: WorkspaceChange): void {
    for (const target of this.#endpoints) {
      if (target !== sender && !target.closed) this.#messages.push({ target, change });
    }
  }

  invalidateAll(): void {
    for (const target of this.#endpoints) {
      if (!target.closed) this.#messages.push({ target, change: { projectIds: ['model-checkpoint'] } });
    }
  }

  close(endpoint: SyncEndpoint): void {
    this.#endpoints.delete(endpoint);
  }

  get size(): number {
    return this.#messages.length;
  }

  duplicate(random: Generator): void {
    if (this.#messages.length === 0) return;
    const message = random.pick(this.#messages);
    this.#messages.push({ target: message.target, change: message.change });
  }

  drop(random: Generator): void {
    if (this.#messages.length === 0) return;
    this.#messages.splice(random.integer(this.#messages.length), 1);
  }

  deliverAll(random: Generator): void {
    while (this.#messages.length > 0) {
      const index = random.integer(this.#messages.length);
      const [message] = this.#messages.splice(index, 1);
      message?.target.deliver(message.change);
    }
  }
}

class SyncEndpoint implements WorkspaceSync {
  readonly #hub: ReorderableSyncHub;
  readonly #listeners = new Set<(change: WorkspaceChange) => void>();
  closed = false;

  constructor(hub: ReorderableSyncHub) {
    this.#hub = hub;
  }

  publish(change: WorkspaceChange): void {
    if (!this.closed) this.#hub.publish(this, change);
  }

  subscribe(listener: (change: WorkspaceChange) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  deliver(change: WorkspaceChange): void {
    if (this.closed) return;
    for (const listener of this.#listeners) listener(change);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.#listeners.clear();
    this.#hub.close(this);
  }
}

class IdSource {
  readonly #prefix: string;
  #value = 0;

  constructor(prefix: string) {
    this.#prefix = prefix;
  }

  readonly next = (): string => `${this.#prefix}-${++this.#value}`;

  peek(): string {
    return `${this.#prefix}-${this.#value + 1}`;
  }

  latest(): string {
    return `${this.#prefix}-${this.#value}`;
  }
}

interface ControllerSlot {
  readonly key: 'first' | 'second';
  readonly clock: number;
  readonly ids: IdSource;
  repository: IndexedDbProjectRepository;
  sync: SyncEndpoint;
  controller: WorkspaceController;
}

type Operation = readonly [name: string, run: () => Promise<readonly string[]>];

class ControllerStateMachine {
  readonly #factory = new IDBFactory();
  readonly #databaseName: string;
  readonly #random: Generator;
  readonly #scheduler = new DeterministicScheduler();
  readonly #hub = new ReorderableSyncHub();
  readonly #projects = new Map<string, Project>();
  readonly #trace: string[] = [];
  readonly #inspector: IndexedDbProjectRepository;
  readonly #first: ControllerSlot;
  readonly #second: ControllerSlot;
  #activeProjectId: string | null = null;
  #token = 0;

  private constructor(seed: number) {
    this.#databaseName = `controller-state-${seed.toString(16)}`;
    this.#random = new Generator(seed);
    this.#inspector = new IndexedDbProjectRepository(this.#factory, this.#databaseName);
    this.#first = this.#createSlot('first', 100, new IdSource('first'));
    this.#second = this.#createSlot('second', 200, new IdSource('second'));
  }

  static async create(seed: number): Promise<ControllerStateMachine> {
    const machine = new ControllerStateMachine(seed);
    await machine.#first.controller.load();
    const initial = createProject({
      id: machine.#first.ids.latest(),
      revision: 1,
      name: 'Untitled design',
      design: DEFAULT_DESIGN,
      createdAt: machine.#first.clock,
    });
    machine.#projects.set(initial.id, initial);
    machine.#activeProjectId = initial.id;
    await machine.#second.controller.load();
    await machine.#chaosThenConverge();
    await machine.#assertState('bootstrap', []);
    return machine;
  }

  async run(sequenceLength: number): Promise<void> {
    const mandatory: readonly Operation[] = [
      ['explicit-flush', () => this.#sequentialEdit(false)],
      ['timer-flush', () => this.#sequentialEdit(true)],
      ['concurrent-edits', () => this.#concurrentEdits()],
      ['pending-edit-remote-change', () => this.#pendingRemoteConflict()],
      ['resolve-conflict', () => this.#resolveConflict()],
      ['create-project', () => this.#createProject()],
      ['toggle-star', () => this.#toggleStar()],
      ['reload', () => this.#reload(this.#first)],
      ['dispose-with-pending-edit', () => this.#disposeWithPendingEdit(this.#second)],
      ['notification-chaos', () => this.#notificationChaos()],
    ];
    for (const operation of mandatory) await this.#step(operation);
    for (let index = 0; index < sequenceLength; index += 1) {
      await this.#step(this.#random.pick(this.#availableOperations()));
    }
  }

  close(): void {
    this.#first.controller.dispose();
    this.#second.controller.dispose();
    this.#first.repository.close();
    this.#second.repository.close();
    this.#inspector.close();
  }

  trace(): string {
    return this.#trace.slice(-14).join(' -> ');
  }

  #createSlot(key: ControllerSlot['key'], clock: number, ids: IdSource): ControllerSlot {
    const repository = new IndexedDbProjectRepository(this.#factory, this.#databaseName);
    const sync = this.#hub.connect();
    const controller = new WorkspaceController(repository, {
      clock: () => clock,
      createId: ids.next,
      debounceMilliseconds: 50,
      scheduler: this.#scheduler,
      sync,
    });
    return { key, clock, ids, repository, sync, controller };
  }

  async #step([name, run]: Operation): Promise<void> {
    this.#trace.push(name);
    const acceptedTokens = await run();
    await this.#chaosThenConverge();
    await this.#assertState(name, acceptedTokens);
  }

  #availableOperations(): readonly Operation[] {
    const operations: Operation[] = [
      ['explicit-flush', () => this.#sequentialEdit(false)],
      ['timer-flush', () => this.#sequentialEdit(true)],
      ['concurrent-edits', () => this.#concurrentEdits()],
      ['pending-edit-remote-change', () => this.#pendingRemoteConflict()],
      ['toggle-star', () => this.#toggleStar()],
      ['reload', () => this.#reload(this.#random.pick([this.#first, this.#second]))],
      ['dispose-with-pending-edit', () => this.#disposeWithPendingEdit(
        this.#random.pick([this.#first, this.#second]),
      )],
      ['notification-chaos', () => this.#notificationChaos()],
    ];
    if (this.#projects.size < 12) operations.push(['create-project', () => this.#createProject()]);
    if (this.#conflicts().length > 0) {
      operations.push(['resolve-conflict', () => this.#resolveConflict()]);
    }
    return operations;
  }

  async #sequentialEdit(timer: boolean): Promise<readonly string[]> {
    await this.#ensureOriginalActive();
    const slot = this.#random.pick([this.#first, this.#second]);
    const current = this.#projects.get(this.#activeProjectId!)!;
    const token = this.#nextToken(timer ? 'timer' : 'flush');
    slot.controller.updateActive(token, current.design);
    if (timer) {
      this.#scheduler.runTimer(this.#random);
      await slot.controller.flush();
    } else {
      await slot.controller.flush();
    }
    this.#projects.set(current.id, {
      ...current,
      revision: current.revision + 1,
      name: token,
      updatedAt: Math.max(slot.clock, current.createdAt),
    });
    return [token];
  }

  async #concurrentEdits(): Promise<readonly string[]> {
    await this.#ensureOriginalActive();
    const current = this.#projects.get(this.#activeProjectId!)!;
    const winner = this.#random.pick([this.#first, this.#second]);
    const loser = winner === this.#first ? this.#second : this.#first;
    const winnerToken = this.#nextToken(`${winner.key}-winner`);
    const loserToken = this.#nextToken(`${loser.key}-conflict`);
    winner.controller.updateActive(winnerToken, current.design);
    loser.controller.updateActive(loserToken, current.design);
    const conflictId = loser.ids.peek();
    await winner.controller.flush();
    await loser.controller.flush();

    const canonical: Project = {
      ...current,
      revision: current.revision + 1,
      name: winnerToken,
      updatedAt: Math.max(winner.clock, current.createdAt),
    };
    const conflict = createProject({
      id: conflictId,
      revision: 1,
      name: `${loserToken} (conflict copy)`,
      design: current.design,
      createdAt: loser.clock,
      updatedAt: loser.clock,
      conflict: {
        sourceProjectId: current.id,
        sourceRevision: current.revision,
        createdAt: loser.clock,
      },
    });
    this.#projects.set(canonical.id, canonical);
    this.#projects.set(conflict.id, conflict);
    this.#activeProjectId = conflict.id;
    return [winnerToken, loserToken];
  }

  async #pendingRemoteConflict(): Promise<readonly string[]> {
    await this.#ensureOriginalActive();
    const current = this.#projects.get(this.#activeProjectId!)!;
    const remote = this.#first;
    const pending = this.#second;
    const remoteToken = this.#nextToken('remote');
    const pendingToken = this.#nextToken('pending');
    remote.controller.updateActive(remoteToken, current.design);
    pending.controller.updateActive(pendingToken, current.design);
    const conflictId = pending.ids.peek();
    await remote.controller.flush();
    this.#hub.deliverAll(this.#random);
    await Promise.resolve();
    await pending.controller.flush();

    const canonical: Project = {
      ...current,
      revision: current.revision + 1,
      name: remoteToken,
      updatedAt: Math.max(remote.clock, current.createdAt),
    };
    const conflict = createProject({
      id: conflictId,
      revision: 1,
      name: `${pendingToken} (conflict copy)`,
      design: current.design,
      createdAt: pending.clock,
      updatedAt: pending.clock,
      conflict: {
        sourceProjectId: current.id,
        sourceRevision: current.revision,
        createdAt: pending.clock,
      },
    });
    this.#projects.set(canonical.id, canonical);
    this.#projects.set(conflict.id, conflict);
    this.#activeProjectId = conflict.id;
    return [remoteToken, pendingToken];
  }

  async #createProject(): Promise<readonly string[]> {
    const slot = this.#random.pick([this.#first, this.#second]);
    const token = this.#nextToken('created');
    const id = slot.ids.peek();
    await slot.controller.create(DEFAULT_DESIGN, token);
    const project = createProject({
      id,
      revision: 1,
      name: token,
      design: DEFAULT_DESIGN,
      createdAt: slot.clock,
    });
    this.#projects.set(id, project);
    this.#activeProjectId = id;
    return [token];
  }

  async #toggleStar(): Promise<readonly string[]> {
    const slot = this.#random.pick([this.#first, this.#second]);
    const current = this.#projects.get(this.#activeProjectId!)!;
    await slot.controller.toggleStar(current.id);
    this.#projects.set(current.id, {
      ...current,
      revision: current.revision + 1,
      starredAt: current.starredAt === null ? slot.clock : null,
    });
    return [];
  }

  async #resolveConflict(): Promise<readonly string[]> {
    const conflict = this.#random.pick(this.#conflicts());
    const source = this.#projects.get(conflict.conflict!.sourceProjectId)!;
    const slot = this.#random.pick([this.#first, this.#second]);
    const resolution = this.#random.pick(['keep-source', 'keep-conflict', 'keep-both'] as const);
    await slot.controller.resolveConflict(conflict.id, resolution);
    if (resolution === 'keep-source') {
      this.#projects.delete(conflict.id);
      this.#activeProjectId = source.id;
    } else if (resolution === 'keep-conflict') {
      this.#projects.set(source.id, {
        ...source,
        revision: source.revision + 1,
        name: conflict.name.replace(/ \(conflict copy\)$/u, ''),
        design: conflict.design,
        updatedAt: Math.max(slot.clock, source.updatedAt),
      });
      this.#projects.delete(conflict.id);
      this.#activeProjectId = source.id;
    } else {
      this.#projects.set(conflict.id, {
        ...conflict,
        revision: conflict.revision + 1,
        name: conflict.name.replace(/ \(conflict copy\)$/u, ''),
        updatedAt: Math.max(slot.clock, conflict.updatedAt),
        conflict: null,
      });
      this.#activeProjectId = conflict.id;
    }
    return [];
  }

  async #reload(slot: ControllerSlot): Promise<readonly string[]> {
    await slot.controller.flush();
    slot.controller.dispose();
    await slot.controller.flush();
    slot.repository.close();
    const replacement = this.#createSlot(slot.key, slot.clock, slot.ids);
    slot.repository = replacement.repository;
    slot.sync = replacement.sync;
    slot.controller = replacement.controller;
    await slot.controller.load();
    return [];
  }

  async #disposeWithPendingEdit(slot: ControllerSlot): Promise<readonly string[]> {
    await this.#ensureOriginalActive();
    const current = this.#projects.get(this.#activeProjectId!)!;
    const token = this.#nextToken('disposed');
    slot.controller.updateActive(token, current.design);
    slot.controller.dispose();
    await slot.controller.flush();
    this.#projects.set(current.id, {
      ...current,
      revision: current.revision + 1,
      name: token,
      updatedAt: Math.max(slot.clock, current.createdAt),
    });
    slot.repository.close();
    const replacement = this.#createSlot(slot.key, slot.clock, slot.ids);
    slot.repository = replacement.repository;
    slot.sync = replacement.sync;
    slot.controller = replacement.controller;
    await slot.controller.load();
    return [token];
  }

  async #notificationChaos(): Promise<readonly string[]> {
    this.#hub.invalidateAll();
    this.#hub.duplicate(this.#random);
    this.#hub.drop(this.#random);
    this.#hub.deliverAll(this.#random);
    await this.#settleControllers();
    return [];
  }

  async #ensureOriginalActive(): Promise<void> {
    const active = this.#projects.get(this.#activeProjectId!);
    if (active?.conflict === null) return;
    const original = [...this.#projects.values()].find((project) => project.conflict === null)!;
    await this.#first.controller.activate(original.id);
    this.#activeProjectId = original.id;
    await this.#chaosThenConverge();
  }

  async #chaosThenConverge(): Promise<void> {
    if (this.#hub.size > 0) {
      if (this.#random.integer(2) === 0) this.#hub.duplicate(this.#random);
      if (this.#random.integer(2) === 0) this.#hub.drop(this.#random);
      this.#hub.deliverAll(this.#random);
      await this.#settleControllers();
    }
    this.#hub.invalidateAll();
    this.#hub.duplicate(this.#random);
    if (this.#random.integer(3) === 0) this.#hub.drop(this.#random);
    this.#hub.deliverAll(this.#random);
    await this.#settleControllers();
    this.#hub.invalidateAll();
    this.#hub.deliverAll(this.#random);
    await this.#settleControllers();
  }

  async #settleControllers(): Promise<void> {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      this.#scheduler.runAll(this.#random);
      await Promise.all([
        this.#first.controller.flush(),
        this.#second.controller.flush(),
      ]);
      await Promise.resolve();
      if (this.#scheduler.size === 0) return;
    }
    throw new Error('Controller scheduler did not settle');
  }

  async #assertState(action: string, acceptedTokens: readonly string[]): Promise<void> {
    const persisted = await this.#inspector.load();
    const expectedProjects = this.#sorted([...this.#projects.values()]);
    expect(this.#sorted(persisted.projects), `repository projects after ${action}`)
      .toEqual(expectedProjects);
    expect(persisted.activeProjectId, `repository active project after ${action}`)
      .toBe(this.#activeProjectId);
    expect(persisted.issues).toEqual([]);

    for (const slot of [this.#first, this.#second]) {
      const snapshot = slot.controller.snapshot();
      expect(this.#sorted(snapshot.projects), `${slot.key} projects after ${action}`)
        .toEqual(expectedProjects);
      expect(snapshot.activeProject.id, `${slot.key} active project after ${action}`)
        .toBe(this.#activeProjectId);
      expect(snapshot.issues).toEqual([]);
      expect(slot.controller.persistenceStatus).not.toBe('error');
    }

    const durableNames = persisted.projects.map(({ name }) =>
      name.replace(/ \((?:conflict|recovered) copy\)$/u, ''));
    for (const token of acceptedTokens) {
      expect(durableNames, `accepted edit ${token} after ${action}`).toContain(token);
    }
    expect(this.#activeProjectId).not.toBeNull();
    expect(this.#projects.has(this.#activeProjectId!)).toBe(true);
    for (const project of this.#projects.values()) {
      if (project.conflict) {
        expect(this.#projects.has(project.conflict.sourceProjectId),
          `conflict source of ${project.id}`).toBe(true);
      }
    }
  }

  #sorted(projects: readonly Project[]): readonly Project[] {
    return [...projects].sort((left, right) => left.id.localeCompare(right.id));
  }

  #conflicts(): readonly Project[] {
    return [...this.#projects.values()].filter((project) => project.conflict !== null);
  }

  #nextToken(prefix: string): string {
    this.#token += 1;
    return `${prefix}-${this.#token}`;
  }
}

describe('WorkspaceController model-based state machine', () => {
  it.each(seeds)('converges every accepted edit for seed %s', async (seed) => {
    let machine: ControllerStateMachine | null = null;
    try {
      machine = await ControllerStateMachine.create(seed);
      await machine.run(steps);
    } catch (cause) {
      throw new Error(
        `Controller state-machine failure. Replay with SEEMOJI_CONTROLLER_SEED=${seed} `
        + `SEEMOJI_CONTROLLER_STEPS=${steps}. Recent actions: ${machine?.trace() ?? 'bootstrap'}`,
        { cause },
      );
    } finally {
      machine?.close();
    }
  }, 30_000);
});
