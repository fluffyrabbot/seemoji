import type { DesignDocument } from '../domain/design';
import type {
  ProjectQuarantineExport,
  ProjectQuarantineRecord,
} from '../domain/projectQuarantine';
import type { WorkspaceArchive } from '../domain/workspaceArchive';
import {
  editorReducer,
  INITIAL_EDITOR_STATE,
  type EditorAction,
  type EditorState,
} from './editor';
import {
  WorkspaceController,
  type ProjectConflictResolution,
  type WorkspaceArchiveImportResult,
  type WorkspacePersistenceStatus,
  type WorkspaceSnapshot,
} from './workspaceController';

export interface EditorWorkspaceSnapshot {
  readonly workspace: WorkspaceSnapshot | null;
  readonly editor: EditorState;
  /** The editable field value; the durable project normalizes an empty draft on save. */
  readonly projectName: string;
  /** True while an exclusive workspace mutation is crossing the repository boundary. */
  readonly workspaceMutationInProgress: boolean;
  /** Monotonic design-session epoch for rejecting stale async editor continuations. */
  readonly editorSessionEpoch: number;
}

/**
 * The synchronous authority for the editor session and its durable workspace.
 * React renders snapshots from this store; every accepted design/name mutation is
 * placed in WorkspaceController's pending journal before the view is notified.
 */
