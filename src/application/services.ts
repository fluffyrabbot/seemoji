import type { RenderCoordinator } from './renderCoordinator';
import type { ClipboardPort, FileExportPort } from '../ports/clipboard';
import type { EditorWorkspaceStore } from './editorWorkspaceStore';
import type { StorageHealthPort } from '../ports/storageHealth';
import type { EmojiPackCatalog } from '../ports/emojiPackCatalog';
import type { PackPreferenceStore } from '../ports/packPreference';
import type { PackSession } from './packSession';

export type { StorageHealth } from '../ports/storageHealth';

export interface AppServices {
  readonly renderer: RenderCoordinator;
  readonly clipboard: ClipboardPort;
  readonly fileExport: FileExportPort;
  readonly workspace: EditorWorkspaceStore;
  readonly storageHealth: StorageHealthPort;
  readonly catalog: EmojiPackCatalog;
  readonly packPreference: PackPreferenceStore;
  readonly packs: PackSession;
}
