import { describe, expect, it } from 'vitest';

const foundationSources = import.meta.glob(
  [
    './domain/**/*.ts',
    './ports/**/*.ts',
    './application/**/*.ts',
    './experimentation/**/*.ts',
    './adapters/browser/**/*.ts',
    '!./**/*.test.ts',
  ],
  { eager: true, import: 'default', query: '?raw' },
) as Record<string, string>;

const FRAMEWORK_IMPORT = /(?:from\s+|import\s*)['"](?:react|react-dom|preact)(?:\/[^'"]*)?['"]/;
const UI_IMPORT = /(?:from\s+|import\s*)['"][^'"]*\/ui(?:\/[^'"]*)?['"]/;
const EXPERIMENT_IMPORT = /(?:from\s+|import\s*)['"][^'"]*(?:experimentation|\/experiments)(?:\/[^'"]*)?['"]/;

const editorPresentationSources = import.meta.glob(
  ['./ui/editor/**/*.ts', './ui/editor/**/*.tsx', './ui/Preview.tsx'],
  { eager: true, import: 'default', query: '?raw' },
) as Record<string, string>;

describe('framework boundaries', () => {
  it('keeps domain, ports, application, and rendering adapters framework-independent', () => {
    expect(Object.keys(foundationSources).length).toBeGreaterThan(0);
    for (const [path, source] of Object.entries(foundationSources)) {
      expect(source, `${path} imports a UI framework`).not.toMatch(FRAMEWORK_IMPORT);
      expect(source, `${path} imports the UI layer`).not.toMatch(UI_IMPORT);
    }
  });

  it('keeps shared editor presentation independent of named experiments', () => {
    expect(Object.keys(editorPresentationSources).length).toBeGreaterThan(0);
    for (const [path, source] of Object.entries(editorPresentationSources)) {
      expect(source, `${path} imports experiment policy`).not.toMatch(EXPERIMENT_IMPORT);
    }
  });
});