export class EditorWorkspaceStore {
  readonly #controller: WorkspaceController;
  readonly #listeners = new Set<() => void>();
  readonly #unsubscribeWorkspace: () => void;
  #snapshot: EditorWorkspaceSnapshot = {
    workspace: null,
    editor: INITIAL_EDITOR_STATE,
    projectName: 'Untitled design',
    workspaceMutationInProgress: false,
    editorSessionEpoch: 0,
  };
  #disposed = false;

  constructor(controller: WorkspaceController) {
    this.#controller = controller;
    this.#unsubscribeWorkspace = controller.subscribeWorkspace((workspace) => {
      if (!this.#disposed) this.#adopt(workspace, 'auto');
    });
  }

  get persistenceStatus(): WorkspacePersistenceStatus {
    return this.#controller.persistenceStatus;
  }

  get acceptsEditorMutations(): boolean {
    return !this.#snapshot.workspaceMutationInProgress
      && this.#controller.persistenceStatus !== 'reconciling';
  }

  getSnapshot(): EditorWorkspaceSnapshot {
    return this.#snapshot;
  }

  subscribe(listener: () => void): () => void {
    this.#assertActive();
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  subscribeStatus(listener: (status: WorkspacePersistenceStatus) => void): () => void {
    this.#assertActive();
    return this.#controller.subscribeStatus(listener);
  }

  async load(): Promise<WorkspaceSnapshot> {
    this.#assertActive();
    return this.#adopt(await this.#controller.load(), true);
  }

  dispatch(action: EditorAction): EditorState {
    this.#assertActive();
    const current = this.#snapshot.editor;
    if (!this.acceptsEditorMutations) return current;
    const next = editorReducer(current, action);
    if (next === current) return current;

    let workspace = this.#snapshot.workspace;
    if (workspace && next.design !== current.design) {
      workspace = this.#controller.updateActive(this.#snapshot.projectName, next.design);
    }
    this.#set({ ...this.#snapshot, workspace, editor: next });
    return next;
  }

  renameActive(name: string): WorkspaceSnapshot {
    this.#assertActive();
    if (!this.#snapshot.workspace) throw new Error('Workspace has not loaded');
    if (!this.acceptsEditorMutations) return this.#snapshot.workspace;
    const workspace = this.#controller.updateActive(name, this.#snapshot.editor.design);
    this.#set({ ...this.#snapshot, workspace, projectName: name });
    return workspace;
  }

  snapshot(): WorkspaceSnapshot {
    this.#assertActive();
    return this.#controller.snapshot();
  }

  async flush(): Promise<void> {
    this.#assertActive();
    await this.#controller.flush();
    this.#adopt(this.#controller.snapshot(), 'auto');
  }

  async create(
    design?: DesignDocument,
    name?: string,
  ): Promise<WorkspaceSnapshot> {
    return this.#runWorkspaceMutation(() => this.#controller.create(design, name));
  }

  async activate(id: string): Promise<WorkspaceSnapshot> {
    this.#assertActive();
    if (this.#snapshot.workspace?.activeProject.id === id) return this.#controller.snapshot();
    return this.#runWorkspaceMutation(() => this.#controller.activate(id));
  }

  async deleteActive(): Promise<WorkspaceSnapshot> {
    return this.#runWorkspaceMutation(() => this.#controller.deleteActive());
  }

  async toggleStar(id: string): Promise<WorkspaceSnapshot> {
    return this.#runWorkspaceMutation(() => this.#controller.toggleStar(id));
  }

  async useAsTemplate(id: string): Promise<WorkspaceSnapshot> {
    return this.#runWorkspaceMutation(() => this.#controller.useAsTemplate(id));
  }

  async resolveConflict(
    conflictProjectId: string,
    resolution: ProjectConflictResolution,
  ): Promise<WorkspaceSnapshot> {
    return this.#runWorkspaceMutation(
      () => this.#controller.resolveConflict(conflictProjectId, resolution),
    );
  }

  exportArchive(): Promise<WorkspaceArchive> {
    this.#assertActive();
    return this.#controller.exportArchive();
  }

  exportQuarantinedRecord(
    expected: ProjectQuarantineRecord,
  ): Promise<ProjectQuarantineExport> {
    this.#assertActive();
    return this.#controller.exportQuarantinedRecord(expected);
  }

  async purgeQuarantinedRecord(
    expected: ProjectQuarantineRecord,
  ): Promise<WorkspaceSnapshot> {
    return this.#runWorkspaceMutation(() => this.#controller.purgeQuarantinedRecord(expected));
  }

  async importArchive(value: unknown): Promise<WorkspaceArchiveImportResult> {
    this.#beginWorkspaceMutation();
    try {
      const result = await this.#controller.importArchive(value);
      this.#adopt(result.workspace, 'auto');
      return result;
    } finally {
      this.#endWorkspaceMutation();
    }
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#unsubscribeWorkspace();
    this.#listeners.clear();
    this.#controller.dispose();
  }

  #adopt(workspace: WorkspaceSnapshot, resetEditor: boolean | 'auto'): WorkspaceSnapshot {
    this.#assertActive();
    const currentWorkspace = this.#snapshot.workspace;
    const activeIdentityChanged = !currentWorkspace
      || currentWorkspace.activeProject.id !== workspace.activeProject.id;
    const activeDesignChanged = activeIdentityChanged
      || JSON.stringify(currentWorkspace.activeProject.design)
        !== JSON.stringify(workspace.activeProject.design);
    const activeNameChanged = activeIdentityChanged
      || currentWorkspace.activeProject.name !== workspace.activeProject.name;
    const shouldResetEditor = resetEditor === true
      || (resetEditor === 'auto' && activeDesignChanged);
    const shouldResetName = resetEditor === true
      || (resetEditor === 'auto' && activeNameChanged);
    const editor = shouldResetEditor
      ? editorReducer(this.#snapshot.editor, {
          type: 'load-design',
          design: workspace.activeProject.design,
        })
      : this.#snapshot.editor;
    const projectName = shouldResetName
      ? workspace.activeProject.name
      : this.#snapshot.projectName;
    if (
      currentWorkspace?.projects === workspace.projects
      && currentWorkspace.activeProject === workspace.activeProject
      && currentWorkspace.issues === workspace.issues
      && editor === this.#snapshot.editor
      && projectName === this.#snapshot.projectName
    ) {
      return workspace;
    }
    this.#set({
      ...this.#snapshot,
      workspace,
      editor,
      projectName,
      editorSessionEpoch: activeDesignChanged
        ? this.#snapshot.editorSessionEpoch + 1
        : this.#snapshot.editorSessionEpoch,
    });
    return workspace;
  }

  async #runWorkspaceMutation(
    operation: () => Promise<WorkspaceSnapshot>,
  ): Promise<WorkspaceSnapshot> {
    this.#beginWorkspaceMutation();
    try {
      return this.#adopt(await operation(), 'auto');
    } finally {
      this.#endWorkspaceMutation();
    }
  }

  #beginWorkspaceMutation(): void {
    this.#assertActive();
    if (
      this.#snapshot.workspaceMutationInProgress
      || this.#controller.persistenceStatus === 'reconciling'
    ) {
      throw new Error('Another workspace mutation is already in progress');
    }
    this.#set({ ...this.#snapshot, workspaceMutationInProgress: true });
  }

  #endWorkspaceMutation(): void {
    if (this.#disposed || !this.#snapshot.workspaceMutationInProgress) return;
    this.#set({ ...this.#snapshot, workspaceMutationInProgress: false });
  }

  #assertActive(): void {
    if (this.#disposed) throw new Error('Editor workspace store is disposed');
  }

  #set(snapshot: EditorWorkspaceSnapshot): void {
    this.#snapshot = snapshot;
    for (const listener of this.#listeners) listener();
  }
}
