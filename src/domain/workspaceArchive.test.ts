import { describe, expect, it } from 'vitest';
import { DEFAULT_DESIGN } from './design';
import { createProject } from './project';
import { createWorkspaceArchive, decodeWorkspaceArchive } from './workspaceArchive';

const project = (id: string) => createProject({
  id,
  revision: 1,
  name: id,
  design: DEFAULT_DESIGN,
  createdAt: 1,
});

describe('workspace archive', () => {
  it('strictly round-trips a complete workspace and omission details', () => {
    const archive = createWorkspaceArchive({
      exportedAt: 10,
      activeProjectId: 'one',
      projects: [project('one')],
      omissions: [{
        recordId: 'broken',
        error: 'design is invalid',
        contentHash: 'fnv1a32:01234567',
        byteSize: 42,
      }],
    });
    expect(decodeWorkspaceArchive(archive)).toEqual({ ok: true, value: archive });
  });

  it('rejects duplicate identities, missing active projects, and invalid records', () => {
    const valid = createWorkspaceArchive({
      exportedAt: 10,
      activeProjectId: 'one',
      projects: [project('one')],
    });
    expect(decodeWorkspaceArchive({ ...valid, projects: [project('one'), project('one')] }).ok)
      .toBe(false);
    expect(decodeWorkspaceArchive({ ...valid, activeProjectId: 'missing' }).ok).toBe(false);
    expect(decodeWorkspaceArchive({ ...valid, projects: [{}] }).ok).toBe(false);
  });

  it('rejects missing and cyclic conflict lineage', () => {
    const source = project('source');
    const conflict = createProject({
      id: 'conflict',
      revision: 1,
      name: 'Conflict',
      design: DEFAULT_DESIGN,
      createdAt: 2,
      conflict: { sourceProjectId: source.id, sourceRevision: 1, createdAt: 2 },
    });
    const valid = createWorkspaceArchive({
      exportedAt: 10,
      activeProjectId: conflict.id,
      projects: [source, conflict],
    });
    expect(decodeWorkspaceArchive({ ...valid, projects: [conflict] }).ok).toBe(false);
    expect(decodeWorkspaceArchive({
      ...valid,
      projects: [
        { ...source, conflict: { sourceProjectId: conflict.id, sourceRevision: 1, createdAt: 2 } },
        conflict,
      ],
    }).ok).toBe(false);
  });
});
