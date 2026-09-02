import type { TrackableProductEvent } from '../ports/productEvents';

export const BASIS_POINTS = 10_000;
const IDENTIFIER = /^[a-z][a-z0-9-]*$/;

export type ExperimentStatus = 'aa' | 'running' | 'paused';

export type ExperimentMetric = {
  readonly [Name in TrackableProductEvent['name']]: {
    readonly event: Name;
    readonly unit: 'installation';
    readonly aggregation: 'unique-installation-conversion';
    readonly attributionWindow: 'same-page-after-exposure';
    readonly properties: Partial<Extract<
      TrackableProductEvent,
      { readonly name: Name }
    >['properties']>;
  };
}[TrackableProductEvent['name']];

export interface ExperimentDefinition<
  Variants extends readonly [string, ...string[]] = readonly [string, ...string[]],
> {
  readonly key: string;
  readonly version: number;
  readonly status: ExperimentStatus;
  readonly owner: string;
  readonly variants: Variants;
  readonly control: Variants[number];
  readonly allocationBasisPoints: number;
  readonly weights: Readonly<Record<Variants[number], number>>;
  readonly hypothesis: string;
  readonly primaryMetric: ExperimentMetric;
  readonly guardrails: readonly ExperimentMetric[];
  readonly startsOn: string;
  readonly expiresOn: string;
}

export type ExperimentVariant<Definition> = Definition extends ExperimentDefinition<infer Variants>
  ? Variants[number]
  : never;

const isIsoDate = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
};

const freezeMetric = <Metric extends ExperimentMetric>(metric: Metric): Metric => Object.freeze({
  ...metric,
  properties: Object.freeze({ ...metric.properties }),
}) as Metric;

export function defineExperiment<const Variants extends readonly [string, ...string[]]>(
  input: ExperimentDefinition<Variants>,
): ExperimentDefinition<Variants> {
  if (!IDENTIFIER.test(input.key)) {
    throw new Error(`Experiment key is invalid: ${input.key}`);
  }
  if (!Number.isSafeInteger(input.version) || input.version < 1) {
    throw new Error(`Experiment ${input.key} must have a positive integer version`);
  }
  if (!['aa', 'running', 'paused'].includes(input.status)) {
    throw new Error(`Experiment ${input.key} has an invalid status`);
  }
  if (!input.owner.trim()) throw new Error(`Experiment ${input.key} must have an owner`);
  if (
    !Number.isSafeInteger(input.allocationBasisPoints)
    || input.allocationBasisPoints < 0
    || input.allocationBasisPoints > BASIS_POINTS
  ) {
    throw new Error(`Experiment ${input.key} has an invalid allocation`);
  }
  if (new Set(input.variants).size !== input.variants.length) {
    throw new Error(`Experiment ${input.key} contains duplicate variants`);
  }
  if (input.variants.some((variant) => !IDENTIFIER.test(variant))) {
    throw new Error(`Experiment ${input.key} contains an invalid variant`);
  }
  if (!input.variants.includes(input.control)) {
    throw new Error(`Experiment ${input.key} control is not a declared variant`);
  }
  const weightKeys = Object.keys(input.weights);
  if (
    weightKeys.length !== input.variants.length
    || weightKeys.some((variant) => !input.variants.includes(variant))
  ) {
    throw new Error(`Experiment ${input.key} weights do not match its variants`);
  }
  const totalWeight = input.variants.reduce((total, variant) => {
    const weight = input.weights[variant as Variants[number]];
    if (!Number.isSafeInteger(weight) || weight < 0) {
      throw new Error(`Experiment ${input.key} has an invalid weight for ${variant}`);
    }
    return total + weight;
  }, 0);
  if (totalWeight !== BASIS_POINTS) {
    throw new Error(`Experiment ${input.key} variant weights must total ${BASIS_POINTS}`);
  }
  if (!input.hypothesis.trim()) {
    throw new Error(`Experiment ${input.key} must have a hypothesis`);
  }
  if (!isIsoDate(input.startsOn) || !isIsoDate(input.expiresOn)) {
    throw new Error(`Experiment ${input.key} must have valid ISO lifecycle dates`);
  }
  if (input.startsOn > input.expiresOn) {
    throw new Error(`Experiment ${input.key} starts after it expires`);
  }

  return Object.freeze({
    ...input,
    variants: Object.freeze([...input.variants]) as unknown as Variants,
    weights: Object.freeze({ ...input.weights }),
    primaryMetric: freezeMetric(input.primaryMetric),
    guardrails: Object.freeze(input.guardrails.map(freezeMetric)),
  });
}

export function defineExperimentRegistry<
  const Registry extends Readonly<Record<string, ExperimentDefinition>>,
>(registry: Registry): Registry {
  const keys = Object.values(registry).map((definition) => definition.key);
  if (new Set(keys).size !== keys.length) {
    throw new Error('Experiment registry contains duplicate external keys');
  }
  return Object.freeze({ ...registry });
}

/**
 * Identical UI branches used to validate assignment, exposure, and telemetry
 * before a treatment is allowed to change user-visible behavior.
 */
export const EXPORT_BAR_AA = defineExperiment({
  key: 'export-bar-aa',
  version: 1,
  status: 'aa',
  owner: 'product',
  variants: ['control-a', 'control-b'] as const,
  control: 'control-a',
  allocationBasisPoints: BASIS_POINTS,
  weights: {
    'control-a': 5_000,
    'control-b': 5_000,
  },
  hypothesis: 'The experiment pipeline produces balanced, deduplicated observations.',
  primaryMetric: {
    event: 'asset_delivery_succeeded',
    unit: 'installation',
    aggregation: 'unique-installation-conversion',
    attributionWindow: 'same-page-after-exposure',
    properties: { method: 'clipboard' },
  },
  guardrails: [{
    event: 'asset_delivery_failed',
    unit: 'installation',
    aggregation: 'unique-installation-conversion',
    attributionWindow: 'same-page-after-exposure',
    properties: {},
  }],
  startsOn: '2026-08-30',
  expiresOn: '2026-10-15',
});

export const EXPERIMENTS = defineExperimentRegistry({
  exportBarAa: EXPORT_BAR_AA,
});

export type ExperimentName = keyof typeof EXPERIMENTS;
export type VariantFor<Name extends ExperimentName> = ExperimentVariant<(typeof EXPERIMENTS)[Name]>;
