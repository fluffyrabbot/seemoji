import type {
  ExperimentAttribution,
  ProductEvent,
  ProductEventEnvelope,
  ProductEventSink,
  TrackableProductEvent,
} from '../ports/productEvents';
import type {
  ExperimentState,
  ExperimentStateStore,
  StoredExperimentAssignment,
} from '../ports/experimentState';
import { assignExperiment, type ExperimentAssignment } from './assignment';
import type {
  ExperimentDefinition,
  ExperimentVariant,
} from './definitions';

export type ExperimentRegistry = Readonly<Record<string, ExperimentDefinition>>;

export type RuntimeAssignment<
  Registry extends ExperimentRegistry,
  Name extends keyof Registry,
> = ExperimentAssignment<ExperimentVariant<Registry[Name]>>;

export interface ExperimentRuntimeOptions<Registry extends ExperimentRegistry> {
  readonly definitions: Registry;
  readonly stateStore: ExperimentStateStore;
  readonly eventSink: ProductEventSink;
  readonly createId?: () => string;
  readonly now?: () => number;
  /** Changes only new enrollment; persisted included assignments stay sticky. */
  readonly enrollmentBasisPointOverrides?: Partial<Record<keyof Registry, number>>;
  /** Operational kill path: force control without deleting sticky assignments. */
  readonly forceControlOverrides?: Partial<Record<keyof Registry, boolean>>;
}

const fallbackId = (): string =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

const defaultId = (): string => {
  try {
    return globalThis.crypto?.randomUUID?.() ?? fallbackId();
  } catch {
    return fallbackId();
  }
};

const sameStoredExperiment = (
  stored: StoredExperimentAssignment,
  definition: ExperimentDefinition,
): boolean => stored.experimentKey === definition.key
  && stored.experimentVersion === definition.version
  && definition.variants.includes(stored.variant);

const freezeAttribution = (
  assignment: { readonly experimentKey: string; readonly experimentVersion: number; readonly variant: string },
): ExperimentAttribution => Object.freeze({
  experimentKey: assignment.experimentKey,
  experimentVersion: assignment.experimentVersion,
  variant: assignment.variant,
});

export class ExperimentRuntime<Registry extends ExperimentRegistry> {
  readonly #definitions: Registry;
  readonly #stateStore: ExperimentStateStore;
  readonly #eventSink: ProductEventSink;
  readonly #createId: () => string;
  readonly #now: () => number;
  readonly #lifecycleDate: string | null;
  readonly #installationId: string;
  readonly #pageViewId: string;
  readonly #identityDurable: boolean;
  readonly #assignments = new Map<keyof Registry, ExperimentAssignment>();
  readonly #exposures = new Map<keyof Registry, ExperimentAttribution>();
  readonly #capturedOnce = new Set<TrackableProductEvent['name']>();
  readonly #forceControl = new Set<keyof Registry>();
  #pageSequence = 0;

  constructor(options: ExperimentRuntimeOptions<Registry>) {
    this.#definitions = options.definitions;
    this.#stateStore = options.stateStore;
    this.#eventSink = options.eventSink;
    this.#createId = options.createId ?? defaultId;
    this.#now = options.now ?? Date.now;
    try {
      this.#lifecycleDate = new Date(this.#now()).toISOString().slice(0, 10);
    } catch {
      this.#lifecycleDate = null;
    }
    this.#pageViewId = this.#startupId('page view');

    let storedState: ExperimentState | null = null;
    try {
      storedState = this.#stateStore.read();
    } catch {
      // Experiment infrastructure must never prevent the editor from starting.
    }
    this.#installationId = storedState?.installationId.trim()
      ? storedState.installationId
      : this.#startupId('installation');

    const retained: StoredExperimentAssignment[] = [];
    for (const name of Object.keys(this.#definitions) as (keyof Registry)[]) {
      const definition = this.#definitions[name];
      if (!definition) throw new Error(`Unknown experiment definition: ${String(name)}`);
      if (options.forceControlOverrides?.[name] === true) this.#forceControl.add(name);
      const stored = storedState?.assignments.find((candidate) =>
        sameStoredExperiment(candidate, definition));
      if (stored) {
        const computed = assignExperiment(definition, this.#installationId, 10_000);
        const assignment = Object.freeze({
          kind: 'included' as const,
          experimentKey: definition.key,
          experimentVersion: definition.version,
          variant: stored.variant,
          inclusionBucket: computed.inclusionBucket,
          variantBucket: computed.kind === 'included' ? computed.variantBucket : 0,
        });
        this.#assignments.set(name, assignment);
        retained.push(stored);
        continue;
      }

      const override = options.enrollmentBasisPointOverrides?.[name];
      const enrollment = this.#isActive(definition) ? override : 0;
      const assignment = assignExperiment(definition, this.#installationId, enrollment);
      this.#assignments.set(name, assignment);
      if (assignment.kind === 'included') {
        retained.push(Object.freeze({
          experimentKey: definition.key,
          experimentVersion: definition.version,
          variant: assignment.variant,
        }));
      }
    }

    let identityDurable = false;
    try {
      identityDurable = this.#stateStore.write(Object.freeze({
        installationId: this.#installationId,
        assignments: Object.freeze(retained),
      }));
    } catch {
      // The runtime forces control and suppresses collection without durable identity.
    }
    this.#identityDurable = identityDurable;
  }

