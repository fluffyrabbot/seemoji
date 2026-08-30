import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  canRedo,
  canUndo,
  editorReducer,
  INITIAL_EDITOR_STATE,
} from '../application/editor';
import type { AppServices, StorageHealth } from '../application/services';
import type {
  ProjectConflictResolution,
  WorkspaceSnapshot,
} from '../application/workspaceController';
import { createEmojiAssetRef } from '../domain/emoji';
import {
  DEFAULT_TRANSFORM,
  DESIGN_LIMITS,
  getEmojiLayer,
  type DesignDocument,
  type RasterLayer,
  type SceneLayer,
} from '../domain/design';
import { decodeDesignDocument } from '../domain/designCodec';
import { decodeProject, type Project } from '../domain/project';
import type { ProjectQuarantineRecord } from '../domain/projectQuarantine';
import { layerWorldBounds, unionWorldBounds } from '../domain/sceneGeometry';
import Controls from './Controls';
import ConflictResolutionPanel from './ConflictResolutionPanel';
import EmojiPicker from './EmojiPicker';
import LayersPanel from './LayersPanel';
import ProjectBar from './ProjectBar';
import Preview, { type BrushSettings, type CanvasSettings, type EditorTool } from './Preview';
import StarredProjectsBar from './StarredProjectsBar';
import WorkspaceRecoveryPanel from './WorkspaceRecoveryPanel';
import WorkspaceMenu from './WorkspaceMenu';

export type Notice = {
  readonly kind: 'status' | 'error';
  readonly message: string;
};

interface Props {
  readonly services: AppServices;
}

