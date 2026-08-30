import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  createReleaseManifest,
  verifyReleaseDirectory,
} from './release-manifest.mjs';

const COMMIT = 'c'.repeat(40);

const withReleaseDirectory = async (run) => {
  const directory = await mkdtemp(join(tmpdir(), 'seemoji-release-'));
  try {
    await mkdir(join(directory, 'assets'));
    await writeFile(
      join(directory, 'index.html'),
      '<link rel="stylesheet" href="/assets/index-1234.css"><script type="module" src="/assets/index-1234.js"></script>',
    );
    await writeFile(join(directory, 'assets/index-1234.css'), 'body { color: black; }\n');
    await writeFile(join(directory, 'assets/index-1234.js'), 'console.log("release");\n');
    await writeFile(join(directory, '_headers'), '/*\n  Cache-Control: public, max-age=0, must-revalidate\n');
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
};

test('creates a deterministic manifest and verifies the exact artifact', async () => {
  await withReleaseDirectory(async (directory) => {
    const first = await createReleaseManifest(directory, COMMIT);
    const second = await createReleaseManifest(directory, COMMIT);
    assert.deepEqual(second, first);
    assert.deepEqual(first.entrypoints, {
      modules: ['/assets/index-1234.js'],
      stylesheets: ['/assets/index-1234.css'],
    });
    assert.deepEqual(first.files.map((file) => file.path), [
      '/assets/index-1234.css',
      '/assets/index-1234.js',
      '/index.html',
    ]);
    assert.equal((await verifyReleaseDirectory(directory, COMMIT)).commit, COMMIT);
  });
});

test('rejects mutation after the release manifest is created', async () => {
  await withReleaseDirectory(async (directory) => {
    await createReleaseManifest(directory, COMMIT);
    await writeFile(join(directory, 'assets/index-1234.js'), 'console.log("mutated");\n');
    await assert.rejects(
      verifyReleaseDirectory(directory, COMMIT),
      /does not match its manifest digest/,
    );
  });
});

test('rejects an unmanifested file added after verification', async () => {
  await withReleaseDirectory(async (directory) => {
    await createReleaseManifest(directory, COMMIT);
    await writeFile(join(directory, 'surprise.txt'), 'not part of the verified release');
    await assert.rejects(
      verifyReleaseDirectory(directory, COMMIT),
      /contents do not exactly match/,
    );
  });
});
