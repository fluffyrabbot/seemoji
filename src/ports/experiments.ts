import type { TrackableProductEvent, ProductEventTracker } from './productEvents';

export interface ExperimentClient<
  Variants extends Readonly<Record<string, string>>,
> extends ProductEventTracker {
  variantFor<Name extends keyof Variants>(name: Name): Variants[Name];
  expose<Name extends keyof Variants>(name: Name): void;
  /** Captures at most one accepted event with this name per page view. */
  captureOnce(event: TrackableProductEvent): boolean;
}
