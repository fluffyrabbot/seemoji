import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

export const RELEASE_MANIFEST_PATH = '/release-manifest.json';

const RELEASE_MANIFEST_FILE = RELEASE_MANIFEST_PATH.slice(1);
const RELEASE_SCHEMA_VERSION = 1;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/;
const SAFE_PUBLIC_PATH = /^\/[A-Za-z0-9._/-]+$/;
const DEPLOYMENT_CONTROL_FILES = new Set(['_headers']);
const execFileAsync = promisify(execFile);

const fail = (message) => {
  throw new Error(message);
};

const sameValues = (left, right) =>
  left.length === right.length && left.every((value, index) => value === right[index]);

const assertExactKeys = (value, expected, context) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${context} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (!sameValues(actual, wanted)) {
    fail(`${context} has unexpected fields: ${actual.join(', ') || 'none'}`);
  }
};

const assertPublicPath = (path, context) => {
  if (
    typeof path !== 'string'
    || !SAFE_PUBLIC_PATH.test(path)
    || path.includes('//')
    || path.split('/').includes('..')
    || path === RELEASE_MANIFEST_PATH
  ) {
    fail(`${context} is not a safe public path`);
  }
};

const collectRelativeFiles = async (directory, relative = '') => {
  const entries = await readdir(join(directory, relative), { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const child = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) return collectRelativeFiles(directory, child);
    return entry.isFile() ? [child] : [];
  }));
  return nested.flat().sort();
};

const publicRelativeFiles = async (directory) =>
  (await collectRelativeFiles(directory)).filter((path) =>
    path !== RELEASE_MANIFEST_FILE && !DEPLOYMENT_CONTROL_FILES.has(path));

export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

