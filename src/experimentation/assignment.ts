import {
  BASIS_POINTS,
  type ExperimentDefinition,
  type ExperimentVariant,
} from './definitions';

export interface IncludedExperimentAssignment<Variant extends string = string> {
  readonly kind: 'included';
  readonly experimentKey: string;
  readonly experimentVersion: number;
  readonly variant: Variant;
  readonly inclusionBucket: number;
  readonly variantBucket: number;
}

export interface ExcludedExperimentAssignment {
  readonly kind: 'excluded';
  readonly experimentKey: string;
  readonly experimentVersion: number;
  readonly inclusionBucket: number;
}

export type ExperimentAssignment<Variant extends string = string> =
  | IncludedExperimentAssignment<Variant>
  | ExcludedExperimentAssignment;

/** Stable FNV-1a over UTF-16 code units. Experiment keys and generated IDs are ASCII. */
export function stableHash(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    hash ^= code & 0xff;
    hash = Math.imul(hash, 0x01000193);
    hash ^= code >>> 8;
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export const bucketFor = (value: string): number => stableHash(value) % BASIS_POINTS;

export function assignExperiment<Definition extends ExperimentDefinition>(
  definition: Definition,
  installationId: string,
  allocationBasisPoints = definition.allocationBasisPoints,
): ExperimentAssignment<ExperimentVariant<Definition>> {
  if (
    !Number.isSafeInteger(allocationBasisPoints)
    || allocationBasisPoints < 0
    || allocationBasisPoints > BASIS_POINTS
  ) {
    throw new Error(`Experiment ${definition.key} has an invalid runtime allocation`);
  }
  if (installationId.length === 0) throw new Error('Experiment installation identity is empty');

  const identity = `${definition.key}@${definition.version}:${installationId}`;
  const inclusionBucket = bucketFor(`include:${identity}`);
  if (inclusionBucket >= allocationBasisPoints) {
    return Object.freeze({
      kind: 'excluded',
      experimentKey: definition.key,
      experimentVersion: definition.version,
      inclusionBucket,
    });
  }

  const variantBucket = bucketFor(`variant:${identity}`);
  let upperBound = 0;
  for (const variant of definition.variants) {
    const weight = definition.weights[variant];
    if (weight === undefined) {
      throw new Error(`Experiment ${definition.key} has no weight for ${variant}`);
    }
    upperBound += weight;
    if (variantBucket < upperBound) {
      return Object.freeze({
        kind: 'included',
        experimentKey: definition.key,
        experimentVersion: definition.version,
        variant: variant as ExperimentVariant<Definition>,
        inclusionBucket,
        variantBucket,
      });
    }
  }
  throw new Error(`Experiment ${definition.key} has no variant for bucket ${variantBucket}`);
}
