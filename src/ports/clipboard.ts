export type ClipboardOutcome =
  | { readonly kind: 'copied' }
  | { readonly kind: 'unsupported' }
  | { readonly kind: 'denied'; readonly cause: unknown }
  | { readonly kind: 'failed'; readonly cause: unknown };

export interface ClipboardPort {
  writePng(blob: Blob): Promise<ClipboardOutcome>;
}

export interface FileExportPort {
  download(blob: Blob, filename: string): void;
}
