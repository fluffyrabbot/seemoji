export interface StoredExperimentAssignment {
  readonly experimentKey: string;
  readonly experimentVersion: number;
  readonly variant: string;
}

export interface ExperimentState {
  readonly installationId: string;
  readonly assignments: readonly StoredExperimentAssignment[];
}

/** Device-local persistence for anonymous experiment identity and sticky assignments. */
export interface ExperimentStateStore {
  read(): ExperimentState | null;
  /** Returns true only when the state was durably accepted. */
  write(state: ExperimentState): boolean;
}