export default function App({ services }: Props) {
  const [editor, dispatch] = useReducer(editorReducer, INITIAL_EDITOR_STATE);
  const [projects, setProjects] = useState<readonly Project[]>([]);
  const [projectName, setProjectName] = useState('Untitled design');
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  const [workspaceIssues, setWorkspaceIssues] = useState<WorkspaceSnapshot['issues']>([]);
  const [storageHealth, setStorageHealth] = useState<StorageHealth | null>(null);
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [persistenceStatus, setPersistenceStatus] =
    useState<'loading' | 'saved' | 'saving' | 'conflict' | 'error'>('loading');
  const [selectionGroups, setSelectionGroups] = useState<readonly (readonly string[])[]>([]);
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
  const layerClipboard = useRef<readonly SceneLayer[]>([]);
  const workspaceReady = useRef(false);
  const conflictPanelRef = useRef<HTMLDivElement>(null);

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
    const unsubscribe = services.workspace.subscribeStatus((status) => {
      if (!active) return;
      setPersistenceStatus(status);
    });
    const unsubscribeWorkspace = services.workspace.subscribeWorkspace((workspace) => {
      if (!active) return;
      setProjects(workspace.projects);
      setProjectName(workspace.activeProject.name);
      setCurrentProjectId(workspace.activeProject.id);
      setWorkspaceIssues(workspace.issues);
      dispatch({ type: 'load-design', design: workspace.activeProject.design });
      setSelectionGroups([]);
    });
    services.workspace.load()
      .then((workspace) => {
        if (!active) return;
        setProjects(workspace.projects);
        setProjectName(workspace.activeProject.name);
        setCurrentProjectId(workspace.activeProject.id);
        setWorkspaceIssues(workspace.issues);
        dispatch({ type: 'load-design', design: workspace.activeProject.design });
        workspaceReady.current = true;
        setPersistenceStatus('saved');
        if (workspace.issues.length > 0) {
          showNotice({
            kind: 'error',
            message: workspace.issues.map((issue) =>
              `Project record ${issue.recordId ?? 'unknown'} was isolated: ${issue.error}`).join(' '),
          });
        }
      })
      .catch((cause: unknown) => {
        if (active) {
          setPersistenceStatus('error');
          showNotice({ kind: 'error', message: `Project workspace unavailable: ${String(cause)}` });
        }
      });
    return () => {
      active = false;
      unsubscribe();
      unsubscribeWorkspace();
      services.workspace.dispose();
    };
  }, [services.workspace, showNotice]);

  useEffect(() => {
    let active = true;
    void services.storageHealth.inspect().then((health) => {
      if (active) setStorageHealth(health);
    }).catch(() => {
      if (active) setStorageHealth({ durability: 'unavailable', usageBytes: null, quotaBytes: null });
    });
    return () => { active = false; };
  }, [services.storageHealth]);

  useEffect(() => {
    if (!workspaceReady.current) return;
    const active = services.workspace.snapshot().activeProject;
    const name = projectName.trim() || 'Untitled design';
    if (active.design === editor.design && active.name === name) return;
    services.workspace.updateActive(name, editor.design);
  }, [editor.design, projectName, services.workspace]);

  useEffect(() => {
    const flush = () => { void services.workspace.flush().catch(() => undefined); };
    const onVisibilityChange = () => { if (document.visibilityState === 'hidden') flush(); };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [services.workspace]);

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

  const applyWorkspace = (workspace: WorkspaceSnapshot) => {
    setProjects(workspace.projects);
    setCurrentProjectId(workspace.activeProject.id);
    setProjectName(workspace.activeProject.name);
    setWorkspaceIssues(workspace.issues);
    dispatch({ type: 'load-design', design: workspace.activeProject.design });
    setSelectionGroups([]);
    setTool('select');
  };

  const saveNow = async () => {
    try {
      const workspace = services.workspace.updateActive(projectName, editor.design);
      setProjects(workspace.projects);
      await services.workspace.flush();
      if (services.workspace.persistenceStatus !== 'conflict') {
        showNotice({ kind: 'status', message: 'Project saved locally.' });
      }
    } catch (cause) {
      showNotice({ kind: 'error', message: `Could not save project: ${String(cause)}` });
    }
  };

  const openProject = async (id: string) => {
    try {
      applyWorkspace(await services.workspace.activate(id));
    } catch (cause) {
      showNotice({ kind: 'error', message: `Could not open project: ${String(cause)}` });
    }
  };

  const newProject = async () => {
    try {
      applyWorkspace(await services.workspace.create());
    } catch (cause) {
      showNotice({ kind: 'error', message: `Could not create project: ${String(cause)}` });
    }
  };

  const deleteProject = async () => {
    if (!currentProjectId) return;
    const name = projectName.trim() || 'Untitled design';
    if (!window.confirm(
      `Delete “${name}”? This permanently removes the local project and cannot be undone.`,
    )) return;
    try {
      applyWorkspace(await services.workspace.deleteActive());
      showNotice({ kind: 'status', message: `Deleted “${name}”.` });
    } catch (cause) {
      showNotice({ kind: 'error', message: `Could not delete project: ${String(cause)}` });
    }
  };

  const toggleStar = async () => {
    if (!currentProjectId) return;
    try {
      const workspace = services.workspace.updateActive(projectName, editor.design);
      setProjects(workspace.projects);
      setProjects((await services.workspace.toggleStar(currentProjectId)).projects);
    } catch (cause) {
      showNotice({ kind: 'error', message: `Could not update star: ${String(cause)}` });
    }
  };

  const createFromTemplate = async (id: string) => {
    try {
      applyWorkspace(await services.workspace.useAsTemplate(id));
      showNotice({ kind: 'status', message: 'Created a project from the template.' });
    } catch (cause) {
      showNotice({ kind: 'error', message: `Could not use template: ${String(cause)}` });
    }
  };

  const resolveProjectConflict = async (
    conflictProjectId: string,
    resolution: ProjectConflictResolution,
  ) => {
    try {
      applyWorkspace(await services.workspace.resolveConflict(conflictProjectId, resolution));
      const message = resolution === 'keep-source' ? 'Kept the original project.'
        : resolution === 'keep-conflict' ? 'Promoted the conflict edit into the original project.'
          : 'Kept both projects independently.';
      showNotice({ kind: 'status', message });
    } catch (cause) {
      showNotice({
        kind: 'error',
        message: `Conflict resolution changed in another tab. The workspace was refreshed. ${String(cause)}`,
      });
    }
  };

  const exportProject = () => {
    const active = services.workspace.snapshot().activeProject;
    const project: Project = { ...active, name: projectName.trim() || 'Untitled design',
      design: editor.design, updatedAt: Math.max(Date.now(), active.createdAt) };
    const filename = `${project.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'seemoji'}.json`;
    services.fileExport.download(new Blob([JSON.stringify(project, null, 2)],
      { type: 'application/json' }), filename);
  };

  const importProject = async (file: File) => {
    try {
      const value: unknown = JSON.parse(await file.text());
      const project = decodeProject(value);
      let name: string;
      let design: DesignDocument;
      if (project.ok) {
        name = project.value.name;
        design = project.value.design;
      } else {
        const decodedDesign = decodeDesignDocument(value);
        if (!decodedDesign.ok) throw new Error(decodedDesign.error);
        name = file.name.replace(/\.json$/i, '').slice(0, 80) || 'Imported design';
        design = decodedDesign.value;
      }
      applyWorkspace(await services.workspace.create(design, name));
      showNotice({ kind: 'status', message: 'Imported design into a new local project.' });
    } catch (cause) {
      showNotice({ kind: 'error', message: `Import failed: ${String(cause)}` });
    }
  };

  const exportWorkspaceArchive = async () => {
    setRecoveryBusy(true);
    try {
      const archive = await services.workspace.exportArchive();
      const date = new Date(archive.exportedAt).toISOString().slice(0, 10);
      services.fileExport.download(new Blob([JSON.stringify(archive, null, 2)],
        { type: 'application/json' }), `seemoji-workspace-${date}.json`);
      const omission = archive.omissions.length > 0
        ? ` ${archive.omissions.length} isolated record${archive.omissions.length === 1 ? ' is' : 's are'} listed as omitted.`
        : '';
      showNotice({
        kind: 'status',
        message: `Exported ${archive.projects.length} projects.${omission}`,
      });
    } catch (cause) {
      showNotice({ kind: 'error', message: `Workspace export failed: ${String(cause)}` });
    } finally {
      setRecoveryBusy(false);
    }
  };

  const importWorkspaceArchive = async (file: File) => {
    setRecoveryBusy(true);
    try {
      const result = await services.workspace.importArchive(JSON.parse(await file.text()) as unknown);
      applyWorkspace(result.workspace);
      const omission = result.archivedOmissions.length > 0
        ? ` The archive reports ${result.archivedOmissions.length} omitted corrupt record${result.archivedOmissions.length === 1 ? '' : 's'}.`
        : '';
      showNotice({
        kind: 'status',
        message: `Imported ${result.importedProjectCount} projects with new identities.${omission}`,
      });
    } catch (cause) {
      showNotice({ kind: 'error', message: `Workspace import failed: ${String(cause)}` });
    } finally {
      setRecoveryBusy(false);
    }
  };

  const exportQuarantinedRecord = async (record: ProjectQuarantineRecord) => {
    setRecoveryBusy(true);
    try {
      const recovery = await services.workspace.exportQuarantinedRecord(record);
      const identity = (recovery.recordId ?? recovery.contentHash.slice(-8))
        .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'unknown';
      services.fileExport.download(new Blob([JSON.stringify(recovery, null, 2)],
        { type: 'application/json' }), `seemoji-quarantine-${identity}.json`);
      showNotice({
        kind: 'status',
        message: `Exported isolated record ${recovery.recordId ?? recovery.contentHash}.`,
      });
    } catch (cause) {
      showNotice({
        kind: 'error',
        message: `Raw recovery export failed because the record may have changed. ${String(cause)}`,
      });
    } finally {
      setRecoveryBusy(false);
    }
  };

  const purgeQuarantinedRecord = async (record: ProjectQuarantineRecord) => {
    const identity = record.recordId ?? record.contentHash;
    if (!window.confirm(
      `Permanently delete isolated record ${identity}? Export it first if it may contain recoverable data. This cannot be undone.`,
    )) return;
    setRecoveryBusy(true);
    try {
      applyWorkspace(await services.workspace.purgeQuarantinedRecord(record));
      showNotice({ kind: 'status', message: `Permanently purged isolated record ${identity}.` });
    } catch (cause) {
      showNotice({
        kind: 'error',
        message: `Purge stopped because the record may have changed. Nothing was deleted. ${String(cause)}`,
      });
    } finally {
      setRecoveryBusy(false);
    }
  };

  const requestPersistentStorage = async () => {
    setRecoveryBusy(true);
    try {
      const health = await services.storageHealth.requestPersistence();
      setStorageHealth(health);
      showNotice({
        kind: health.durability === 'persistent' ? 'status' : 'error',
        message: health.durability === 'persistent'
          ? 'Persistent browser storage granted.'
          : 'Persistent storage was not granted. Workspace archives remain available.',
      });
    } catch (cause) {
      showNotice({ kind: 'error', message: `Storage persistence request failed: ${String(cause)}` });
    } finally {
      setRecoveryBusy(false);
    }
  };

  const selectedLayers = editor.design.layers.filter((layer) => editor.selectedLayerIds.includes(layer.id));
  const presentedProjects = useMemo(() => projects.map((project) => project.id === currentProjectId
    ? { ...project, name: projectName.trim() || 'Untitled design', design: editor.design }
    : project), [currentProjectId, editor.design, projectName, projects]);
  const hasConflicts = presentedProjects.some((project) => project.conflict !== null);

  const reviewConflicts = () => {
    conflictPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    conflictPanelRef.current?.focus({ preventScroll: true });
  };

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

  const shortcutActions = useRef({ saveNow, copySelection, pasteSelection,
    duplicateSelection, groupSelection, ungroupSelection, selectAllLayers, deleteSelectedLayers });
  useLayoutEffect(() => {
    shortcutActions.current = { saveNow, copySelection, pasteSelection,
      duplicateSelection, groupSelection, ungroupSelection, selectAllLayers, deleteSelectedLayers };
  });

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      const target = event.target;
      const editing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement
        || target instanceof HTMLSelectElement || (target instanceof HTMLElement && target.isContentEditable);
      const command = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      if (command && key === 's') { event.preventDefault(); void shortcutActions.current.saveNow(); return; }
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

  if (!currentProjectId) {
    return <main className="editor-layout" aria-busy="true">
      <p role={persistenceStatus === 'error' ? 'alert' : 'status'}>
        {notice?.message ?? 'Opening project workspace…'}
      </p>
    </main>;
  }

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

      <ProjectBar name={projectName} projects={presentedProjects} currentId={currentProjectId}
        persistenceStatus={persistenceStatus}
        onNameChange={setProjectName} onNew={() => void newProject()}
        onOpen={(id) => void openProject(id)}
        menu={<WorkspaceMenu
          starred={presentedProjects.find((project) => project.id === currentProjectId)?.starredAt != null}
          storageHealth={storageHealth}
          busy={recoveryBusy}
          onSaveNow={() => void saveNow()}
          onToggleStar={() => void toggleStar()}
          onDelete={() => void deleteProject()}
          onExportProject={exportProject}
          onImportProject={(file) => void importProject(file)}
          onExportWorkspace={() => void exportWorkspaceArchive()}
          onImportWorkspace={(file) => void importWorkspaceArchive(file)}
          onRequestPersistence={() => void requestPersistentStorage()}
        />} />

      {hasConflicts && (
        <section className="workspace-status-banner conflict" role="alert">
          <div>
            <strong>Concurrent edits are safe.</strong>
            <span>Compare the preserved versions and choose what to keep.</span>
          </div>
          <button type="button" onClick={reviewConflicts}>Review versions</button>
        </section>
      )}
      {persistenceStatus === 'error' && (
        <section className="workspace-status-banner error" role="alert">
          <div>
            <strong>Local changes could not be saved.</strong>
            <span>Your editor remains open. Try the save again before closing this tab.</span>
          </div>
          <button type="button" onClick={() => void saveNow()}>Try saving again</button>
        </section>
      )}

      <WorkspaceRecoveryPanel
        issues={workspaceIssues}
        busy={recoveryBusy}
        onExportQuarantined={(record) => void exportQuarantinedRecord(record)}
        onPurgeQuarantined={(record) => void purgeQuarantinedRecord(record)}
      />

      <main className="editor-layout">
        <div className="editor-panel-tabs" role="radiogroup" aria-label="Editing panels">
          <input className="panel-tab-input" type="radio" name="editor-panel" id="emoji-tab"
            defaultChecked />
          <label htmlFor="emoji-tab">Emoji</label>
          <input className="panel-tab-input" type="radio" name="editor-panel" id="layers-tab" />
          <label htmlFor="layers-tab">Layers</label>
          <input className="panel-tab-input" type="radio" name="editor-panel" id="adjust-tab" />
          <label htmlFor="adjust-tab">Adjust</label>
        </div>
        <section className="picker-region" aria-label="Emoji source">
          <div className="emoji-panel-shell">
            <EmojiPicker emoji={getEmojiLayer(editor.design).source.grapheme} onPick={selectEmoji} />
          </div>
          <div className="layers-panel-shell">
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
          </div>
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
          {hasConflicts && (
            <div ref={conflictPanelRef} tabIndex={-1} className="conflict-resolution-anchor">
              <ConflictResolutionPanel
                projects={presentedProjects}
                renderer={services.renderer}
                onResolve={(id, resolution) => void resolveProjectConflict(id, resolution)}
              />
            </div>
          )}
          <StarredProjectsBar
            projects={presentedProjects}
            renderer={services.renderer}
            onOpen={(id) => void openProject(id)}
            onUseAsTemplate={(id) => void createFromTemplate(id)}
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
