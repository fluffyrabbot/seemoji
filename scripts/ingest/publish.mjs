import { execFile } from 'node:child_process';
import {
  cp,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { REPOSITORY_ROOT, readJson } from './canonical.mjs';

const execute = promisify(execFile);
const listTreeDirectories = async (repository, treeish) => (
  await execute('git', ['-C', repository, 'ls-tree', '-d', '--name-only', treeish])
).stdout.trim().split('\n').filter(Boolean);
const destinationFlag = process.argv.indexOf('--destination');
const destinationArg = destinationFlag >= 0 ? process.argv[destinationFlag + 1] : null;
if (!destinationArg) throw new Error('usage: publish.mjs --destination <snapshot-repo-clone>');

const destination = resolve(destinationArg);
await execute('git', ['-C', destination, 'rev-parse', '--show-toplevel']);
const status = (await execute('git', ['-C', destination, 'status', '--porcelain'])).stdout.trim();
if (status) throw new Error('snapshot repository must be clean before staging a snapshot');

const pins = await readJson(resolve(REPOSITORY_ROOT, 'scripts/ingest/pins.json'));
const origin = (await execute('git', [
  '-C', destination, 'remote', 'get-url', 'origin',
])).stdout.trim().replace(/\.git$/, '');
const originRepository = origin
  .replace(/^git@github\.com:/, '')
  .replace(/^https:\/\/github\.com\//, '');
if (originRepository !== pins.snapshotRepo) {
  throw new Error(`snapshot repository origin must be ${pins.snapshotRepo}`);
}

// Every version tree reachable from an existing release tag is immutable. New
// version trees are allowed; modifying, deleting, or adding a style beneath an
// already-published version is not.
const tags = (await execute('git', [
  '-C', destination, 'tag', '--list', 'v[0-9]*', '--sort=version:refname',
])).stdout.trim().split('\n').filter(Boolean);
for (const tag of tags) {
  const packs = await listTreeDirectories(destination, `${tag}:packs`);
  const roots = (await Promise.all(packs.map(async (pack) => {
    const versions = await listTreeDirectories(destination, `${tag}:packs/${pack}`);
    return versions.map((version) => `packs/${pack}/${version}`);
  }))).flat();
  for (const root of roots) {
    let publishedTree;
    let currentTree;
    try {
      [publishedTree, currentTree] = await Promise.all([
        execute('git', ['-C', destination, 'rev-parse', `${tag}:${root}`]),
        execute('git', ['-C', destination, 'rev-parse', `HEAD:${root}`]),
      ]);
    } catch {
      throw new Error(`published snapshot is write-once: ${root} from ${tag} is missing`);
    }
    if (publishedTree.stdout.trim() !== currentTree.stdout.trim()) {
      throw new Error(`published snapshot is write-once: ${root} differs from ${tag}`);
    }
  }
}

const manifest = await readJson(resolve(
  REPOSITORY_ROOT,
  `public/packs/twemoji/${pins.packs.twemoji.snapshotVersion}/manifest.json`,
));
const expectedRoot = `https://cdn.jsdelivr.net/gh/${pins.snapshotRepo}@v1.0.0/packs/twemoji/${manifest.version}/`;
if (manifest.assetRoot !== expectedRoot) {
  throw new Error(`manifest assetRoot must be ${expectedRoot}`);
}

const mergeFlatSnapshot = async (source, target, label) => {
  const targetExists = await stat(target).then(() => true, () => false);
  if (!targetExists) {
    await cp(source, target, { recursive: true, errorOnExist: true });
    return;
  }
  const sourceFiles = (await readdir(source)).sort();
  const targetFiles = (await readdir(target)).sort();
  if (JSON.stringify(sourceFiles) !== JSON.stringify(targetFiles)) {
    throw new Error(`published snapshot is write-once: ${label} inventory differs`);
  }
  for (const name of sourceFiles) {
    const [candidate, published] = await Promise.all([
      readFile(join(source, name)),
      readFile(join(target, name)),
    ]);
    if (!candidate.equals(published)) {
      throw new Error(`published snapshot is write-once: ${label}/${name} differs`);
    }
  }
};

const additionalManifests = [
  {
    path: `public/packs/noto/${pins.packs.noto.snapshotVersion}/manifest.json`,
    expectedRoot: `https://cdn.jsdelivr.net/gh/${pins.snapshotRepo}@v1.1.0/packs/noto/${pins.packs.noto.snapshotVersion}/`,
  },
  ...pins.packs.fluent.versions.flatMap((version) => version.styles.map((style) => ({
    path: `public/packs/fluent/${version.snapshotVersion}/${style}/manifest.json`,
    expectedRoot: `https://cdn.jsdelivr.net/gh/${pins.snapshotRepo}@${version.snapshotTag}/packs/fluent/${version.snapshotVersion}/${style}/`,
  }))),
  {
    path: `public/packs/openmoji/${pins.packs.openmoji.snapshotVersion}/color/manifest.json`,
    expectedRoot: `https://cdn.jsdelivr.net/gh/${pins.snapshotRepo}@v1.2.0/packs/openmoji/${pins.packs.openmoji.snapshotVersion}/color/`,
  },
  ...['fxemoji', 'emojitwo', 'blobmoji', 'serenity'].map((pack) => ({
    path: `public/packs/${pack}/${pins.packs[pack].snapshotVersion}/manifest.json`,
    expectedRoot: `https://cdn.jsdelivr.net/gh/${pins.snapshotRepo}@v1.3.0/packs/${pack}/${pins.packs[pack].snapshotVersion}/`,
  })),
];
for (const expected of additionalManifests) {
  const candidate = await readJson(resolve(REPOSITORY_ROOT, expected.path));
  if (candidate.assetRoot !== expected.expectedRoot) {
    throw new Error(`manifest assetRoot must be ${expected.expectedRoot}`);
  }
}

const temporary = await mkdtemp(join(tmpdir(), 'seemoji-publish-'));
try {
  const upstream = join(temporary, 'twemoji');
  await execute('git', [
    'clone', '--depth', '1', '--branch', pins.packs.twemoji.ref, '--single-branch',
    pins.packs.twemoji.repository, upstream,
  ]);
  const source = join(upstream, 'assets/svg');
  const target = join(destination, 'packs/twemoji', manifest.version, 'svg');
  const targetExists = await stat(target).then(() => true, () => false);
  const sourceFiles = (await readdir(source)).filter((name) => name.endsWith('.svg')).sort();
  const expectedFiles = manifest.glyphs.map((glyph) => `${glyph}.svg`).sort();
  if (JSON.stringify(sourceFiles) !== JSON.stringify(expectedFiles)) {
    throw new Error('upstream still inventory does not match the committed manifest');
  }
  if (targetExists) {
    const targetFiles = (await readdir(target)).filter((name) => name.endsWith('.svg')).sort();
    if (JSON.stringify(targetFiles) !== JSON.stringify(sourceFiles)) {
      throw new Error('published snapshot inventory would change');
    }
    for (const name of sourceFiles) {
      const [upstreamBytes, publishedBytes] = await Promise.all([
        readFile(join(source, name)),
        readFile(join(target, name)),
      ]);
      if (!upstreamBytes.equals(publishedBytes)) {
        throw new Error(`published snapshot is write-once: ${name} differs`);
      }
    }
    console.log(`Verified immutable Twemoji ${manifest.version} snapshot (${sourceFiles.length} stills)`);
  } else {
    await cp(source, target, { recursive: true, errorOnExist: true });
    console.log(`Staged Twemoji ${manifest.version} snapshot (${sourceFiles.length} stills)`);
  }

  const staged = join(temporary, 'staged');
  for (const pack of [
    'noto', 'fluent', 'openmoji', 'fxemoji', 'emojitwo', 'blobmoji', 'serenity',
  ]) {
    const result = await execute(process.execPath, [
      resolve(REPOSITORY_ROOT, `scripts/ingest/${pack}.mjs`),
      '--stills', staged,
    ], { maxBuffer: 10 * 1024 * 1024 });
    process.stdout.write(result.stdout);
  }
  await mergeFlatSnapshot(
    join(staged, 'packs/noto', pins.packs.noto.snapshotVersion, 'svg'),
    join(destination, 'packs/noto', pins.packs.noto.snapshotVersion, 'svg'),
    `noto/${pins.packs.noto.snapshotVersion}/svg`,
  );
  for (const version of pins.packs.fluent.versions) {
    for (const style of version.styles) {
      await mergeFlatSnapshot(
        join(staged, 'packs/fluent', version.snapshotVersion, style, 'svg'),
        join(destination, 'packs/fluent', version.snapshotVersion, style, 'svg'),
        `fluent/${version.snapshotVersion}/${style}/svg`,
      );
    }
  }
  await mergeFlatSnapshot(
    join(staged, 'packs/openmoji', pins.packs.openmoji.snapshotVersion, 'color/svg'),
    join(destination, 'packs/openmoji', pins.packs.openmoji.snapshotVersion, 'color/svg'),
    `openmoji/${pins.packs.openmoji.snapshotVersion}/color/svg`,
  );
  for (const pack of ['fxemoji', 'emojitwo', 'blobmoji', 'serenity']) {
    const format = pins.packs[pack].format;
    await mergeFlatSnapshot(
      join(staged, 'packs', pack, pins.packs[pack].snapshotVersion, format),
      join(destination, 'packs', pack, pins.packs[pack].snapshotVersion, format),
      `${pack}/${pins.packs[pack].snapshotVersion}/${format}`,
    );
  }
} finally {
  await rm(temporary, { recursive: true, force: true });
}
