import type { ClipboardOutcome, ClipboardPort, FileExportPort } from '../ports/clipboard';
import type { ProductEventTracker } from '../ports/productEvents';

export interface AssetDeliveryService {
  copyPng(blob: Blob): Promise<ClipboardOutcome>;
  downloadPng(blob: Blob, filename: string): void;
}

export class AssetDelivery implements AssetDeliveryService {
  readonly #clipboard: ClipboardPort;
  readonly #fileExport: FileExportPort;
  readonly #events: ProductEventTracker;

  constructor(options: {
    readonly clipboard: ClipboardPort;
    readonly fileExport: FileExportPort;
    readonly events: ProductEventTracker;
  }) {
    this.#clipboard = options.clipboard;
    this.#fileExport = options.fileExport;
    this.#events = options.events;
  }

  async copyPng(blob: Blob): Promise<ClipboardOutcome> {
    let outcome: ClipboardOutcome;
    try {
      outcome = await this.#clipboard.writePng(blob);
    } catch (cause) {
      outcome = { kind: 'failed', cause };
    }
    if (outcome.kind === 'copied') {
      this.#capture({
        name: 'asset_delivery_succeeded',
        properties: { method: 'clipboard' },
      });
    } else {
      this.#capture({
        name: 'asset_delivery_failed',
        properties: { method: 'clipboard', reason: outcome.kind },
      });
    }
    return outcome;
  }

  downloadPng(blob: Blob, filename: string): void {
    try {
      this.#fileExport.download(blob, filename);
    } catch (cause) {
      this.#capture({
        name: 'asset_delivery_failed',
        properties: { method: 'download', reason: 'failed' },
      });
      throw cause;
    }
    this.#capture({
      name: 'asset_delivery_started',
      properties: { method: 'download' },
    });
  }

  #capture(event: Parameters<ProductEventTracker['capture']>[0]): void {
    try {
      this.#events.capture(event);
    } catch {
      // Observability must never alter copy or download behavior.
    }
  }
}
