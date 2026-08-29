import type { WorkspaceDocument, WorkspaceDraft } from '../domain/workspaceDocument';

export interface DocumentRepository {
  list(): Promise<readonly WorkspaceDocument[]>;
  save(document: WorkspaceDocument): Promise<readonly WorkspaceDocument[]>;
  remove(id: string): Promise<readonly WorkspaceDocument[]>;
  loadDraft(): Promise<WorkspaceDraft | null>;
  saveDraft(draft: WorkspaceDraft): Promise<void>;
  clearDraft(): Promise<void>;
}
