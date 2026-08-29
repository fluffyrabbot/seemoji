import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react';
import {
  canRedo,
  canUndo,
  editorReducer,
  INITIAL_EDITOR_STATE,
} from '../application/editor';
import type { AppServices } from '../application/services';
import { createEmojiAssetRef } from '../domain/emoji';
import { createFavorite, type Favorite } from '../domain/favorite';
import {
  DEFAULT_TRANSFORM,
  DEFAULT_DESIGN,
  DESIGN_LIMITS,
  getEmojiLayer,
  type RasterLayer,
  type SceneLayer,
} from '../domain/design';
import { decodeDesignDocument } from '../domain/designCodec';
import { decodeWorkspaceDocument, type WorkspaceDocument } from '../domain/workspaceDocument';
import { layerWorldBounds, unionWorldBounds } from '../domain/sceneGeometry';
import Controls from './Controls';
import EmojiPicker from './EmojiPicker';
import FavoritesBar from './FavoritesBar';
import LayersPanel from './LayersPanel';
import DocumentBar from './DocumentBar';
import Preview, { type BrushSettings, type CanvasSettings, type EditorTool } from './Preview';

export type Notice = {
  readonly kind: 'status' | 'error';
  readonly message: string;
};

interface Props {
  readonly services: AppServices;
}

