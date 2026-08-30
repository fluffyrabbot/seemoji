import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  assertAssetHeaders,
  assertDocumentHeaders,
  assertPackIndexHeaders,
  findModuleAssetPath,
  verifyDeployedRelease,
} from './check-deployed-headers.mjs';
import { sha256 } from './release-manifest.mjs';

const CURRENT_COMMIT = 'a'.repeat(40);
const STALE_COMMIT = 'b'.repeat(40);
const CSP =
  "default-src 'self'; base-uri 'none'; connect-src 'self' https://cdn.jsdelivr.net; form-action 'self'; frame-ancestors 'none'; img-src 'self' blob: data: https://cdn.jsdelivr.net; object-src 'none'; script-src 'self'; style-src 'self'";
const EXPECTED_HEADERS_FILE = `/*
  Cache-Control: public, max-age=0, must-revalidate
  Content-Security-Policy: ${CSP}
  Permissions-Policy: accelerometer=(), autoplay=(), browsing-topics=(), camera=(), geolocation=(), gyroscope=(), microphone=(), payment=(), serial=(), usb=()
  Referrer-Policy: strict-origin-when-cross-origin
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY

/assets/*
  ! Cache-Control
  Cache-Control: public, max-age=31536000, immutable

/packs/:pack/:version/manifest.json
  ! Cache-Control
  Cache-Control: public, max-age=31536000, immutable

/packs/:pack/:version/:style/manifest.json
  ! Cache-Control
  Cache-Control: public, max-age=31536000, immutable

/packs/index.json
  ! Cache-Control
  Cache-Control: no-cache
`;

const secureDocumentHeaders = (contentType = 'text/html; charset=utf-8') =>
  new Headers({
    'cache-control': 'public, max-age=0, must-revalidate',
    'content-security-policy': CSP,
    'content-type': contentType,
    'permissions-policy':
      'accelerometer=(), autoplay=(), browsing-topics=(), camera=(), geolocation=(), gyroscope=(), microphone=(), payment=(), serial=(), usb=()',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
  });

const immutableAssetHeaders = (contentType = 'application/javascript') => new Headers({
  'cache-control': 'public, max-age=31536000, immutable',
  'content-type': contentType,
});

const releaseFixture = (commit = CURRENT_COMMIT) => {
  const html = '<!doctype html><link rel="stylesheet" href="/assets/index-AbCd1234.css">'
    + '<script type="module" src="/assets/index-AbCd1234.js"></script>';
  const stylesheet = 'body { color: black; }\n';
  const javascript = 'console.log("release");\n';
  return {
    html,
    stylesheet,
    javascript,
    manifest: {
      schemaVersion: 1,
      commit,
      entrypoints: {
        modules: ['/assets/index-AbCd1234.js'],
        stylesheets: ['/assets/index-AbCd1234.css'],
      },
      files: [
        {
          path: '/assets/index-AbCd1234.css',
          bytes: Buffer.byteLength(stylesheet),
          sha256: sha256(stylesheet),
        },
        {
          path: '/assets/index-AbCd1234.js',
          bytes: Buffer.byteLength(javascript),
          sha256: sha256(javascript),
        },
        {
          path: '/index.html',
          bytes: Buffer.byteLength(html),
          sha256: sha256(html),
        },
      ],
    },
  };
};

const deployedFetch = (fixture, overrides = {}) => async (input) => {
  const path = new URL(input).pathname;
  if (overrides[path]) return overrides[path];
  if (path === '/release-manifest.json') {
    return new Response(JSON.stringify(fixture.manifest), {
      headers: secureDocumentHeaders('application/json'),
    });
  }
  if (path === '/') {
    return new Response(fixture.html, { headers: secureDocumentHeaders() });
  }
  if (path === '/assets/index-AbCd1234.css') {
    return new Response(fixture.stylesheet, { headers: immutableAssetHeaders('text/css') });
  }
  if (path === '/assets/index-AbCd1234.js') {
    return new Response(fixture.javascript, { headers: immutableAssetHeaders() });
  }
  return new Response('not found', { status: 404 });
};

