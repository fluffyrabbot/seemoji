import { describe, expect, it } from 'vitest';
import { assignExperiment, bucketFor, stableHash } from './assignment';
import { defineExperiment, EXPORT_BAR_AA } from './definitions';

describe('experiment assignment', () => {
  it('keeps stable hash and bucket golden values', () => {
    expect(stableHash('plain')).toBe(1_692_523_663);
    expect(bucketFor('include:export-bar-aa@1:device-123')).toBe(7_808);
    expect(bucketFor('variant:export-bar-aa@1:device-123')).toBe(4_347);
    expect(assignExperiment(EXPORT_BAR_AA, 'device-123')).toMatchObject({
      kind: 'included',
      variant: 'control-a',
      inclusionBucket: 7_808,
      variantBucket: 4_347,
    });
  });

  it('adds subjects without moving existing subjects between variants', () => {
    const existingId = Array.from({ length: 20_000 }, (_, index) => `existing-${index}`)
      .find((id) => {
        const assignment = assignExperiment(EXPORT_BAR_AA, id, 1_000);
        return assignment.kind === 'included';
      });
    const addedId = Array.from({ length: 20_000 }, (_, index) => `added-${index}`)
      .find((id) => {
        const assignment = assignExperiment(EXPORT_BAR_AA, id, 5_000);
        return assignment.kind === 'included' && assignment.inclusionBucket >= 1_000;
      });
    expect(existingId).toBeDefined();
    expect(addedId).toBeDefined();

    const before = assignExperiment(EXPORT_BAR_AA, existingId!, 1_000);
    const after = assignExperiment(EXPORT_BAR_AA, existingId!, 5_000);
    expect(before.kind).toBe('included');
    expect(after.kind).toBe('included');
    if (before.kind === 'included' && after.kind === 'included') {
      expect(after.variant).toBe(before.variant);
      expect(after.variantBucket).toBe(before.variantBucket);
    }
    expect(assignExperiment(EXPORT_BAR_AA, addedId!, 1_000).kind).toBe('excluded');
    expect(assignExperiment(EXPORT_BAR_AA, addedId!, 5_000).kind).toBe('included');
  });

  it('uses the declared version as part of independent randomization', () => {
    const nextVersion = defineExperiment({
      ...EXPORT_BAR_AA,
      version: 2,
      expiresOn: '2026-11-15',
    });
    const first = assignExperiment(EXPORT_BAR_AA, 'device-123');
    const second = assignExperiment(nextVersion, 'device-123');
    expect(second.inclusionBucket).not.toBe(first.inclusionBucket);
    if (first.kind === 'included' && second.kind === 'included') {
      expect(second.variantBucket).not.toBe(first.variantBucket);
    }
  });

  it('maintains the expected A/A distribution in a deterministic population', () => {
    const assignments = Array.from({ length: 10_000 }, (_, index) =>
      assignExperiment(EXPORT_BAR_AA, `population-${index}`));
    const controlA = assignments.filter((assignment) =>
      assignment.kind === 'included' && assignment.variant === 'control-a').length;
    expect(controlA).toBeGreaterThan(4_800);
    expect(controlA).toBeLessThan(5_200);
  });

  it('keeps variant balance conditional on partial enrollment', () => {
    const assignments = Array.from({ length: 50_000 }, (_, index) =>
      assignExperiment(EXPORT_BAR_AA, `partial-${index}`, 2_000));
    const included = assignments.filter((assignment) => assignment.kind === 'included');
    const controlA = included.filter((assignment) => assignment.variant === 'control-a').length;
    expect(included.length).toBeGreaterThan(9_700);
    expect(included.length).toBeLessThan(10_300);
    expect(controlA / included.length).toBeGreaterThan(0.48);
    expect(controlA / included.length).toBeLessThan(0.52);
  });
});
