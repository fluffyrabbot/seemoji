import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_DESIGN } from '../../domain/design';
import { LocalDocumentRepository } from './localDocumentRepository';

describe('local document repository', () => {
  beforeEach(() => localStorage.clear());

  it('saves, orders, removes, and restores validated documents', async () => {
    const repository = new LocalDocumentRepository(localStorage);
    await repository.save({ version: 1, id: 'old', name: 'Old', design: DEFAULT_DESIGN, updatedAt: 1 });
    const saved = await repository.save({ version: 1, id: 'new', name: 'New', design: DEFAULT_DESIGN, updatedAt: 2 });
    expect(saved.map((document) => document.id)).toEqual(['new', 'old']);
    expect((await repository.remove('new')).map((document) => document.id)).toEqual(['old']);
  });

  it('keeps a separate crash-recovery draft', async () => {
    const repository = new LocalDocumentRepository(localStorage);
    const draft = { version: 1 as const, documentId: null, name: 'Unsaved', design: DEFAULT_DESIGN, updatedAt: 3 };
    await repository.saveDraft(draft);
    expect(await repository.loadDraft()).toEqual(draft);
    await repository.clearDraft();
    expect(await repository.loadDraft()).toBeNull();
  });
});
