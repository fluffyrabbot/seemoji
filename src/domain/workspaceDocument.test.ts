import { describe, expect, it } from 'vitest';
import { DEFAULT_DESIGN } from './design';
import { decodeWorkspaceDocument, decodeWorkspaceDraft } from './workspaceDocument';

describe('workspace documents', () => {
  it('strictly decodes named documents and recovery drafts', () => {
    const document = { version: 1 as const, id: 'doc-1', name: '  Poster  ', design: DEFAULT_DESIGN, updatedAt: 42 };
    expect(decodeWorkspaceDocument(document)).toMatchObject({ ok: true, value: { name: 'Poster' } });
    expect(decodeWorkspaceDraft({ version: 1, documentId: null, name: 'Draft',
      design: DEFAULT_DESIGN, updatedAt: 43 })).toMatchObject({ ok: true, value: { documentId: null } });
  });

  it('rejects malformed documents before storage or import', () => {
    expect(decodeWorkspaceDocument({ version: 1, id: '', name: '', design: {}, updatedAt: -1 }).ok).toBe(false);
  });
});