export function findEntrypoints(html) {
  const modules = [];
  for (const [tag] of html.matchAll(/<script\b[^>]*>/gi)) {
    if (!/\btype=["']module["']/i.test(tag)) continue;
    const source = tag.match(/\bsrc=["']([^"']+\.js)["']/i)?.[1];
    if (source) modules.push(source);
  }

  const stylesheets = [];
  for (const [tag] of html.matchAll(/<link\b[^>]*>/gi)) {
    if (!/\brel=["']stylesheet["']/i.test(tag)) continue;
    const source = tag.match(/\bhref=["']([^"']+\.css)["']/i)?.[1];
    if (source) stylesheets.push(source);
  }

  const normalized = {
    modules: [...new Set(modules)].sort(),
    stylesheets: [...new Set(stylesheets)].sort(),
  };
  if (normalized.modules.length === 0) fail('Production HTML has no JavaScript module entrypoint');
  for (const path of [...normalized.modules, ...normalized.stylesheets]) {
    assertPublicPath(path, `Entrypoint ${path}`);
    if (!path.startsWith('/assets/')) fail(`Entrypoint ${path} is outside /assets/`);
  }
  return normalized;
}

export function validateReleaseManifest(value, expectedCommit) {
  assertExactKeys(value, ['schemaVersion', 'commit', 'entrypoints', 'files'], 'Release manifest');
  if (value.schemaVersion !== RELEASE_SCHEMA_VERSION) {
    fail(`Release manifest schema ${String(value.schemaVersion)} is unsupported`);
  }
  if (typeof value.commit !== 'string' || !COMMIT_PATTERN.test(value.commit)) {
    fail('Release manifest commit must be a lowercase full Git SHA');
  }
  if (expectedCommit !== undefined && value.commit !== expectedCommit) {
    fail(`Release manifest commit ${value.commit} does not match expected commit ${expectedCommit}`);
  }

  assertExactKeys(value.entrypoints, ['modules', 'stylesheets'], 'Release manifest entrypoints');
  const entrypoints = {
    modules: value.entrypoints.modules,
    stylesheets: value.entrypoints.stylesheets,
  };
  for (const [kind, paths] of Object.entries(entrypoints)) {
    if (!Array.isArray(paths) || (kind === 'modules' && paths.length === 0)) {
      fail(`Release manifest ${kind} must be ${kind === 'modules' ? 'a non-empty' : 'an'} array`);
    }
    if (!sameValues(paths, [...new Set(paths)].sort())) {
      fail(`Release manifest ${kind} must be sorted and unique`);
    }
    for (const path of paths) assertPublicPath(path, `Release manifest ${kind} path`);
  }

  if (!Array.isArray(value.files) || value.files.length === 0) {
    fail('Release manifest files must be a non-empty array');
  }
  const filePaths = [];
  for (const file of value.files) {
    assertExactKeys(file, ['path', 'bytes', 'sha256'], 'Release manifest file');
    assertPublicPath(file.path, 'Release manifest file path');
    if (!Number.isSafeInteger(file.bytes) || file.bytes < 0) {
      fail(`Release manifest file ${file.path} has invalid byte length`);
    }
    if (typeof file.sha256 !== 'string' || !DIGEST_PATTERN.test(file.sha256)) {
      fail(`Release manifest file ${file.path} has invalid SHA-256`);
    }
    filePaths.push(file.path);
  }
  if (!sameValues(filePaths, [...new Set(filePaths)].sort())) {
    fail('Release manifest files must be sorted and unique');
  }
  if (!filePaths.includes('/index.html')) fail('Release manifest does not cover /index.html');
  for (const path of [...entrypoints.modules, ...entrypoints.stylesheets]) {
    if (!filePaths.includes(path)) fail(`Release manifest does not cover entrypoint ${path}`);
  }

  return value;
}

export async function createReleaseManifest(directory, commit) {
  if (!COMMIT_PATTERN.test(commit)) fail('Release commit must be a lowercase full Git SHA');
  const root = resolve(directory);
  const relativeFiles = await publicRelativeFiles(root);
  if (!relativeFiles.includes('index.html')) fail('Release directory does not contain index.html');

  const files = await Promise.all(relativeFiles.map(async (relativePath) => {
    const bytes = await readFile(join(root, relativePath));
    return {
      path: `/${relativePath}`,
      bytes: bytes.byteLength,
      sha256: sha256(bytes),
    };
  }));
  const html = await readFile(join(root, 'index.html'), 'utf8');
  const manifest = validateReleaseManifest({
    schemaVersion: RELEASE_SCHEMA_VERSION,
    commit,
    entrypoints: findEntrypoints(html),
    files,
  }, commit);
  await writeFile(
    join(root, RELEASE_MANIFEST_FILE),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );
  return manifest;
}

export async function verifyReleaseDirectory(directory, expectedCommit) {
  const root = resolve(directory);
  const manifest = validateReleaseManifest(
    JSON.parse(await readFile(join(root, RELEASE_MANIFEST_FILE), 'utf8')),
    expectedCommit,
  );
  const actualPaths = (await publicRelativeFiles(root)).map((path) => `/${path}`);
  const manifestPaths = manifest.files.map((file) => file.path);
  if (!sameValues(actualPaths, manifestPaths)) {
    fail('Release directory contents do not exactly match the release manifest');
  }

  for (const file of manifest.files) {
    const bytes = await readFile(join(root, file.path.slice(1)));
    if (bytes.byteLength !== file.bytes || sha256(bytes) !== file.sha256) {
      fail(`Release file ${file.path} does not match its manifest digest`);
    }
  }
  const html = await readFile(join(root, 'index.html'), 'utf8');
  const actualEntrypoints = findEntrypoints(html);
  if (
    !sameValues(actualEntrypoints.modules, manifest.entrypoints.modules)
    || !sameValues(actualEntrypoints.stylesheets, manifest.entrypoints.stylesheets)
  ) {
    fail('Release HTML entrypoints do not match the release manifest');
  }
  return manifest;
}

export async function resolveReleaseCommit() {
  const configured = process.env.SEEMOJI_RELEASE_COMMIT ?? process.env.GITHUB_SHA;
  if (configured !== undefined) {
    if (!COMMIT_PATTERN.test(configured)) fail('Configured release commit is not a lowercase full Git SHA');
    return configured;
  }
  const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], {
    cwd: dirname(fileURLToPath(import.meta.url)),
  });
  const commit = stdout.trim();
  if (!COMMIT_PATTERN.test(commit)) fail('Could not resolve a lowercase full Git SHA for this release');
  return commit;
}
