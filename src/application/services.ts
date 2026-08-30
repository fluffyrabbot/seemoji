import type { RenderCoordinator } from './renderCoordinator';
import type { ClipboardPort, FileExportPort } from '../ports/clipboard';
import type { EditorWorkspaceStore } from './editorWorkspaceStore';
import type { StorageHealthPort } from '../ports/storageHealth';

export type { StorageHealth } from '../ports/storageHealth';

export interface AppServices {
  readonly renderer: RenderCoordinator;
  readonly clipboard: ClipboardPort;
  readonly fileExport: FileExportPort;
  readonly workspace: EditorWorkspaceStore;
  readonly storageHealth: StorageHealthPort;
}
