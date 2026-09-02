import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  canRedo,
  canUndo,
  type EditorAction,
} from '../application/editor';
import type { AppServices, StorageHealth } from '../application/services';
import type {
  ProjectConflictResolution,
  WorkspaceSnapshot,
} from '../application/workspaceController';
import {
  DEFAULT_TRANSFORM,
  DESIGN_LIMITS,
  getEmojiLayer,
  getLayer,
  type DesignDocument,
  type SceneLayer,
} from '../domain/design';
import { decodeDesignDocument } from '../domain/designCodec';
import { decodeProject, type Project } from '../domain/project';
import type { ProjectQuarantineRecord } from '../domain/projectQuarantine';
import { layerWorldBounds, unionWorldBounds } from '../domain/sceneGeometry';
import EditorExperience from './experiments/EditorExperience';
import type { EditorExperimentClient } from './experiments/contracts';
import type {
  BrushSettings,
  CanvasSettings,
  EditorPageCommands,
  EditorPageViewModel,
  EditorTool,
  Notice,
} from './editor/contracts';

export type { Notice } from './editor/contracts';

interface Props {
  readonly services: AppServices;
  readonly experiments: EditorExperimentClient;
}

const EMPTY_PROJECTS: readonly Project[] = [];
const EMPTY_WORKSPACE_ISSUES: WorkspaceSnapshot['issues'] = [];

