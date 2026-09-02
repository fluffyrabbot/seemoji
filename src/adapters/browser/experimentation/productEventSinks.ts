import type { ProductEventEnvelope, ProductEventSink } from '../../../ports/productEvents';

export class NullProductEventSink implements ProductEventSink {
  capture(_event: ProductEventEnvelope): boolean {
    return false;
  }
}

export class MemoryProductEventSink implements ProductEventSink {
  readonly events: ProductEventEnvelope[] = [];

  capture(event: ProductEventEnvelope): boolean {
    this.events.push(event);
    return true;
  }
}