test('accepts the exact production document policy', () => {
  assert.doesNotThrow(() => assertDocumentHeaders(secureDocumentHeaders()));
});

test('keeps the checked-in Cloudflare header contract exact', async () => {
  assert.equal(
    await readFile(new URL('../public/_headers', import.meta.url), 'utf8'),
    EXPECTED_HEADERS_FILE,
  );
});

test('rejects a maliciously broadened CSP even when all required sources remain', () => {
  const headers = secureDocumentHeaders();
  headers.set('content-security-policy', CSP.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'"));
  assert.throws(() => assertDocumentHeaders(headers), /script-src.*exact release policy/);
});

test('rejects an unexpected CSP directive', () => {
  const headers = secureDocumentHeaders();
  headers.set('content-security-policy', `${CSP}; worker-src 'self'`);
  assert.throws(() => assertDocumentHeaders(headers), /missing or unexpected directives/);
});

test('rejects cacheable production HTML', () => {
  const headers = secureDocumentHeaders();
  headers.set('cache-control', 'public, max-age=31536000, immutable');
  assert.throws(() => assertDocumentHeaders(headers), /Document Cache-Control must be exactly/);
});

test('accepts only the exact immutable fingerprinted-asset policy', () => {
  assert.doesNotThrow(() => assertAssetHeaders(immutableAssetHeaders()));
  assert.throws(
    () => assertAssetHeaders(new Headers({
      'cache-control': 'public, max-age=31536000, immutable, stale-while-revalidate=60',
    })),
    /Asset Cache-Control must be exactly/,
  );
});

test('accepts only no-cache for the mutable pack index', () => {
  assert.doesNotThrow(() => assertPackIndexHeaders(new Headers({
    'cache-control': 'no-cache',
  })));
  assert.throws(() => assertPackIndexHeaders(new Headers({
    'cache-control': 'public, max-age=31536000, immutable',
  })), /Pack index Cache-Control/);
});

test('finds the built module independently of attribute order', () => {
  assert.equal(
    findModuleAssetPath('<script crossorigin src="/assets/index-AbCd1234.js" type="module"></script>'),
    '/assets/index-AbCd1234.js',
  );
});

test('verifies the exact deployed commit and every release digest', async () => {
  const fixture = releaseFixture();
  const manifest = await verifyDeployedRelease(
    'https://release.example/',
    fixture.manifest,
    1,
    deployedFetch(fixture),
  );
  assert.equal(manifest.commit, CURRENT_COMMIT);
});

test('rejects a stale release even when its headers and files are internally valid', async () => {
  const fixture = releaseFixture(STALE_COMMIT);
  const expected = releaseFixture(CURRENT_COMMIT);
  await assert.rejects(
    verifyDeployedRelease(
      'https://release.example/',
      expected.manifest,
      1,
      deployedFetch(fixture),
    ),
    /does not match expected commit/,
  );
});

test('rejects a deployed asset whose bytes differ from the release manifest', async () => {
  const fixture = releaseFixture();
  await assert.rejects(
    verifyDeployedRelease(
      'https://release.example/',
      fixture.manifest,
      1,
      deployedFetch(fixture, {
        '/assets/index-AbCd1234.js': new Response('tampered', {
          headers: immutableAssetHeaders(),
        }),
      }),
    ),
    /does not match the release manifest/,
  );
});

test('rejects a self-consistent different payload claiming the expected commit', async () => {
  const expected = releaseFixture();
  const deployed = releaseFixture();
  deployed.javascript = 'console.log("different release");\n';
  const javascript = deployed.manifest.files.find(
    (file) => file.path === '/assets/index-AbCd1234.js',
  );
  javascript.bytes = Buffer.byteLength(deployed.javascript);
  javascript.sha256 = sha256(deployed.javascript);

  await assert.rejects(
    verifyDeployedRelease(
      'https://release.example/',
      expected.manifest,
      1,
      deployedFetch(deployed),
    ),
    /does not match the verified artifact manifest/,
  );
});
