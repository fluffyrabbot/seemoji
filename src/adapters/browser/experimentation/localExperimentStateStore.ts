import type {
  ExperimentState,
  ExperimentStateStore,
  StoredExperimentAssignment,
} from '../../../ports/experimentState';

export const EXPERIMENT_STATE_KEY = 'seemoji:experiments:v1';
const STATE_VERSION = 1;
const MAX_ASSIGNMENTS = 32;

interface StoredEnvelope {
  readonly version: typeof STATE_VERSION;
  readonly installationId: string;
  readonly assignments: readonly StoredExperimentAssignment[];
}

const isAssignment = (value: unknown): value is StoredExperimentAssignment => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const assignment = value as Record<string, unknown>;
  return typeof assignment.experimentKey === 'string'
    && /^[a-z][a-z0-9-]*$/.test(assignment.experimentKey)
    && Number.isSafeInteger(assignment.experimentVersion)
    && Number(assignment.experimentVersion) > 0
    && typeof assignment.variant === 'string'
    && /^[a-z][a-z0-9-]*$/.test(assignment.variant);
};

const decodeEnvelope = (value: unknown): ExperimentState | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const envelope = value as Record<string, unknown>;
  if (
    envelope.version !== STATE_VERSION
    || typeof envelope.installationId !== 'string'
    || envelope.installationId.length === 0
    || envelope.installationId.length > 200
    || !Array.isArray(envelope.assignments)
    || envelope.assignments.length > MAX_ASSIGNMENTS
    || !envelope.assignments.every(isAssignment)
  ) return null;
  return Object.freeze({
    installationId: envelope.installationId,
    assignments: Object.freeze([...envelope.assignments]),
  });
};

export class LocalExperimentStateStore implements ExperimentStateStore {
  readonly #storage: Storage | null;

  constructor(storage?: Storage | null) {
    if (storage !== undefined) {
      this.#storage = storage;
      return;
    }
    try {
      this.#storage = globalThis.localStorage ?? null;
    } catch {
      this.#storage = null;
    }
  }

  read(): ExperimentState | null {
    try {
      const encoded = this.#storage?.getItem(EXPERIMENT_STATE_KEY);
      return encoded ? decodeEnvelope(JSON.parse(encoded) as unknown) : null;
    } catch {
      return null;
    }
  }

  write(state: ExperimentState): boolean {
    if (!this.#storage) return false;
    if (
      state.installationId.length === 0
      || state.installationId.length > 200
      || state.assignments.length > MAX_ASSIGNMENTS
      || !state.assignments.every(isAssignment)
    ) return false;
    const envelope: StoredEnvelope = {
      version: STATE_VERSION,
      installationId: state.installationId,
      assignments: state.assignments,
    };
    try {
      this.#storage.setItem(EXPERIMENT_STATE_KEY, JSON.stringify(envelope));
      return true;
    } catch {
      // The runtime will force control and suppress collection without durable identity.
      return false;
    }
  }
}
