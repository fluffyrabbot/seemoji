import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserClipboard, BrowserFileExport } from './adapters/browser/browserClipboard';
import { BrowserCanvasRenderer } from './adapters/browser/canvasRenderer';
import { LocalFavoritesRepository } from './adapters/browser/localFavoritesRepository';
import { TwemojiCdnAssetSource } from './adapters/browser/twemojiAssetSource';
import { RenderCoordinator } from './application/renderCoordinator';
import type { AppServices } from './application/services';
import './index.css';
import App from './ui/App';

const services: AppServices = {
  renderer: new RenderCoordinator(new TwemojiCdnAssetSource(), new BrowserCanvasRenderer()),
  clipboard: new BrowserClipboard(),
  fileExport: new BrowserFileExport(),
  favorites: new LocalFavoritesRepository(),
};

const root = document.getElementById('root');
if (!root) throw new Error('Application root is missing');

createRoot(root).render(
  <StrictMode>
    <App services={services} />
  </StrictMode>,
);