export default function App({ services, experiments }: Props) {
  const subscribeToWorkspace = useCallback(
    (listener: () => void) => services.workspace.subscribe(listener),
    [services.workspace],
  );
  const readWorkspace = useCallback(
    () => services.workspace.getSnapshot(),
    [services.workspace],
  );
  const session = useSyncExternalStore(
    subscribeToWorkspace,
    readWorkspace,
    readWorkspace,
  );
  const packState = useSyncExternalStore(
    services.packs.subscribe,
    services.packs.getSnapshot,
    services.packs.getSnapshot,
  );
  const editor = session.editor;
  const projects = session.workspace?.projects ?? EMPTY_PROJECTS;
  const projectName = session.projectName;
  const currentProjectId = session.workspace?.activeProject.id ?? null;
  const workspaceIssues = session.workspace?.issues ?? EMPTY_WORKSPACE_ISSUES;
  const [storageHealth, setStorageHealth] = useState<StorageHealth | null>(null);
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [persistenceStatus, setPersistenceStatus] =
    useState<'loading' | 'saved' | 'saving' | 'reconciling' | 'conflict' | 'error'>('loading');
  const workspaceBusy = session.workspaceMutationInProgress
    || persistenceStatus === 'reconciling';
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
  const previousProjectId = useRef<string | null>(null);

  const dispatch = useCallback((action: EditorAction) => {
    if (!workspaceBusy) services.workspace.dispatch(action);
  }, [services.workspace, workspaceBusy]);

  const dispatchForEditorSession = useCallback((
    expectedEpoch: number,
    action: EditorAction,
  ) => {
    const current = services.workspace.getSnapshot();
    if (
      current.editorSessionEpoch === expectedEpoch
      && services.workspace.acceptsEditorMutations
    ) {
      services.workspace.dispatch(action);
    }
  }, [services.workspace]);

  const changeProjectName = useCallback((name: string) => {
    if (!workspaceBusy) services.workspace.renameActive(name);
  }, [services.workspace, workspaceBusy]);

  const showNotice = useCallback((next: Notice) => {
    window.clearTimeout(noticeTimer.current);
    setNotice(next);
    if (next.kind === 'status') {
      noticeTimer.current = window.setTimeout(() => setNotice(null), 4_000);
    }
  }, []);

  useEffect(() => () => window.clearTimeout(noticeTimer.current), []);

  useEffect(() => {
    if (previousProjectId.current === currentProjectId) return;
    previousProjectId.current = currentProjectId;
    setSelectionGroups([]);
    setTool('select');
  }, [currentProjectId]);

  useEffect(() => {
    let active = true;
    let guardedStatus = services.workspace.persistenceStatus;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      void services.workspace.flush().catch(() => undefined);
      event.preventDefault();
      event.returnValue = '';
    };
    const updateNavigationGuard = () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      if (
        guardedStatus === 'saving'
        || guardedStatus === 'reconciling'
        || guardedStatus === 'error'
        || services.workspace.getSnapshot().workspaceMutationInProgress
      ) {
        window.addEventListener('beforeunload', onBeforeUnload);
      }
    };
    const unsubscribe = services.workspace.subscribeStatus((status) => {
      if (!active) return;
      guardedStatus = status;
      setPersistenceStatus(status);
      // Status listeners run inside updateActive(), so the guard exists before
      // another task can navigate away from a newly accepted edit.
      updateNavigationGuard();
    });
    const unsubscribeNavigationGuard = services.workspace.subscribe(updateNavigationGuard);
    updateNavigationGuard();
    services.workspace.load()
      .then((workspace) => {
        if (!active) return;
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
      unsubscribeNavigationGuard();
      window.removeEventListener('beforeunload', onBeforeUnload);
      services.workspace.dispose();
    };
  }, [services.workspace, showNotice]);

  useEffect(() => {
    let active = true;
    void services.packs.load().then((snapshot) => {
      if (active && snapshot.status === 'error') {
        showNotice({
          kind: 'error',
          message: `Emoji library catalog unavailable: ${snapshot.error ?? 'unknown error'}`,
        });
      }
    });
    return () => { active = false; };
  }, [services.packs, showNotice]);

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
    const current = services.workspace.getSnapshot();
    const layer = current.editor.selectedLayerIds
      .map((id) => getLayer(current.editor.design, id))
      .find((candidate) => candidate?.kind === 'emoji') ?? getEmojiLayer(current.editor.design);
    const result = await services.packs.pick(grapheme, layer.id);
    if (result.kind === 'rejected') showNotice({ kind: 'error', message: result.error });
    return result.kind === 'applied';
  };

  const changePackSnapshot = async (target: typeof packState.selected): Promise<void> => {
    const current = services.workspace.getSnapshot();
    const layer = current.editor.selectedLayerIds
      .map((id) => getLayer(current.editor.design, id))
      .find((candidate) => candidate?.kind === 'emoji') ?? getEmojiLayer(current.editor.design);
    const result = await services.packs.changeSnapshot(target, layer.id);
    if (result.kind === 'rejected') showNotice({ kind: 'error', message: result.error });
  };

  const applyWorkspace = (_workspace: WorkspaceSnapshot) => {
    setTool('select');
    setSelectionGroups([]);
  };

  const saveNow = async () => {
    try {
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
      await services.workspace.toggleStar(currentProjectId);
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

  const commands: EditorPageCommands = {
    history: {
      undo: () => dispatch({ type: 'undo' }),
      redo: () => dispatch({ type: 'redo' }),
    },
    projects: {
      changeName: changeProjectName,
      create: newProject,
      open: openProject,
      save: saveNow,
      toggleStar,
      delete: deleteProject,
      export: exportProject,
      import: importProject,
      useAsTemplate: createFromTemplate,
      resolveConflict: resolveProjectConflict,
    },
    recovery: {
      exportWorkspace: exportWorkspaceArchive,
      importWorkspace: importWorkspaceArchive,
      exportQuarantined: exportQuarantinedRecord,
      purgeQuarantined: purgeQuarantinedRecord,
      requestPersistentStorage,
    },
    emoji: {
      select: selectEmoji,
      changePack: changePackSnapshot,
    },
    layers: {
      select: (layerId, toggle) => toggle
        ? dispatch({ type: 'select-layer', layerId, toggle: true })
        : dispatch({
            type: 'select-layers',
            layerIds: expandGroupedSelection([layerId]),
          }),
      toggleVisibility: (layerId) => dispatch({ type: 'toggle-layer', layerId }),
      move: (layerId, direction) => dispatch({ type: 'move-layer', layerId, direction }),
      remove: (layerId) => dispatch({ type: 'remove-layer', layerId }),
      rename: (layerId, name) => dispatch({ type: 'rename-layer', layerId, name }),
      duplicate: (layerId) => {
        const layer = editor.design.layers.find((candidate) => candidate.id === layerId);
        if (layer) {
          dispatch({
            type: 'duplicate-layer',
            layerId,
            duplicateId: crypto.randomUUID(),
            name: `${layer.name} copy`.slice(0, 80),
          });
        }
      },
      changeOpacity: (layerId, opacity, historyGroup) =>
        dispatch({ type: 'set-layer-opacity', layerId, opacity, historyGroup }),
      commit: () => dispatch({ type: 'commit-history-group' }),
      add: addLayer,
      update: (layer, historyGroup) => dispatch({
        type: 'update-layer',
        layer,
        ...(historyGroup ? { historyGroup } : {}),
      }),
      align: alignSelected,
      distribute: distributeSelected,
      copySelection,
      pasteSelection,
      duplicateSelection,
      groupSelection,
      ungroupSelection,
    },
    canvas: {
      changeTool: setTool,
      changeBrush: setBrush,
      changeSettings: setCanvasSettings,
      paintStroke: (layerId, stroke, createLayerName) =>
        dispatchForEditorSession(session.editorSessionEpoch, {
          type: 'paint-stroke',
          layerId,
          stroke,
          ...(createLayerName ? { createLayerName } : {}),
        }),
      maskStroke: (layerId, stroke) =>
        dispatchForEditorSession(session.editorSessionEpoch, {
          type: 'mask-stroke',
          layerId,
          stroke,
        }),
      changeTransforms: (updates, historyGroup) =>
        dispatchForEditorSession(session.editorSessionEpoch, {
          type: 'update-layer-transforms',
          updates,
          ...(historyGroup ? { historyGroup } : {}),
        }),
      changeSelection: (layerIds) =>
        dispatchForEditorSession(session.editorSessionEpoch, {
          type: 'select-layers',
          layerIds: expandGroupedSelection(layerIds),
        }),
      addRasterLayer: (layer) =>
        dispatchForEditorSession(session.editorSessionEpoch, { type: 'add-layer', layer }),
      commitTransform: () =>
        dispatchForEditorSession(session.editorSessionEpoch, { type: 'commit-history-group' }),
      changeSize: (size) =>
        dispatchForEditorSession(session.editorSessionEpoch, { type: 'set-size', size }),
    },
    controls: {
      changeProportionsLocked: setProportionsLocked,
      changeTransform: (transform, historyGroup) => dispatch({
        type: 'update-transform',
        transform,
        ...(historyGroup ? { historyGroup } : {}),
      }),
      changeAppearance: (appearance, historyGroup) => dispatch({
        type: 'update-appearance',
        appearance,
        ...(historyGroup ? { historyGroup } : {}),
      }),
      applyStyle: (transform, appearance) =>
        dispatch({ type: 'apply-layer-style', transform, appearance }),
      commit: () => dispatch({ type: 'commit-history-group' }),
      reset: () => dispatch({ type: 'reset' }),
    },
    notices: {
      show: showNotice,
      dismiss: () => setNotice(null),
    },
  };

  let model: EditorPageViewModel;
  if (currentProjectId === null) {
    model = {
      status: 'loading',
      persistenceStatus,
      notice,
    };
  } else {
    const pickerEmojiLayer = editor.selectedLayerIds
      .map((id) => getLayer(editor.design, id))
      .find((layer) => layer?.kind === 'emoji') ?? getEmojiLayer(editor.design);
    const attributionPacks = [...new Set(editor.design.layers
      .filter((layer) => layer.kind === 'emoji')
      .map((layer) => layer.source.pack))]
      .map((pack) => services.catalog.summaryFor(pack))
      .filter((summary) => summary !== null);
    model = {
      status: 'ready',
      editor,
      editorSessionEpoch: session.editorSessionEpoch,
      projectName,
      currentProjectId,
      projects: presentedProjects,
      persistenceStatus,
      workspaceBusy,
      recoveryBusy,
      storageHealth,
      workspaceIssues,
      hasConflicts,
      canUndo: canUndo(editor),
      canRedo: canRedo(editor),
      packs: packState,
      pickerEmoji: pickerEmojiLayer.source.grapheme,
      attributionPacks,
      proportionsLocked,
      tool,
      brush,
      canvasSettings,
      notice,
      catalog: services.catalog,
      renderer: services.renderer,
      assetDelivery: services.assetDelivery,
    };
  }

  return <EditorExperience
    model={model}
    commands={commands}
    experiments={experiments}
  />;

}
