import { decodeWorkspaceDocument, decodeWorkspaceDraft,
  type WorkspaceDocument, type WorkspaceDraft } from '../../domain/workspaceDocument';
import type { DocumentRepository } from '../../ports/documentRepository';

const DOCUMENTS_KEY = 'seemoji:documents:v1';
const DRAFT_KEY = 'seemoji:draft:v1';

export class DocumentRepositoryError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'DocumentRepositoryError';
  }
}

export class LocalDocumentRepository implements DocumentRepository {
  readonly storage: Storage | null;

  constructor(storage: Storage | null = globalThis.localStorage ?? null) {
    this.storage = storage;
  }

  async list(): Promise<readonly WorkspaceDocument[]> {
    if (!this.storage) throw new DocumentRepositoryError('Browser storage is unavailable');
    try {
      const raw = this.storage.getItem(DOCUMENTS_KEY);
      if (!raw) return [];
      const value: unknown = JSON.parse(raw);
      if (!Array.isArray(value)) throw new DocumentRepositoryError('The document library is corrupt');
      return value.map((entry, index) => {
        const decoded = decodeWorkspaceDocument(entry);
        if (!decoded.ok) throw new DocumentRepositoryError(`Document ${index + 1}: ${decoded.error}`);
        return decoded.value;
      }).sort((a, b) => b.updatedAt - a.updatedAt);
    } catch (cause) {
      if (cause instanceof DocumentRepositoryError) throw cause;
      throw new DocumentRepositoryError('The document library could not be read', { cause });
    }
  }

  async save(document: WorkspaceDocument): Promise<readonly WorkspaceDocument[]> {
    const decoded = decodeWorkspaceDocument(document);
    if (!decoded.ok) throw new DocumentRepositoryError(decoded.error);
    const next = [decoded.value, ...(await this.list()).filter((entry) => entry.id !== document.id)]
      .sort((a, b) => b.updatedAt - a.updatedAt);
    this.#write(DOCUMENTS_KEY, next);
    return next;
  }

  async remove(id: string): Promise<readonly WorkspaceDocument[]> {
    const next = (await this.list()).filter((document) => document.id !== id);
    this.#write(DOCUMENTS_KEY, next);
    return next;
  }

  async loadDraft(): Promise<WorkspaceDraft | null> {
    if (!this.storage) throw new DocumentRepositoryError('Browser storage is unavailable');
    const raw = this.storage.getItem(DRAFT_KEY);
    if (!raw) return null;
    try {
      const decoded = decodeWorkspaceDraft(JSON.parse(raw));
      if (!decoded.ok) throw new DocumentRepositoryError(decoded.error);
      return decoded.value;
    } catch (cause) {
      if (cause instanceof DocumentRepositoryError) throw cause;
      throw new DocumentRepositoryError('The recovery draft is corrupt', { cause });
    }
  }

  async saveDraft(draft: WorkspaceDraft): Promise<void> {
    const decoded = decodeWorkspaceDraft(draft);
    if (!decoded.ok) throw new DocumentRepositoryError(decoded.error);
    this.#write(DRAFT_KEY, decoded.value);
  }

  async clearDraft(): Promise<void> {
    if (!this.storage) throw new DocumentRepositoryError('Browser storage is unavailable');
    this.storage.removeItem(DRAFT_KEY);
  }

  #write(key: string, value: unknown) {
    if (!this.storage) throw new DocumentRepositoryError('Browser storage is unavailable');
    try {
      this.storage.setItem(key, JSON.stringify(value));
    } catch (cause) {
      throw new DocumentRepositoryError('Browser storage could not be updated', { cause });
    }
  }
}