  get installationId(): string {
    return this.#installationId;
  }

  assignmentFor<Name extends keyof Registry>(name: Name): RuntimeAssignment<Registry, Name> {
    const assignment = this.#assignments.get(name);
    if (!assignment) throw new Error(`Unknown experiment: ${String(name)}`);
    return assignment as RuntimeAssignment<Registry, Name>;
  }

  variantFor<Name extends keyof Registry>(name: Name): ExperimentVariant<Registry[Name]> {
    const definition = this.#definitions[name];
    if (!definition) throw new Error(`Unknown experiment: ${String(name)}`);
    if (
      !this.#identityDurable
      || !this.#isActive(definition)
      || this.#forceControl.has(name)
    ) return definition.control as ExperimentVariant<Registry[Name]>;
    const assignment = this.assignmentFor(name);
    return (assignment.kind === 'included'
      ? assignment.variant
      : definition.control) as ExperimentVariant<Registry[Name]>;
  }

  /** Records at most one exposure per experiment for this page view. */
  expose<Name extends keyof Registry>(name: Name): void {
    if (this.#exposures.has(name)) return;
    const definition = this.#definitions[name];
    if (
      !definition
      || !this.#identityDurable
      || !this.#isActive(definition)
      || this.#forceControl.has(name)
    ) return;
    const assignment = this.assignmentFor(name);
    if (assignment.kind === 'excluded') return;
    const attribution = freezeAttribution(assignment);
    const accepted = this.#capture({
      name: 'experiment_exposed',
      properties: attribution,
    }, [attribution]);
    if (accepted) this.#exposures.set(name, attribution);
  }

  capture(event: TrackableProductEvent): void {
    if (!this.#identityDurable) return;
    this.#capture(event, [...this.#exposures.values()]);
  }

  captureOnce(event: TrackableProductEvent): boolean {
    if (!this.#identityDurable) return false;
    if (this.#capturedOnce.has(event.name)) return true;
    const accepted = this.#capture(event, [...this.#exposures.values()]);
    if (accepted) this.#capturedOnce.add(event.name);
    return accepted;
  }

  #capture(event: ProductEvent, experiments: readonly ExperimentAttribution[]): boolean {
    try {
      const envelope: ProductEventEnvelope = Object.freeze({
        schemaVersion: 1,
        eventId: this.#requiredId('event'),
        occurredAt: this.#now(),
        pageSequence: ++this.#pageSequence,
        installationId: this.#installationId,
        pageViewId: this.#pageViewId,
        event: Object.freeze(event),
        experiments: Object.freeze([...experiments]),
      });
      return this.#eventSink.capture(envelope) === true;
    } catch {
      // Product telemetry is best-effort and cannot break editing or export.
      return false;
    }
  }

  #requiredId(kind: string): string {
    const id = this.#createId();
    if (!id.trim()) throw new Error(`Generated ${kind} identity is empty`);
    return id;
  }

  #startupId(kind: string): string {
    try {
      return this.#requiredId(kind);
    } catch {
      // Invalid injected or platform identity sources must not prevent startup.
      return fallbackId();
    }
  }

  #isActive(definition: ExperimentDefinition): boolean {
    return this.#lifecycleDate !== null
      && definition.status !== 'paused'
      && definition.startsOn <= this.#lifecycleDate
      && this.#lifecycleDate <= definition.expiresOn;
  }
}
