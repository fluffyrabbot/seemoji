import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import {
  findEntrypoints,
  RELEASE_MANIFEST_PATH,
  sha256,
  validateReleaseManifest,
} from './release-manifest.mjs';

export const CURRENT_DOCUMENT_POLICY = 'pack-cdn-v1';
export const RECOVERY_DOCUMENT_POLICIES = [CURRENT_DOCUMENT_POLICY, 'pre-pack-cdn-v1'];

const CSP_POLICIES = new Map([
  [CURRENT_DOCUMENT_POLICY, new Map([
  ['default-src', ["'self'"]],
  ['base-uri', ["'none'"]],
  ['connect-src', ["'self'", 'https://cdn.jsdelivr.net']],
  ['form-action', ["'self'"]],
  ['frame-ancestors', ["'none'"]],
  ['img-src', ["'self'", 'blob:', 'data:', 'https://cdn.jsdelivr.net']],
  ['object-src', ["'none'"]],
  ['script-src', ["'self'"]],
  ['style-src', ["'self'"]],
  ])],
  ['pre-pack-cdn-v1', new Map([
    ['default-src', ["'self'"]],
    ['base-uri', ["'none'"]],
    ['connect-src', ["'self'", 'https://cdn.jsdelivr.net']],
    ['form-action', ["'self'"]],
    ['frame-ancestors', ["'none'"]],
    ['img-src', ["'self'", 'blob:', 'data:']],
    ['object-src', ["'none'"]],
    ['script-src', ["'self'"]],
    ['style-src', ["'self'"]],
  ])],
]);

const EXPECTED_DISABLED_FEATURES = [
  'accelerometer',
  'autoplay',
  'browsing-topics',
  'camera',
  'geolocation',
  'gyroscope',
  'microphone',
  'payment',
  'serial',
  'usb',
];

const DOCUMENT_CACHE_POLICY = ['public', 'max-age=0', 'must-revalidate'];
const IMMUTABLE_CACHE_POLICY = ['public', 'max-age=31536000', 'immutable'];
const PACK_INDEX_CACHE_POLICY = ['no-cache'];

const fail = (message) => {
  throw new Error(message);
};

const sameSet = (left, right) =>
  left.size === right.size && [...left].every((value) => right.has(value));

const parseCsp = (value) => {
  const parsed = new Map();
  for (const directive of value.split(';')) {
    const [name, ...sources] = directive.trim().split(/\s+/);
    if (!name) continue;
    if (parsed.has(name)) fail(`Content-Security-Policy repeats ${name}`);
    if (new Set(sources).size !== sources.length) {
      fail(`Content-Security-Policy ${name} repeats a source`);
    }
    parsed.set(name, new Set(sources));
  }
  return parsed;
};

const parseCacheControl = (value) => {
  const directives = value
    .split(',')
    .map((directive) => directive.trim().toLowerCase())
    .filter(Boolean);
  if (new Set(directives).size !== directives.length) {
    fail('Cache-Control repeats a directive');
  }
  return new Set(directives);
};

const assertExactCachePolicy = (headers, expected, context) => {
  const actual = parseCacheControl(headers.get('cache-control') ?? '');
  const wanted = new Set(expected);
  if (!sameSet(actual, wanted)) {
    fail(`${context} Cache-Control must be exactly ${expected.join(', ')}`);
  }
};

const assertDocumentCache = (headers) =>
  assertExactCachePolicy(headers, DOCUMENT_CACHE_POLICY, 'Document');

export function findModuleAssetPath(html) {
  return findEntrypoints(html).modules[0];
}

export function assertDocumentHeaders(headers, policy = CURRENT_DOCUMENT_POLICY) {
  const expectedCsp = CSP_POLICIES.get(policy);
  if (!expectedCsp) fail(`Unknown document header policy: ${policy}`);
  const cspValue = headers.get('content-security-policy');
  if (!cspValue) fail('Missing Content-Security-Policy');
  const actualCsp = parseCsp(cspValue);
  if (actualCsp.size !== expectedCsp.size) {
    fail('Content-Security-Policy has missing or unexpected directives');
  }
  for (const [directive, expectedSources] of expectedCsp) {
    const actualSources = actualCsp.get(directive);
    if (!actualSources || !sameSet(actualSources, new Set(expectedSources))) {
      fail(`Content-Security-Policy ${directive} is not the exact release policy`);
    }
  }

  const actualFeatures = new Set();
  for (const declaration of (headers.get('permissions-policy') ?? '').split(',')) {
    const match = declaration.trim().match(/^([a-z-]+)=\(\)$/);
    if (!match) fail('Permissions-Policy contains an invalid or permissive declaration');
    if (actualFeatures.has(match[1])) fail(`Permissions-Policy repeats ${match[1]}`);
    actualFeatures.add(match[1]);
  }
  if (!sameSet(actualFeatures, new Set(EXPECTED_DISABLED_FEATURES))) {
    fail('Permissions-Policy is not the exact disabled-feature policy');
  }

  if (headers.get('referrer-policy') !== 'strict-origin-when-cross-origin') {
    fail('Referrer-Policy is not strict-origin-when-cross-origin');
  }
  if (headers.get('x-content-type-options') !== 'nosniff') {
    fail('X-Content-Type-Options is not nosniff');
  }
  if (headers.get('x-frame-options') !== 'DENY') {
    fail('X-Frame-Options is not DENY');
  }
  assertDocumentCache(headers);
}

