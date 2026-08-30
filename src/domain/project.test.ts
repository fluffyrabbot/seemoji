import { describe, expect, it } from 'vitest';
import { DEFAULT_DESIGN } from './design';
import { createProject, decodeProject } from './project';

describe('project', () => {
  it('creates and strictly decodes a durable project', () => {
    const project = createProject({
      id: 'project-1',
      name: '  Poster  ',
      design: DEFAULT_DESIGN,
      createdAt: 10,
      starredAt: 12,
      updatedAt: 14,
    });
    expect(project).toMatchObject({
      name: 'Poster',
      starredAt: 12,
      schemaVersion: 2,
      conflict: null,
    });
    expect(decodeProject(project)).toEqual({ ok: true, value: project });
  });

  it('rejects invalid identity, time ordering, and designs', () => {
    expect(decodeProject({ schemaVersion: 2, id: '', revision: 0, name: 'Bad', design: DEFAULT_DESIGN,
      createdAt: 2, updatedAt: 1, starredAt: null, conflict: null }).ok).toBe(false);
    expect(decodeProject({ schemaVersion: 2, id: 'bad', revision: 0, name: 'Bad', design: {},
      createdAt: 1, updatedAt: 1, starredAt: null, conflict: null }).ok).toBe(false);
  });

  it('strictly decodes conflict lineage', () => {
    const conflict = createProject({
      id: 'copy',
      name: 'Copy',
      design: DEFAULT_DESIGN,
      createdAt: 20,
      conflict: { sourceProjectId: 'source', sourceRevision: 3, createdAt: 20 },
    });
    expect(decodeProject(conflict)).toEqual({ ok: true, value: conflict });
    expect(decodeProject({
      ...conflict,
      conflict: { sourceProjectId: 'copy', sourceRevision: 3, createdAt: 20 },
    }).ok).toBe(false);
  });
});