export default function App({ services }: Props) {
  const [editor, dispatch] = useReducer(editorReducer, INITIAL_EDITOR_STATE);
  const [favorites, setFavorites] = useState<readonly Favorite[]>([]);
  const [documents, setDocuments] = useState<readonly WorkspaceDocument[]>([]);
  const [documentName, setDocumentName] = useState('Untitled design');
  const [currentDocumentId, setCurrentDocumentId] = useState<string | null>(null);
  const [draftStatus, setDraftStatus] = useState<'loading' | 'saved' | 'saving' | 'error'>('loading');
  const [selectionGroups, setSelectionGroups] = useState<readonly (readonly string[])[]>([]);
  const [favoriteName, setFavoriteName] = useState('');
  const [namingFavorite, setNamingFavorite] = useState(false);
  const [proportionsLocked, setProportionsLocked] = useState(true);
  const [tool, setTool] = useState<EditorTool>('select');
  const [brush, setBrush] = useState<BrushSettings>({
    color: '#ff4f9a',
    width: 0.035,
    opacity: 1,
    stabilization: 0.35,
    pressureCurve: 'linear',
    fillTolerance: 24,
  });
  const [canvasSettings, setCanvasSettings] = useState<CanvasSettings>(() => {
    try {
      const saved = localStorage.getItem('seemoji:canvas-settings:v1');
      if (saved) return { showGrid: false, gridDivisions: 8, snap: true, showGuides: true,
        ...JSON.parse(saved) as Partial<CanvasSettings> };
    } catch { /* Device preferences are optional. */ }
    return { showGrid: false, gridDivisions: 8, snap: true, showGuides: true };
  });
  const [notice, setNotice] = useState<Notice | null>(null);
  const noticeTimer = useRef<number | undefined>(undefined);
  const draftTimer = useRef<number | undefined>(undefined);
  const layerClipboard = useRef<readonly SceneLayer[]>([]);
  const documentsReady = useRef(false);

  const showNotice = useCallback((next: Notice) => {
    window.clearTimeout(noticeTimer.current);
    setNotice(next);
    if (next.kind === 'status') {
      noticeTimer.current = window.setTimeout(() => setNotice(null), 4_000);
    }
  }, []);

  useEffect(() => () => window.clearTimeout(noticeTimer.current), []);

  useEffect(() => {
    let active = true;
    services.favorites
      .list()
      .then((saved) => active && setFavorites(saved))
      .catch((cause: unknown) => {
        if (active) {
          showNotice({
            kind: 'error',
            message: `Favorites unavailable: ${String(cause)}`,
          });
        }
      });
    return () => {
      active = false;
    };
  }, [services.favorites, showNotice]);

  useEffect(() => {
    let active = true;
    Promise.all([services.documents.list(), services.documents.loadDraft()])
      .then(([saved, draft]) => {
        if (!active) return;
        setDocuments(saved);
        if (draft) {
          dispatch({ type: 'load-design', design: draft.design });
          setDocumentName(draft.name);
          setCurrentDocumentId(draft.documentId);
          showNotice({ kind: 'status', message: 'Recovered your latest local draft.' });
        }
        documentsReady.current = true;
        setDraftStatus('saved');
      })
      .catch((cause: unknown) => {
        if (active) {
          setDraftStatus('error');
          showNotice({ kind: 'error', message: `Document recovery unavailable: ${String(cause)}` });
        }
      });
    return () => { active = false; };
  }, [services.documents, showNotice]);

  useEffect(() => {
    if (!documentsReady.current) return;
    window.clearTimeout(draftTimer.current);
    let active = true;
    queueMicrotask(() => { if (active) setDraftStatus('saving'); });
    draftTimer.current = window.setTimeout(() => {
      services.documents.saveDraft({ version: 1, documentId: currentDocumentId,
        name: documentName.trim() || 'Untitled design', design: editor.design, updatedAt: Date.now() })
        .then(() => setDraftStatus('saved'))
        .catch(() => setDraftStatus('error'));
    }, 400);
    return () => { active = false; window.clearTimeout(draftTimer.current); };
  }, [editor.design, documentName, currentDocumentId, services.documents]);

  useEffect(() => {
    try { localStorage.setItem('seemoji:canvas-settings:v1', JSON.stringify(canvasSettings)); }
    catch { /* Editing remains available when preferences cannot be stored. */ }
  }, [canvasSettings]);

  const selectEmoji = async (grapheme: string): Promise<boolean> => {
    const source = createEmojiAssetRef(grapheme);
    try {
      await services.renderer.validateSource(source);
      dispatch({ type: 'set-source', source });
      return true;
    } catch (cause) {
      showNotice({ kind: 'error', message: String(cause) });
      return false;
    }
  };

  const saveFavorite = async () => {
    try {
      const favorite = createFavorite({
        id: crypto.randomUUID(),
        name: favoriteName,
        design: editor.design,
        createdAt: Date.now(),
      });
      setFavorites(await services.favorites.save(favorite));
      setFavoriteName('');
      setNamingFavorite(false);
      showNotice({ kind: 'status', message: `Saved “${favorite.name}”.` });
    } catch (cause) {
      showNotice({
        kind: 'error',
        message: `Could not save favorite: ${String(cause)}`,
      });
    }
  };

  const removeFavorite = async (id: string) => {
    try {
      setFavorites(await services.favorites.remove(id));
      showNotice({ kind: 'status', message: 'Favorite removed.' });
    } catch (cause) {
      showNotice({
        kind: 'error',
        message: `Could not remove favorite: ${String(cause)}`,
      });
    }
  };

  const saveDocument = async () => {
    try {
      const id = currentDocumentId ?? crypto.randomUUID();
      const document: WorkspaceDocument = { version: 1, id,
        name: documentName.trim() || 'Untitled design', design: editor.design, updatedAt: Date.now() };
      setDocuments(await services.documents.save(document));
      setCurrentDocumentId(id);
      setDocumentName(document.name);
      showNotice({ kind: 'status', message: `Saved “${document.name}”.` });
    } catch (cause) {
      showNotice({ kind: 'error', message: `Could not save document: ${String(cause)}` });
    }
  };

  const openDocument = (id: string) => {
    const document = documents.find((candidate) => candidate.id === id);
    if (!document) return;
    dispatch({ type: 'load-design', design: document.design });
    setCurrentDocumentId(document.id);
    setDocumentName(document.name);
    setSelectionGroups([]);
  };

  const newDocument = () => {
    dispatch({ type: 'load-design', design: DEFAULT_DESIGN });
    setCurrentDocumentId(null);
    setDocumentName('Untitled design');
    setSelectionGroups([]);
    setTool('select');
  };

  const deleteDocument = async () => {
    if (!currentDocumentId) return;
    try {
      setDocuments(await services.documents.remove(currentDocumentId));
      newDocument();
      showNotice({ kind: 'status', message: 'Document deleted. The current draft was reset.' });
    } catch (cause) {
      showNotice({ kind: 'error', message: `Could not delete document: ${String(cause)}` });
    }
  };

  const exportDocument = () => {
    const document: WorkspaceDocument = { version: 1, id: currentDocumentId ?? crypto.randomUUID(),
      name: documentName.trim() || 'Untitled design', design: editor.design, updatedAt: Date.now() };
    const filename = `${document.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'seemoji'}.json`;
    services.fileExport.download(new Blob([JSON.stringify(document, null, 2)],
      { type: 'application/json' }), filename);
  };

  const importDocument = async (file: File) => {
    try {
      const value: unknown = JSON.parse(await file.text());
      const workspace = decodeWorkspaceDocument(value);
      if (workspace.ok) {
        dispatch({ type: 'load-design', design: workspace.value.design });
        setCurrentDocumentId(null);
        setDocumentName(workspace.value.name);
      } else {
        const design = decodeDesignDocument(value);
        if (!design.ok) throw new Error(design.error);
        dispatch({ type: 'load-design', design: design.value });
        setCurrentDocumentId(null);
        setDocumentName(file.name.replace(/\.json$/i, '').slice(0, 80) || 'Imported design');
      }
      setSelectionGroups([]);
      showNotice({ kind: 'status', message: 'Imported design into a new local document.' });
    } catch (cause) {
      showNotice({ kind: 'error', message: `Import failed: ${String(cause)}` });
    }
  };

  const selectedLayers = editor.design.layers.filter((layer) => editor.selectedLayerIds.includes(layer.id));

  const expandGroupedSelection = (ids: readonly string[]) => [...new Set(ids.flatMap((id) =>
    selectionGroups.find((group) => group.includes(id)) ?? [id]))];

  const copySelection = () => {
    layerClipboard.current = selectedLayers;
    showNotice({ kind: 'status', message: `Copied ${selectedLayers.length} layer${selectedLayers.length === 1 ? '' : 's'} inside the editor.` });
  };

  const pasteSelection = () => {
    if (layerClipboard.current.length === 0) return;
    const layers = layerClipboard.current.map((layer): SceneLayer => ({ ...layer,
      id: crypto.randomUUID(), name: `${layer.name} copy`.slice(0, 80), transform: {
        ...layer.transform, x: Math.min(0.5, layer.transform.x + 0.035),
        y: Math.min(0.5, layer.transform.y + 0.035) } }));
    dispatch({ type: 'insert-layers', layers });
  };

  const duplicateSelection = () => dispatch({ type: 'duplicate-layers',
    layerIds: editor.selectedLayerIds,
    duplicateIds: editor.selectedLayerIds.map(() => crypto.randomUUID()), offset: 0.035 });

  const groupSelection = () => {
    if (editor.selectedLayerIds.length < 2) return;
    const ids = [...editor.selectedLayerIds];
    setSelectionGroups((current) => [...current.filter((group) => !group.some((id) => ids.includes(id))), ids]);
    showNotice({ kind: 'status', message: `Grouped ${ids.length} layers for workspace selection.` });
  };

  const ungroupSelection = () => {
    setSelectionGroups((current) => current.filter((group) => !group.some((id) => editor.selectedLayerIds.includes(id))));
    showNotice({ kind: 'status', message: 'Selection group removed.' });
  };

  const selectAllLayers = () => dispatch({ type: 'select-layers',
    layerIds: editor.design.layers.map((layer) => layer.id) });
  const deleteSelectedLayers = () => dispatch({ type: 'remove-layers', layerIds: editor.selectedLayerIds });

  const updateSelectedLayout = (
    updates: readonly { readonly layerId: string; readonly transform: SceneLayer['transform'] }[],
  ) => dispatch({ type: 'update-layer-transforms', updates });

  const alignSelected = (mode: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom') => {
    const union = unionWorldBounds(selectedLayers);
    if (!union || selectedLayers.length < 2) return;
    updateSelectedLayout(selectedLayers.map((layer) => {
      const bounds = layerWorldBounds(layer);
      const delta = mode === 'left' ? { x: union.left - bounds.left, y: 0 }
        : mode === 'center' ? { x: (union.left + union.right - bounds.left - bounds.right) / 2, y: 0 }
          : mode === 'right' ? { x: union.right - bounds.right, y: 0 }
            : mode === 'top' ? { x: 0, y: union.top - bounds.top }
              : mode === 'middle' ? { x: 0, y: (union.top + union.bottom - bounds.top - bounds.bottom) / 2 }
                : { x: 0, y: union.bottom - bounds.bottom };
      return { layerId: layer.id, transform: { ...layer.transform,
        x: Math.min(DESIGN_LIMITS.x[1], Math.max(DESIGN_LIMITS.x[0], layer.transform.x + delta.x)),
        y: Math.min(DESIGN_LIMITS.y[1], Math.max(DESIGN_LIMITS.y[0], layer.transform.y + delta.y)) } };
    }));
  };

  const distributeSelected = (axis: 'horizontal' | 'vertical') => {
    if (selectedLayers.length < 3) return;
    const measured = selectedLayers.map((layer) => ({ layer, bounds: layerWorldBounds(layer) }))
      .sort((a, b) => axis === 'horizontal'
        ? (a.bounds.left + a.bounds.right) - (b.bounds.left + b.bounds.right)
        : (a.bounds.top + a.bounds.bottom) - (b.bounds.top + b.bounds.bottom));
    const centerOf = (item: typeof measured[number]) => axis === 'horizontal'
      ? (item.bounds.left + item.bounds.right) / 2 : (item.bounds.top + item.bounds.bottom) / 2;
    const first = centerOf(measured[0]!);
    const step = (centerOf(measured.at(-1)!) - first) / (measured.length - 1);
    updateSelectedLayout(measured.map((item, index) => {
      const delta = first + step * index - centerOf(item);
      return { layerId: item.layer.id, transform: { ...item.layer.transform,
        ...(axis === 'horizontal' ? { x: item.layer.transform.x + delta } : { y: item.layer.transform.y + delta }) } };
    }));
  };

  const addLayer = (kind: 'paint' | 'rectangle' | 'ellipse' | 'line' | 'text') => {
    if (kind === 'paint') {
      const layerId = crypto.randomUUID();
      const paintLayers = editor.design.layers.filter((layer) => layer.kind === 'strokes');
      dispatch({ type: 'add-stroke-layer', layerId, name: `Paint ${paintLayers.length + 1}` });
      setTool('brush');
      return;
    }
    const common = { id: crypto.randomUUID(), name: kind[0]!.toUpperCase() + kind.slice(1),
      visible: true, opacity: 1, transform: DEFAULT_TRANSFORM, mask: [] } as const;
    const layer: SceneLayer = kind === 'text'
      ? { ...common, kind: 'text', bounds: { x: 0.2, y: 0.38, width: 0.6, height: 0.24 },
          text: 'Text', fontSize: 0.18, color: brush.color, fontFamily: 'sans-serif', align: 'center' }
      : { ...common, kind: 'shape', shape: kind, bounds: { x: 0.25, y: 0.3, width: 0.5, height: 0.4 },
          fill: kind === 'line' ? null : brush.color,
          stroke: kind === 'line' ? { color: brush.color, width: 0.025 } : null };
    dispatch({ type: 'add-layer', layer });
    setTool('select');
  };

  const shortcutActions = useRef({ saveDocument, copySelection, pasteSelection,
    duplicateSelection, groupSelection, ungroupSelection, selectAllLayers, deleteSelectedLayers });
  useLayoutEffect(() => {
    shortcutActions.current = { saveDocument, copySelection, pasteSelection,
      duplicateSelection, groupSelection, ungroupSelection, selectAllLayers, deleteSelectedLayers };
  });

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      const target = event.target;
      const editing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement
        || target instanceof HTMLSelectElement || (target instanceof HTMLElement && target.isContentEditable);
      const command = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      if (command && key === 's') { event.preventDefault(); void shortcutActions.current.saveDocument(); return; }
      if (editing) return;
      if (command && key === 'z') { event.preventDefault(); dispatch({ type: event.shiftKey ? 'redo' : 'undo' }); return; }
      if (command && key === 'a') { event.preventDefault(); shortcutActions.current.selectAllLayers(); return; }
      if (command && key === 'c') { event.preventDefault(); shortcutActions.current.copySelection(); return; }
      if (command && key === 'v') { event.preventDefault(); shortcutActions.current.pasteSelection(); return; }
      if (command && key === 'd') { event.preventDefault(); shortcutActions.current.duplicateSelection(); return; }
      if (command && key === 'g') {
        event.preventDefault();
        if (event.shiftKey) shortcutActions.current.ungroupSelection();
        else shortcutActions.current.groupSelection();
        return;
      }
      if (event.key === 'Backspace' || event.key === 'Delete') {
        event.preventDefault(); shortcutActions.current.deleteSelectedLayers(); return;
      }
      const toolKey: Partial<Record<string, EditorTool>> = { v: 'select', b: 'brush', e: 'eraser', f: 'fill', h: 'pan' };
      if (event.shiftKey && key === 'e') { event.preventDefault(); setTool('restore'); return; }
      if (toolKey[key]) { event.preventDefault(); setTool(toolKey[key]!); return; }
      const createKey = { r: 'rectangle', o: 'ellipse', l: 'line', t: 'text' } as const;
      if (key in createKey) { event.preventDefault(); addLayer(createKey[key as keyof typeof createKey]); }
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  });

  return (
    <>
      <header className="app-header">
        <div>
          <h1>seemoji</h1>
          <p>Shape, style, and share an emoji anywhere.</p>
        </div>
        <div className="history-actions" aria-label="Edit history">
          <button disabled={!canUndo(editor)} onClick={() => dispatch({ type: 'undo' })}
            title="Undo (⌘Z)">↶ Undo</button>
          <button disabled={!canRedo(editor)} onClick={() => dispatch({ type: 'redo' })}
            title="Redo (⇧⌘Z)">↷ Redo</button>
        </div>
      </header>

      <DocumentBar name={documentName} documents={documents} currentId={currentDocumentId}
        draftStatus={draftStatus} historyLength={editor.past.length}
        onNameChange={setDocumentName} onNew={newDocument} onSave={() => void saveDocument()}
        onOpen={openDocument} onDelete={() => void deleteDocument()} onExport={exportDocument}
        onImport={(file) => void importDocument(file)}
        onRestoreHistory={(index) => dispatch({ type: 'restore-history', index })} />

      <main className="editor-layout">
        <section className="picker-region" aria-label="Emoji source">
          <EmojiPicker emoji={getEmojiLayer(editor.design).source.grapheme} onPick={selectEmoji} />
          <LayersPanel
            design={editor.design}
            selectedLayerIds={editor.selectedLayerIds}
            onSelect={(layerId, toggle) => toggle
              ? dispatch({ type: 'select-layer', layerId, toggle: true })
              : dispatch({ type: 'select-layers', layerIds: expandGroupedSelection([layerId]) })}
            onToggle={(layerId) => dispatch({ type: 'toggle-layer', layerId })}
            onMove={(layerId, direction) => dispatch({ type: 'move-layer', layerId, direction })}
            onRemove={(layerId) => dispatch({ type: 'remove-layer', layerId })}
            onRename={(layerId, name) => dispatch({ type: 'rename-layer', layerId, name })}
            onDuplicate={(layerId) => {
              const layer = editor.design.layers.find((candidate) => candidate.id === layerId);
              if (layer) {
                dispatch({
                  type: 'duplicate-layer',
                  layerId,
                  duplicateId: crypto.randomUUID(),
                  name: `${layer.name} copy`.slice(0, 80),
                });
              }
            }}
            onOpacityChange={(layerId, opacity, historyGroup) =>
              dispatch({ type: 'set-layer-opacity', layerId, opacity, historyGroup })
            }
            onCommit={() => dispatch({ type: 'commit-history-group' })}
            onAdd={addLayer}
            onUpdate={(layer, historyGroup) => dispatch({ type: 'update-layer', layer,
              ...(historyGroup ? { historyGroup } : {}) })}
            onAlign={alignSelected}
            onDistribute={distributeSelected}
            onCopy={copySelection}
            onPaste={pasteSelection}
            onDuplicateSelection={duplicateSelection}
            onGroup={groupSelection}
            onUngroup={ungroupSelection}
          />
        </section>

        <section className="preview-region" aria-label="Canvas and export">
          <Preview
            design={editor.design}
            size={editor.exportSize}
            services={services}
            proportionsLocked={proportionsLocked}
            selectedLayerIds={editor.selectedLayerIds}
            tool={tool}
            brush={brush}
            canvasSettings={canvasSettings}
            onToolChange={setTool}
            onBrushChange={setBrush}
            onCanvasSettingsChange={setCanvasSettings}
            onPaintStroke={(layerId, stroke, createLayerName) =>
              dispatch({ type: 'paint-stroke', layerId, stroke,
                ...(createLayerName ? { createLayerName } : {}) })
            }
            onMaskStroke={(layerId, stroke) =>
              dispatch({ type: 'mask-stroke', layerId, stroke })
            }
            onTransformsChange={(updates, historyGroup) => dispatch({ type: 'update-layer-transforms', updates,
              ...(historyGroup ? { historyGroup } : {}) })}
            onSelectionChange={(layerIds) => dispatch({ type: 'select-layers', layerIds: expandGroupedSelection(layerIds) })}
            onRasterLayer={(layer: RasterLayer) => dispatch({ type: 'add-layer', layer })}
            onTransformCommit={() => dispatch({ type: 'commit-history-group' })}
            onSizeChange={(size) => dispatch({ type: 'set-size', size })}
            onNotice={showNotice}
          />
          <FavoritesBar
            favorites={favorites}
            renderer={services.renderer}
            onApply={(favorite) =>
              dispatch({ type: 'replace-design', design: favorite.design })
            }
            onRemove={(id) => void removeFavorite(id)}
          />
        </section>

        <section className="controls-region" aria-label="Editing controls">
          <Controls
            design={editor.design}
            proportionsLocked={proportionsLocked}
            onProportionsLockedChange={setProportionsLocked}
            onTransformChange={(transform, historyGroup) =>
              dispatch({ type: 'update-transform', transform,
                ...(historyGroup ? { historyGroup } : {}) })
            }
            onAppearanceChange={(appearance, historyGroup) =>
              dispatch({ type: 'update-appearance', appearance,
                ...(historyGroup ? { historyGroup } : {}) })
            }
            onApplyStyle={(transform, appearance) =>
              dispatch({ type: 'apply-layer-style', transform, appearance })
            }
            onCommit={() => dispatch({ type: 'commit-history-group' })}
            onReset={() => dispatch({ type: 'reset' })}
          />
          {!namingFavorite ? (
            <button className="favorite-start" onClick={() => setNamingFavorite(true)}>
              ☆ Save this tweak
            </button>
          ) : (
            <form
              className="favorite-form"
              onSubmit={(event) => {
                event.preventDefault();
                void saveFavorite();
              }}
            >
              <label htmlFor="favorite-name">Favorite name</label>
              <div>
                <input
                  id="favorite-name"
                  autoFocus
                  maxLength={80}
                  value={favoriteName}
                  onChange={(event) => setFavoriteName(event.target.value)}
                />
                <button type="submit" disabled={!favoriteName.trim()}>
                  Save
                </button>
                <button type="button" onClick={() => setNamingFavorite(false)}>
                  Cancel
                </button>
              </div>
            </form>
          )}
        </section>

      </main>

      <footer className="app-footer">
        Emoji artwork by{' '}
        <a href="https://github.com/jdecked/twemoji" target="_blank" rel="noreferrer">
          Twemoji
        </a>{' '}
        under{' '}
        <a
          href="https://creativecommons.org/licenses/by/4.0/"
          target="_blank"
          rel="noreferrer"
        >
          CC BY 4.0
        </a>
        .
      </footer>

      {notice && (
        <div
          className={`notice ${notice.kind}`}
          role={notice.kind === 'error' ? 'alert' : 'status'}
          aria-live={notice.kind === 'error' ? 'assertive' : 'polite'}
        >
          <span>{notice.message}</span>
          <button aria-label="Dismiss notification" onClick={() => setNotice(null)}>
            ×
          </button>
        </div>
      )}
    </>
  );
}