export function assertAssetHeaders(headers) {
  assertExactCachePolicy(headers, IMMUTABLE_CACHE_POLICY, 'Asset');
}

export function assertPackIndexHeaders(headers) {
  assertExactCachePolicy(headers, PACK_INDEX_CACHE_POLICY, 'Pack index');
}

const assertContentType = (path, headers) => {
  const expected = path.endsWith('.html') ? 'text/html'
    : path.endsWith('.js') ? 'javascript'
      : path.endsWith('.css') ? 'text/css'
        : path.endsWith('.svg') ? 'image/svg+xml'
          : path.endsWith('.json') ? 'application/json'
          : null;
  if (expected && !(headers.get('content-type') ?? '').toLowerCase().includes(expected)) {
    fail(`${path} has an unexpected Content-Type`);
  }
};

const fetchReleaseFile = async (fetchImpl, url) => {
  const response = await fetchImpl(url, {
    redirect: 'follow',
    cache: 'no-store',
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) fail(`${url.pathname} returned HTTP ${response.status}`);
  return response;
};

const canonicalManifest = (manifest) => JSON.stringify({
  schemaVersion: manifest.schemaVersion,
  commit: manifest.commit,
  entrypoints: {
    modules: manifest.entrypoints.modules,
    stylesheets: manifest.entrypoints.stylesheets,
  },
  files: manifest.files.map((file) => ({
    path: file.path,
    bytes: file.bytes,
    sha256: file.sha256,
  })),
});

const verify = async (baseUrl, expectedManifest, fetchImpl, documentPolicy) => {
  const cacheBuster = expectedManifest.commit;
  const manifestUrl = new URL(RELEASE_MANIFEST_PATH, baseUrl);
  manifestUrl.searchParams.set('deployment-check', cacheBuster);
  const manifestResponse = await fetchReleaseFile(fetchImpl, manifestUrl);
  assertDocumentCache(manifestResponse.headers);
  assertContentType(RELEASE_MANIFEST_PATH, manifestResponse.headers);
  const manifest = validateReleaseManifest(
    await manifestResponse.json(),
    expectedManifest.commit,
  );
  if (canonicalManifest(manifest) !== canonicalManifest(expectedManifest)) {
    fail('Deployed release manifest does not match the verified artifact manifest');
  }

  const documentUrl = new URL('/', baseUrl);
  documentUrl.searchParams.set('deployment-check', cacheBuster);
  const documentResponse = await fetchReleaseFile(fetchImpl, documentUrl);
  assertDocumentHeaders(documentResponse.headers, documentPolicy);
  assertContentType('/index.html', documentResponse.headers);
  const documentBytes = new Uint8Array(await documentResponse.arrayBuffer());
  const documentFile = manifest.files.find((file) => file.path === '/index.html');
  if (
    !documentFile
    || documentFile.bytes !== documentBytes.byteLength
    || documentFile.sha256 !== sha256(documentBytes)
  ) {
    fail('Production HTML does not match the release manifest');
  }

  const html = new TextDecoder().decode(documentBytes);
  const entrypoints = findEntrypoints(html);
  if (
    JSON.stringify(entrypoints.modules) !== JSON.stringify(manifest.entrypoints.modules)
    || JSON.stringify(entrypoints.stylesheets) !== JSON.stringify(manifest.entrypoints.stylesheets)
  ) {
    fail('Production HTML entrypoints do not match the release manifest');
  }

  for (const file of manifest.files) {
    if (file.path === '/index.html') continue;
    const fileUrl = new URL(file.path, baseUrl);
    fileUrl.searchParams.set('deployment-check', cacheBuster);
    const response = await fetchReleaseFile(fetchImpl, fileUrl);
    if (file.path.startsWith('/assets/') || (file.path.startsWith('/packs/')
        && file.path !== '/packs/index.json')) {
      assertAssetHeaders(response.headers);
    } else if (file.path === '/packs/index.json') {
      assertPackIndexHeaders(response.headers);
    } else {
      assertDocumentCache(response.headers);
    }
    assertContentType(file.path, response.headers);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength !== file.bytes || sha256(bytes) !== file.sha256) {
      fail(`Production file ${file.path} does not match the release manifest`);
    }
  }
  return manifest;
};

const wait = (milliseconds) => new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));

export async function verifyDeployedRelease(
  baseUrl,
  expectedManifest,
  attempts = 10,
  fetchImpl = fetch,
  waitImpl = wait,
  documentPolicy = CURRENT_DOCUMENT_POLICY,
) {
  const verifiedManifest = validateReleaseManifest(expectedManifest);
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await verify(baseUrl, verifiedManifest, fetchImpl, documentPolicy);
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await waitImpl(2_000);
    }
  }
  throw lastError;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  const baseUrl = process.argv[2];
  const expectedCommit = process.argv[3];
  const manifestPath = process.argv[4] ?? 'dist/release-manifest.json';
  if (!baseUrl || !expectedCommit) {
    fail(
      'Usage: node scripts/check-deployed-headers.mjs '
        + '<base-url> <full-git-sha> [release-manifest-path]',
    );
  }
  const expectedManifest = validateReleaseManifest(
    JSON.parse(await readFile(resolve(manifestPath), 'utf8')),
    expectedCommit,
  );
  const manifest = await verifyDeployedRelease(baseUrl, expectedManifest);
  console.log(
    `Verified release ${manifest.commit} at ${baseUrl} (${manifest.files.length} files)`,
  );
}
