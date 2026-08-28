import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const REQUIRED_CSP_DIRECTIVES = new Map([
  ['default-src', ["'self'"]],
  ['base-uri', ["'none'"]],
  ['connect-src', ["'self'", 'https://cdn.jsdelivr.net']],
  ['form-action', ["'self'"]],
  ['frame-ancestors', ["'none'"]],
  ['img-src', ["'self'", 'blob:', 'data:']],
  ['object-src', ["'none'"]],
  ['script-src', ["'self'"]],
  ['style-src', ["'self'"]],
]);

const REQUIRED_DISABLED_FEATURES = [
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

const fail = (message) => {
  throw new Error(message);
};

const parseCsp = (value) =>
  new Map(
    value
      .split(';')
      .map((directive) => directive.trim().split(/\s+/))
      .filter(([name]) => name)
      .map(([name, ...sources]) => [name, new Set(sources)]),
  );

export function findModuleAssetPath(html) {
  for (const [tag] of html.matchAll(/<script\b[^>]*>/gi)) {
    if (!/\btype=["']module["']/i.test(tag)) continue;
    const source = tag.match(/\bsrc=["']([^"']+\.js)["']/i)?.[1];
    if (source) return source;
  }
  fail('Production HTML does not reference a JavaScript module asset');
}

export function assertDocumentHeaders(headers) {
  const cspValue = headers.get('content-security-policy');
  if (!cspValue) fail('Missing Content-Security-Policy');
  const csp = parseCsp(cspValue);

  for (const [directive, requiredSources] of REQUIRED_CSP_DIRECTIVES) {
    const actualSources = csp.get(directive);
    if (!actualSources) fail(`Content-Security-Policy is missing ${directive}`);
    for (const source of requiredSources) {
      if (!actualSources.has(source)) {
        fail(`Content-Security-Policy ${directive} is missing ${source}`);
      }
    }
  }

  const permissions = headers.get('permissions-policy') ?? '';
  for (const feature of REQUIRED_DISABLED_FEATURES) {
    if (!new RegExp(`(?:^|,)\\s*${feature}=\\(\\)(?:\\s*,|$)`).test(permissions)) {
      fail(`Permissions-Policy does not disable ${feature}`);
    }
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
}

export function assertAssetHeaders(headers) {
  const cacheControl = headers.get('cache-control') ?? '';
  const directives = new Set(
    cacheControl
      .split(',')
      .map((directive) => directive.trim().toLowerCase())
      .filter(Boolean),
  );
  for (const required of ['public', 'max-age=31536000', 'immutable']) {
    if (!directives.has(required)) fail(`Asset Cache-Control is missing ${required}`);
  }
}

const verify = async (baseUrl) => {
  const documentUrl = new URL('/', baseUrl);
  documentUrl.searchParams.set('deployment-check', process.env.GITHUB_SHA ?? Date.now().toString());
  const documentResponse = await fetch(documentUrl, {
    redirect: 'follow',
    signal: AbortSignal.timeout(10_000),
  });
  if (!documentResponse.ok) fail(`Document returned HTTP ${documentResponse.status}`);
  assertDocumentHeaders(documentResponse.headers);

  const assetPath = findModuleAssetPath(await documentResponse.text());
  const assetResponse = await fetch(new URL(assetPath, documentResponse.url), {
    redirect: 'follow',
    signal: AbortSignal.timeout(10_000),
  });
  if (!assetResponse.ok) fail(`Module asset returned HTTP ${assetResponse.status}`);
  assertAssetHeaders(assetResponse.headers);
  return assetPath;
};

const wait = (milliseconds) => new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));

export async function verifyDeployedHeaders(baseUrl, attempts = 10) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await verify(baseUrl);
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await wait(2_000);
    }
  }
  throw lastError;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  const baseUrl = process.argv[2];
  if (!baseUrl) fail('Usage: node scripts/check-deployed-headers.mjs <base-url>');
  const assetPath = await verifyDeployedHeaders(baseUrl);
  console.log(`Verified delivery headers at ${baseUrl} (module ${assetPath})`);
}
