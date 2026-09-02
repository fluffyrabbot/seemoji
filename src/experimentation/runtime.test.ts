import { describe, expect, it } from 'vitest';
import { MemoryProductEventSink } from '../adapters/browser/experimentation/productEventSinks';
import type { ExperimentState, ExperimentStateStore } from '../ports/experimentState';
import { assignExperiment } from './assignment';
import { defineExperiment, EXPERIMENTS, EXPORT_BAR_AA } from './definitions';
import { ExperimentRuntime } from './runtime';

class MemoryStateStore implements ExperimentStateStore {
  state: ExperimentState | null;

  constructor(state: ExperimentState | null = null) {
    this.state = state;
  }

  read(): ExperimentState | null {
    return this.state;
  }

  write(state: ExperimentState): boolean {
    this.state = state;
    return true;
  }
}

const sequenceIds = (...ids: string[]) => {
  let index = 0;
  return () => ids[index++] ?? `generated-${index}`;
};

describe('ExperimentRuntime', () => {
  it('attributes conversions only after an exact-once exposure', () => {
    const now = Date.parse('2026-08-30T12:00:00.000Z');
    const state = new MemoryStateStore({ installationId: 'device-123', assignments: [] });
    const events = new MemoryProductEventSink();
    const runtime = new ExperimentRuntime({
      definitions: EXPERIMENTS,
      stateStore: state,
      eventSink: events,
      createId: sequenceIds('page', 'event-before', 'ready', 'exposure', 'event-after'),
      now: () => now,
    });

    runtime.capture({
      name: 'asset_delivery_succeeded',
      properties: { method: 'clipboard' },
    });
    expect(runtime.captureOnce({ name: 'editor_ready', properties: {} })).toBe(true);
    expect(runtime.captureOnce({ name: 'editor_ready', properties: {} })).toBe(true);
    runtime.expose('exportBarAa');
    runtime.expose('exportBarAa');
    runtime.capture({
      name: 'asset_delivery_started',
      properties: { method: 'download' },
    });

    expect(events.events.map((event) => event.event.name)).toEqual([
      'asset_delivery_succeeded',
      'editor_ready',
      'experiment_exposed',
      'asset_delivery_started',
    ]);
    expect(events.events[0]?.experiments).toEqual([]);
    expect(events.events[1]?.experiments).toEqual([]);
    expect(events.events[2]?.experiments).toHaveLength(1);
    expect(events.events[3]?.experiments).toEqual(events.events[2]?.experiments);
    expect(events.events[2]?.eventId).toBe('exposure');
    expect(events.events[2]?.occurredAt).toBe(now);
    expect(events.events.map((event) => event.pageSequence)).toEqual([1, 2, 3, 4]);
  });

  it('keeps a persisted included assignment when new enrollment is closed', () => {
    const state = new MemoryStateStore({
      installationId: 'sticky-device',
      assignments: [{
        experimentKey: EXPORT_BAR_AA.key,
        experimentVersion: EXPORT_BAR_AA.version,
        variant: 'control-b',
      }],
    });
    const runtime = new ExperimentRuntime({
      definitions: EXPERIMENTS,
      stateStore: state,
      eventSink: new MemoryProductEventSink(),
      enrollmentBasisPointOverrides: { exportBarAa: 0 },
      createId: sequenceIds('page'),
    });
    expect(runtime.variantFor('exportBarAa')).toBe('control-b');
    expect(runtime.assignmentFor('exportBarAa').kind).toBe('included');
  });

  it('does not persist exclusion, allowing monotonic traffic expansion', () => {
    const installationId = Array.from({ length: 20_000 }, (_, index) => `expand-${index}`)
      .find((id) => {
        const assignment = assignExperiment(EXPORT_BAR_AA, id, 5_000);
        return assignment.kind === 'included' && assignment.inclusionBucket >= 1_000;
      });
    expect(installationId).toBeDefined();
    const state = new MemoryStateStore({ installationId: installationId!, assignments: [] });
    const first = new ExperimentRuntime({
      definitions: EXPERIMENTS,
      stateStore: state,
      eventSink: new MemoryProductEventSink(),
      enrollmentBasisPointOverrides: { exportBarAa: 1_000 },
      createId: sequenceIds('page-1'),
    });
    expect(first.assignmentFor('exportBarAa').kind).toBe('excluded');
    expect(state.state?.assignments).toEqual([]);

    const second = new ExperimentRuntime({
      definitions: EXPERIMENTS,
      stateStore: state,
      eventSink: new MemoryProductEventSink(),
      enrollmentBasisPointOverrides: { exportBarAa: 5_000 },
      createId: sequenceIds('page-2'),
    });
    expect(second.assignmentFor('exportBarAa').kind).toBe('included');
    expect(state.state?.assignments).toHaveLength(1);
  });

  it('fails open when telemetry throws', () => {
    const runtime = new ExperimentRuntime({
      definitions: EXPERIMENTS,
      stateStore: new MemoryStateStore({ installationId: 'device', assignments: [] }),
      eventSink: { capture: () => { throw new Error('offline'); } },
      createId: sequenceIds('page', 'event'),
    });
    expect(() => runtime.expose('exportBarAa')).not.toThrow();
  });

  it('fails open when event identity generation throws', () => {
    const runtime = new ExperimentRuntime({
      definitions: EXPERIMENTS,
      stateStore: new MemoryStateStore({ installationId: 'device', assignments: [] }),
      eventSink: new MemoryProductEventSink(),
      createId: sequenceIds('page', ''),
    });
    expect(() => runtime.expose('exportBarAa')).not.toThrow();
  });

  it('falls back when the startup identity source is invalid', () => {
    expect(() => new ExperimentRuntime({
      definitions: EXPERIMENTS,
      stateStore: new MemoryStateStore(),
      eventSink: new MemoryProductEventSink(),
      createId: () => '',
    })).not.toThrow();
  });

  it('does not attribute outcomes when the exposure was not accepted', () => {
    const events = new MemoryProductEventSink();
    const runtime = new ExperimentRuntime({
      definitions: EXPERIMENTS,
      stateStore: new MemoryStateStore({ installationId: 'device', assignments: [] }),
      eventSink: {
        capture: (event) => event.event.name === 'experiment_exposed'
          ? false
          : events.capture(event),
      },
      createId: sequenceIds('page', 'exposure', 'outcome'),
    });
    runtime.expose('exportBarAa');
    runtime.capture({
      name: 'asset_delivery_succeeded',
      properties: { method: 'clipboard' },
    });
    expect(events.events).toHaveLength(1);
    expect(events.events[0]?.experiments).toEqual([]);
  });

  it('forces control and disables collection without durable identity', () => {
    const events = new MemoryProductEventSink();
    const runtime = new ExperimentRuntime({
      definitions: EXPERIMENTS,
      stateStore: {
        read: () => ({
          installationId: 'device',
          assignments: [{
            experimentKey: EXPORT_BAR_AA.key,
            experimentVersion: EXPORT_BAR_AA.version,
            variant: 'control-b',
          }],
        }),
        write: () => false,
      },
      eventSink: events,
      createId: sequenceIds('page'),
    });
    expect(runtime.variantFor('exportBarAa')).toBe('control-a');
    expect(runtime.captureOnce({ name: 'editor_ready', properties: {} })).toBe(false);
    runtime.expose('exportBarAa');
    expect(events.events).toEqual([]);
  });

  it('supports an explicit force-control kill without deleting sticky assignment', () => {
    const events = new MemoryProductEventSink();
    const state = new MemoryStateStore({
      installationId: 'device',
      assignments: [{
        experimentKey: EXPORT_BAR_AA.key,
        experimentVersion: EXPORT_BAR_AA.version,
        variant: 'control-b',
      }],
    });
    const runtime = new ExperimentRuntime({
      definitions: EXPERIMENTS,
      stateStore: state,
      eventSink: events,
      forceControlOverrides: { exportBarAa: true },
      createId: sequenceIds('page'),
    });
    expect(runtime.variantFor('exportBarAa')).toBe('control-a');
    runtime.expose('exportBarAa');
    expect(events.events).toEqual([]);
    expect(state.state?.assignments[0]?.variant).toBe('control-b');
  });

  it('treats a paused definition as force-control while retaining its cohort', () => {
    const paused = defineExperiment({ ...EXPORT_BAR_AA, status: 'paused' });
    const state = new MemoryStateStore({
      installationId: 'device',
      assignments: [{
        experimentKey: paused.key,
        experimentVersion: paused.version,
        variant: 'control-b',
      }],
    });
    const events = new MemoryProductEventSink();
    const runtime = new ExperimentRuntime({
      definitions: { exportBarAa: paused },
      stateStore: state,
      eventSink: events,
      createId: sequenceIds('page'),
    });
    expect(runtime.variantFor('exportBarAa')).toBe('control-a');
    runtime.expose('exportBarAa');
    expect(events.events).toEqual([]);
    expect(state.state?.assignments[0]?.variant).toBe('control-b');
  });

  it.each(['2026-08-29', '2026-10-16'])(
    'forces control outside the declared lifecycle on %s',
    (date) => {
      const state = new MemoryStateStore({
        installationId: 'device',
        assignments: [{
          experimentKey: EXPORT_BAR_AA.key,
          experimentVersion: EXPORT_BAR_AA.version,
          variant: 'control-b',
        }],
      });
      const events = new MemoryProductEventSink();
      const runtime = new ExperimentRuntime({
        definitions: EXPERIMENTS,
        stateStore: state,
        eventSink: events,
        now: () => Date.parse(`${date}T12:00:00.000Z`),
        createId: sequenceIds('page'),
      });
      expect(runtime.variantFor('exportBarAa')).toBe('control-a');
      runtime.expose('exportBarAa');
      expect(events.events).toEqual([]);
    },
  );
});
