import { beforeEach, describe, expect, it } from 'vitest';
import { EXPERIMENT_STATE_KEY, LocalExperimentStateStore } from './localExperimentStateStore';

describe('LocalExperimentStateStore', () => {
  beforeEach(() => localStorage.clear());

  it('round-trips the versioned identity and sticky assignments', () => {
    const store = new LocalExperimentStateStore(localStorage);
    expect(store.write({
      installationId: 'device-123',
      assignments: [{
        experimentKey: 'export-bar-aa',
        experimentVersion: 1,
        variant: 'control-b',
      }],
    })).toBe(true);
    expect(store.read()).toEqual({
      installationId: 'device-123',
      assignments: [{
        experimentKey: 'export-bar-aa',
        experimentVersion: 1,
        variant: 'control-b',
      }],
    });
  });

  it.each([
    '{',
    JSON.stringify({ version: 2, installationId: 'device', assignments: [] }),
    JSON.stringify({ version: 1, installationId: '', assignments: [] }),
    JSON.stringify({
      version: 1,
      installationId: 'device',
      assignments: [{ experimentKey: '../bad', experimentVersion: 1, variant: 'control' }],
    }),
  ])('fails open for corrupt or unsupported state', (encoded) => {
    localStorage.setItem(EXPERIMENT_STATE_KEY, encoded);
    expect(new LocalExperimentStateStore(localStorage).read()).toBeNull();
  });

  it('continues without persistence when browser storage is unavailable', () => {
    const store = new LocalExperimentStateStore(null);
    expect(store.read()).toBeNull();
    expect(store.write({ installationId: 'device', assignments: [] })).toBe(false);
  });

  it('refuses to claim durability when the complete state cannot be stored', () => {
    const store = new LocalExperimentStateStore(localStorage);
    const assignments = Array.from({ length: 33 }, (_, index) => ({
      experimentKey: `experiment-${index}`,
      experimentVersion: 1,
      variant: 'control',
    }));
    expect(store.write({ installationId: 'device', assignments })).toBe(false);
    expect(localStorage.getItem(EXPERIMENT_STATE_KEY)).toBeNull();
  });
});
