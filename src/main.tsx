import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserClipboard, BrowserFileExport } from './adapters/browser/browserClipboard';
import { BrowserCanvasRenderer } from './adapters/browser/canvasRenderer';
import { IndexedDbProjectRepository } from './adapters/browser/indexedDbProjectRepository';
import { BrowserWorkspaceSync } from './adapters/browser/browserWorkspaceSync';
import { BrowserStorageHealth } from './adapters/browser/browserStorageHealth';
import { TwemojiCdnAssetSource } from './adapters/browser/twemojiAssetSource';
import { EditorWorkspaceStore } from './application/editorWorkspaceStore';
import { RenderCoordinator } from './application/renderCoordinator';
import type { AppServices } from './application/services';
import { WorkspaceController } from './application/workspaceController';
import './index.css';
import App from './ui/App';

const services: AppServices = {
  renderer: new RenderCoordinator(new TwemojiCdnAssetSource(), new BrowserCanvasRenderer()),
  clipboard: new BrowserClipboard(),
  fileExport: new BrowserFileExport(),
  workspace: new EditorWorkspaceStore(
    new WorkspaceController(new IndexedDbProjectRepository(), {
      sync: new BrowserWorkspaceSync(),
    }),
  ),
  storageHealth: new BrowserStorageHealth(),
};

const root = document.getElementById('root');
if (!root) throw new Error('Application root is missing');

createRoot(root).render(
  <StrictMode>
    <App services={services} />
  </StrictMode>,
);
