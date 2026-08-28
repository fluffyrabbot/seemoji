import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertAssetHeaders,
  assertDocumentHeaders,
  findModuleAssetPath,
} from './check-deployed-headers.mjs';

const secureDocumentHeaders = () =>
  new Headers({
    'content-security-policy':
      "default-src 'self'; base-uri 'none'; connect-src 'self' https://cdn.jsdelivr.net; form-action 'self'; frame-ancestors 'none'; img-src 'self' blob: data:; object-src 'none'; script-src 'self'; style-src 'self'",
    'permissions-policy':
      'accelerometer=(), autoplay=(), browsing-topics=(), camera=(), geolocation=(), gyroscope=(), microphone=(), payment=(), serial=(), usb=()',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
  });

test('accepts the production document policy', () => {
  assert.doesNotThrow(() => assertDocumentHeaders(secureDocumentHeaders()));
});

test('rejects a CSP that cannot load pinned Twemoji artwork', () => {
  const headers = secureDocumentHeaders();
  headers.set(
    'content-security-policy',
    "default-src 'self'; base-uri 'none'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'self' blob: data:; object-src 'none'; script-src 'self'; style-src 'self'",
  );
  assert.throws(() => assertDocumentHeaders(headers), /connect-src.*cdn\.jsdelivr\.net/);
});

test('accepts immutable fingerprinted assets', () => {
  assert.doesNotThrow(() =>
    assertAssetHeaders(new Headers({ 'cache-control': 'public, max-age=31536000, immutable' })),
  );
});

test('finds the built module independently of attribute order', () => {
  assert.equal(
    findModuleAssetPath('<script crossorigin src="/assets/index-AbCd1234.js" type="module"></script>'),
    '/assets/index-AbCd1234.js',
  );
});
