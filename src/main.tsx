import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserClipboard, BrowserFileExport } from './adapters/browser/browserClipboard';
import { BrowserCanvasRenderer } from './adapters/browser/canvasRenderer';
import { IndexedDbProjectRepository } from './adapters/browser/indexedDbProjectRepository';
import { BrowserWorkspaceSync } from './adapters/browser/browserWorkspaceSync';
import { BrowserStorageHealth } from './adapters/browser/browserStorageHealth';
import { HttpEmojiPackCatalog } from './adapters/browser/httpEmojiPackCatalog';
import { LocalPackPreferenceStore } from './adapters/browser/localPackPreferenceStore';
import { CanonicalPackSource } from './adapters/browser/canonicalPackSource';
import { EditorWorkspaceStore } from './application/editorWorkspaceStore';
import { RenderCoordinator } from './application/renderCoordinator';
import type { AppServices } from './application/services';
import { PackSession } from './application/packSession';
import { AssetDelivery } from './application/assetDelivery';
import { WorkspaceController } from './application/workspaceController';
import { NullProductEventSink } from './adapters/browser/experimentation/productEventSinks';
import { LocalExperimentStateStore } from './adapters/browser/experimentation/localExperimentStateStore';
import { EXPERIMENTS } from './experimentation/definitions';
import { ExperimentRuntime } from './experimentation/runtime';
import './index.css';
import App from './ui/App';

const workspace = new EditorWorkspaceStore(
  new WorkspaceController(new IndexedDbProjectRepository(), {
    sync: new BrowserWorkspaceSync(),
  }),
);
const catalog = new HttpEmojiPackCatalog();
const packPreference = new LocalPackPreferenceStore();
const renderer = new RenderCoordinator(
  new CanonicalPackSource({ catalog }),
  new BrowserCanvasRenderer(),
);
const clipboard = new BrowserClipboard();
const fileExport = new BrowserFileExport();
const experiments = new ExperimentRuntime({
  definitions: EXPERIMENTS,
  stateStore: new LocalExperimentStateStore(),
  eventSink: new NullProductEventSink(),
});

const services: AppServices = {
  renderer,
  clipboard,
  fileExport,
  workspace,
  storageHealth: new BrowserStorageHealth(),
  catalog,
  packPreference,
  packs: new PackSession({
    catalog,
    preference: packPreference,
    workspace,
    validateSource: (source) => renderer.validateSource(source),
  }),
  assetDelivery: new AssetDelivery({ clipboard, fileExport, events: experiments }),
};

const root = document.getElementById('root');
if (!root) throw new Error('Application root is missing');

createRoot(root).render(
  <StrictMode>
    <App services={services} experiments={experiments} />
  </StrictMode>,
);
