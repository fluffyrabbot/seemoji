import type {
  ClipboardOutcome,
  ClipboardPort,
  FileExportPort,
} from '../../ports/clipboard';

type ClipboardItemConstructor = typeof ClipboardItem & {
  supports?: (type: string) => boolean;
};

export class BrowserClipboard implements ClipboardPort {
  async writePng(blob: Blob): Promise<ClipboardOutcome> {
    if (
      typeof navigator === 'undefined' ||
      !navigator.clipboard?.write ||
      typeof ClipboardItem === 'undefined'
    ) {
      return { kind: 'unsupported' };
    }

    const ClipboardItemType = ClipboardItem as ClipboardItemConstructor;
    if (ClipboardItemType.supports && !ClipboardItemType.supports('image/png')) {
      return { kind: 'unsupported' };
    }

    try {
      await navigator.clipboard.write([new ClipboardItemType({ 'image/png': blob })]);
      return { kind: 'copied' };
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'NotAllowedError') {
        return { kind: 'denied', cause };
      }
      return { kind: 'failed', cause };
    }
  }
}

export class BrowserFileExport implements FileExportPort {
  downloadPng(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}
