import { describe, expect, it } from 'vitest';

const foundationSources = import.meta.glob(
  [
    './domain/**/*.ts',
    './ports/**/*.ts',
    './application/**/*.ts',
    './adapters/browser/**/*.ts',
    '!./**/*.test.ts',
  ],
  { eager: true, import: 'default', query: '?raw' },
) as Record<string, string>;

const FRAMEWORK_IMPORT = /(?:from\s+|import\s*)['"](?:react|react-dom|preact)(?:\/[^'"]*)?['"]/;
const UI_IMPORT = /(?:from\s+|import\s*)['"][^'"]*\/ui(?:\/[^'"]*)?['"]/;

describe('framework boundaries', () => {
  it('keeps domain, ports, application, and rendering adapters framework-independent', () => {
    expect(Object.keys(foundationSources).length).toBeGreaterThan(0);
    for (const [path, source] of Object.entries(foundationSources)) {
      expect(source, `${path} imports a UI framework`).not.toMatch(FRAMEWORK_IMPORT);
      expect(source, `${path} imports the UI layer`).not.toMatch(UI_IMPORT);
    }
  });
});
