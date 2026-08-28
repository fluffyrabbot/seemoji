import type { RenderCoordinator } from './renderCoordinator';
import type { ClipboardPort, FileExportPort } from '../ports/clipboard';
import type { FavoritesRepository } from '../ports/favoritesRepository';

export interface AppServices {
  readonly renderer: RenderCoordinator;
  readonly clipboard: ClipboardPort;
  readonly fileExport: FileExportPort;
  readonly favorites: FavoritesRepository;
}
