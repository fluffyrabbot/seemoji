import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { writeProductionRecoveryBundle } from './capture-production-recovery.mjs';
import {
  assertLegacyProductionBaseline,
  captureProductionRecoveryManifest,
  verifyProductionRecoveryManifest,
} from './production-recovery-manifest.mjs';
import { sha256 } from './release-manifest.mjs';

const COMMIT = 'a'.repeat(40);
const DEPLOYMENT_ID = '12345678-1234-1234-1234-123456789abc';
const CSP = "default-src 'self'; base-uri 'none'; connect-src 'self' https://cdn.jsdelivr.net; form-action 'self'; frame-ancestors 'none'; img-src 'self' blob: data: https://cdn.jsdelivr.net; object-src 'none'; script-src 'self'; style-src 'self'";
const LEGACY_CSP = "default-src 'self'; base-uri 'none'; connect-src 'self' https://cdn.jsdelivr.net; form-action 'self'; frame-ancestors 'none'; img-src 'self' blob: data:; object-src 'none'; script-src 'self'; style-src 'self'";
const html = '<!doctype html><link rel="icon" href="/favicon.svg">'
  + '<link rel="stylesheet" href="/assets/app.css">'
  + '<script type="module" src="/assets/app.js"></script>';
const fileBodies = new Map([
  ['/assets/app.css', 'body { color: black; }\n'],
  ['/assets/app.js', 'console.log("known good");\n'],
  ['/favicon.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>\n'],
  ['/index.html', html],
]);
const releaseManifest = {
  schemaVersion: 1,
  commit: COMMIT,
  entrypoints: {
    modules: ['/assets/app.js'],
    stylesheets: ['/assets/app.css'],
  },
  files: [...fileBodies].map(([path, body]) => ({
    path,
    bytes: Buffer.byteLength(body),
    sha256: sha256(body),
  })),
};

const documentHeaders = (
  contentType = 'text/html; charset=utf-8',
  contentSecurityPolicy = CSP,
) => new Headers({
  'cache-control': 'public, max-age=0, must-revalidate',
  'content-security-policy': contentSecurityPolicy,
  'content-type': contentType,
  'permissions-policy': 'accelerometer=(), autoplay=(), browsing-topics=(), camera=(), geolocation=(), gyroscope=(), microphone=(), payment=(), serial=(), usb=()',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
});
const fileHeaders = (path) => {
  if (path.startsWith('/assets/')) {
    return new Headers({
      'cache-control': 'public, max-age=31536000, immutable',
      'content-type': path.endsWith('.css') ? 'text/css' : 'application/javascript',
    });
  }
  return new Headers({
    'cache-control': 'public, max-age=0, must-revalidate',
    'content-type': path.endsWith('.svg') ? 'image/svg+xml' : 'text/html; charset=utf-8',
  });
};
const deployedFetch = ({
  bodyOverrides = new Map(),
  manifestResponse,
  contentSecurityPolicy = CSP,
} = {}) => async (input) => {
  const path = new URL(input).pathname;
  if (path === '/release-manifest.json') {
    return manifestResponse ?? new Response(JSON.stringify(releaseManifest), {
      headers: documentHeaders('application/json', contentSecurityPolicy),
    });
  }
  const releasePath = path === '/' ? '/index.html' : path;
  const body = bodyOverrides.has(releasePath)
    ? bodyOverrides.get(releasePath)
    : fileBodies.get(releasePath);
  if (body === undefined) return new Response('not found', { status: 404 });
  return new Response(body, {
    headers: releasePath === '/index.html'
      ? documentHeaders(undefined, contentSecurityPolicy)
      : fileHeaders(releasePath),
  });
};
const canonicalDeployment = {
  id: DEPLOYMENT_ID,
  url: 'https://12345678.seemoji.pages.dev/',
  deployment_trigger: { metadata: { commit_hash: COMMIT } },
};

test('captures the full canonical release manifest and verifies every public file', async () => {
  const manifest = await captureProductionRecoveryManifest({
    canonicalDeployment,
    fetchImpl: deployedFetch(),
  });
  assert.equal(manifest.schemaVersion, 3);
  assert.equal(manifest.documentPolicy, 'pack-cdn-v1');
  assert.equal(manifest.deployment.id, DEPLOYMENT_ID);
  assert.equal(manifest.deployment.commit, COMMIT);
  assert.deepEqual(
    manifest.releaseManifest.files.map((file) => file.path),
    ['/assets/app.css', '/assets/app.js', '/favicon.svg', '/index.html'],
  );
  await assert.doesNotReject(verifyProductionRecoveryManifest({
    baseUrl: 'https://seemoji.pages.dev/',
    manifest,
    fetchImpl: deployedFetch(),
  }));
});

