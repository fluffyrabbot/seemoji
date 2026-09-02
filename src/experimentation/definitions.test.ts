import { describe, expect, it } from 'vitest';
import {
  defineExperiment,
  defineExperimentRegistry,
  EXPERIMENTS,
  EXPORT_BAR_AA,
} from './definitions';

describe('experiment definitions', () => {
  it('freezes the versioned definition and its allocation data', () => {
    expect(Object.isFrozen(EXPORT_BAR_AA)).toBe(true);
    expect(Object.isFrozen(EXPORT_BAR_AA.variants)).toBe(true);
    expect(Object.isFrozen(EXPORT_BAR_AA.weights)).toBe(true);
    expect(Object.isFrozen(EXPORT_BAR_AA.primaryMetric)).toBe(true);
    expect(Object.isFrozen(EXPORT_BAR_AA.primaryMetric.properties)).toBe(true);
    expect(Object.isFrozen(EXPORT_BAR_AA.guardrails)).toBe(true);
  });

  it('rejects incomplete or non-normalized variant weights', () => {
    expect(() => defineExperiment({
      key: 'broken-test',
      version: 1,
      status: 'aa',
      owner: 'test',
      variants: ['control', 'treatment'] as const,
      control: 'control',
      allocationBasisPoints: 10_000,
      weights: { control: 10_000, treatment: 1 },
      hypothesis: 'invalid',
      primaryMetric: EXPORT_BAR_AA.primaryMetric,
      guardrails: [],
      startsOn: '2026-08-30',
      expiresOn: '2026-10-15',
    })).toThrow(/must total 10000/);
  });

  it('rejects impossible lifecycle dates and duplicate external keys', () => {
    expect(() => defineExperiment({
      ...EXPORT_BAR_AA,
      startsOn: '2026-02-29',
    })).toThrow(/valid ISO lifecycle dates/);
    expect(() => defineExperimentRegistry({
      first: EXPORT_BAR_AA,
      second: defineExperiment({ ...EXPORT_BAR_AA, version: 2 }),
    })).toThrow(/duplicate external keys/);
  });

  it('forces every live experiment to be reviewed before its expiry', () => {
    for (const definition of Object.values(EXPERIMENTS)) {
      if (definition.status === 'paused') continue;
      expect(Date.parse(`${definition.expiresOn}T23:59:59Z`)).toBeGreaterThan(Date.now());
    }
  });
});
