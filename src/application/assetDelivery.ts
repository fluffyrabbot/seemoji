import type { ClipboardOutcome, ClipboardPort, FileExportPort } from '../ports/clipboard';

export interface AssetDeliveryService {
  copyPng(blob: Blob): Promise<ClipboardOutcome>;
  downloadPng(blob: Blob, filename: string): void;
}

export class AssetDelivery implements AssetDeliveryService {
  readonly #clipboard: ClipboardPort;
  readonly #fileExport: FileExportPort;
  constructor(options: { readonly clipboard: ClipboardPort; readonly fileExport: FileExportPort }) {
    this.#clipboard = options.clipboard;
    this.#fileExport = options.fileExport;
  }
  async copyPng(blob: Blob): Promise<ClipboardOutcome> {
    try { return await this.#clipboard.writePng(blob); }
    catch (cause) { return { kind: 'failed', cause }; }
  }
  downloadPng(blob: Blob, filename: string): void { this.#fileExport.download(blob, filename); }
}