test('captures and exactly re-verifies the preceding document policy', async () => {
  const fetchImpl = deployedFetch({ contentSecurityPolicy: LEGACY_CSP });
  const manifest = await captureProductionRecoveryManifest({
    canonicalDeployment,
    fetchImpl,
  });
  assert.equal(manifest.documentPolicy, 'pre-pack-cdn-v1');
  await assert.doesNotReject(verifyProductionRecoveryManifest({
    baseUrl: 'https://seemoji.pages.dev/',
    manifest,
    fetchImpl,
  }));
  await assert.rejects(verifyProductionRecoveryManifest({
    baseUrl: 'https://seemoji.pages.dev/',
    manifest,
    fetchImpl: deployedFetch(),
    attempts: 1,
  }), /img-src is not the exact release policy/);
});

test('persists both the recovery envelope and standalone trusted release manifest', async () => {
  const manifest = await captureProductionRecoveryManifest({
    canonicalDeployment,
    fetchImpl: deployedFetch(),
  });
  const directory = await mkdtemp(join(tmpdir(), 'seemoji-recovery-'));
  try {
    await writeProductionRecoveryBundle(directory, manifest);
    assert.deepEqual(
      JSON.parse(await readFile(join(directory, 'recovery.json'), 'utf8')),
      manifest,
    );
    assert.deepEqual(
      JSON.parse(await readFile(join(directory, 'release-manifest.json'), 'utf8')),
      releaseManifest,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('fails closed when canonical production predates release manifests', async () => {
  await assert.rejects(
    captureProductionRecoveryManifest({
      canonicalDeployment,
      fetchImpl: deployedFetch({
        manifestResponse: new Response(html, { headers: documentHeaders() }),
      }),
    }),
    /not a hardened release baseline.*application\/json/,
  );
});

test('allows one-time bootstrap only for an exact HTML manifest fallback', async () => {
  const legacyFetch = async (input) => {
    const path = new URL(input).pathname;
    if (path === '/' || path === '/release-manifest.json') {
      return new Response(html, { headers: documentHeaders() });
    }
    return new Response('not found', { status: 404 });
  };
  await assert.doesNotReject(assertLegacyProductionBaseline({
    canonicalDeployment,
    fetchImpl: legacyFetch,
  }));
});

test('forbids legacy bootstrap once canonical production has a release manifest', async () => {
  await assert.rejects(
    assertLegacyProductionBaseline({
      canonicalDeployment,
      fetchImpl: deployedFetch(),
    }),
    /already has a release manifest/,
  );
});

test('forbids bootstrap for an arbitrary manifest-path HTML response', async () => {
  const ambiguousFetch = async (input) => new Response(
    new URL(input).pathname === '/' ? html : '<!doctype html>not the app',
    { headers: documentHeaders() },
  );
  await assert.rejects(
    assertLegacyProductionBaseline({
      canonicalDeployment,
      fetchImpl: ambiguousFetch,
    }),
    /not the exact HTML fallback/,
  );
});

test('rejects recovery when an unreferenced public file differs', async () => {
  const manifest = await captureProductionRecoveryManifest({
    canonicalDeployment,
    fetchImpl: deployedFetch(),
  });
  await assert.rejects(
    verifyProductionRecoveryManifest({
      baseUrl: 'https://seemoji.pages.dev/',
      manifest,
      fetchImpl: deployedFetch({
        bodyOverrides: new Map([['/favicon.svg', '<svg>tampered</svg>']]),
      }),
      attempts: 1,
    }),
    /\/favicon\.svg does not match the release manifest/,
  );
});

test('retries full live recovery verification while the production alias converges', async () => {
  const manifest = await captureProductionRecoveryManifest({
    canonicalDeployment,
    fetchImpl: deployedFetch(),
  });
  let staleResponses = 1;
  const fetchImpl = async (input) => {
    const path = new URL(input).pathname;
    if (path === '/favicon.svg' && staleResponses > 0) {
      staleResponses -= 1;
      return new Response('<svg>stale</svg>', { headers: fileHeaders(path) });
    }
    return deployedFetch()(input);
  };
  await assert.doesNotReject(verifyProductionRecoveryManifest({
    baseUrl: 'https://seemoji.pages.dev/',
    manifest,
    fetchImpl,
    attempts: 2,
    waitImpl: async () => {},
  }));
  assert.equal(staleResponses, 0);
});
