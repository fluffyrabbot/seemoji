export interface ExperimentAttribution {
  readonly experimentKey: string;
  readonly experimentVersion: number;
  readonly variant: string;
}

export type ProductEvent =
  | {
      readonly name: 'experiment_exposed';
      readonly properties: ExperimentAttribution;
    }
  | {
      readonly name: 'editor_ready';
      readonly properties: Readonly<Record<string, never>>;
    }
  | {
      readonly name: 'asset_delivery_succeeded';
      readonly properties: {
        readonly method: 'clipboard';
      };
    }
  | {
      readonly name: 'asset_delivery_started';
      readonly properties: {
        readonly method: 'download';
      };
    }
  | {
      readonly name: 'asset_delivery_failed';
      readonly properties: {
        readonly method: 'clipboard' | 'download';
        readonly reason: 'unsupported' | 'denied' | 'failed';
      };
    };

export interface ProductEventEnvelope {
  readonly schemaVersion: 1;
  readonly eventId: string;
  readonly occurredAt: number;
  readonly pageSequence: number;
  readonly installationId: string;
  readonly pageViewId: string;
  readonly event: ProductEvent;
  /** Only experiments exposed before this event are eligible for attribution. */
  readonly experiments: readonly ExperimentAttribution[];
}

export interface ProductEventSink {
  /** Returns true only after the event is synchronously accepted for delivery. */
  capture(event: ProductEventEnvelope): boolean;
}

export type TrackableProductEvent = Exclude<
  ProductEvent,
  { readonly name: 'experiment_exposed' }
>;

/** Captures semantic product outcomes with the runtime's active experiment context. */
export interface ProductEventTracker {
  capture(event: TrackableProductEvent): void;
}
