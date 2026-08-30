import {
  assertDocumentHeaders,
  RECOVERY_DOCUMENT_POLICIES,
  verifyDeployedRelease,
} from './check-deployed-headers.mjs';
import {
  RELEASE_MANIFEST_PATH,
  validateReleaseManifest,
} from './release-manifest.mjs';

const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const DEPLOYMENT_ID_PATTERN = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;

const fail = (message) => {
  throw new Error(message);
};

const exactKeys = (value, expected, context) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${context} must be an object`);
  const actual = Object.keys(value).sort();
  if (JSON.stringify(actual) !== JSON.stringify([...expected].sort())) {
    fail(`${context} has unexpected fields`);
  }
};

const validateDeploymentIdentity = (deployment) => {
  exactKeys(deployment, ['id', 'commit', 'url'], 'Recovery deployment');
  if (!DEPLOYMENT_ID_PATTERN.test(deployment.id ?? '')) fail('Recovery deployment ID is invalid');
  if (!COMMIT_PATTERN.test(deployment.commit ?? '')) fail('Recovery deployment commit is invalid');
  let deploymentUrl;
  try {
    deploymentUrl = new URL(deployment.url);
  } catch {
    fail('Recovery deployment URL is invalid');
  }
  if (
    deploymentUrl.protocol !== 'https:'
    || deploymentUrl.pathname !== '/'
    || deploymentUrl.port !== ''
    || deploymentUrl.username !== ''
    || deploymentUrl.password !== ''
    || deploymentUrl.search !== ''
    || deploymentUrl.hash !== ''
  ) {
    fail('Recovery deployment URL must be an HTTPS origin');
  }
  if (
    !deploymentUrl.hostname.endsWith('.pages.dev')
    || !deploymentUrl.hostname.startsWith(`${deployment.id.slice(0, 8)}.`)
  ) {
    fail('Recovery deployment URL does not match its Cloudflare deployment ID');
  }
  return deployment;
};

const loadCanonicalReleaseManifest = async (deployment, fetchImpl) => {
  const url = new URL(RELEASE_MANIFEST_PATH, deployment.url);
  url.searchParams.set('recovery-check', deployment.commit);
  const response = await fetchImpl(url, {
    redirect: 'follow',
    cache: 'no-store',
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    fail(`release manifest returned HTTP ${response.status}`);
  }
  if (!(response.headers.get('content-type') ?? '').toLowerCase().includes('application/json')) {
    fail('release manifest did not return application/json');
  }
  let value;
  try {
    value = await response.json();
  } catch {
    fail('release manifest was not valid JSON');
  }
  return validateReleaseManifest(value, deployment.commit);
};

const identityFromCanonicalDeployment = (canonicalDeployment) => validateDeploymentIdentity({
  id: canonicalDeployment?.id,
  commit: canonicalDeployment?.deployment_trigger?.metadata?.commit_hash,
  url: canonicalDeployment?.url,
});

const fetchLegacyDocument = async (fetchImpl, deployment, path) => {
  const url = new URL(path, deployment.url);
  url.searchParams.set('legacy-bootstrap-check', deployment.commit);
  const response = await fetchImpl(url, {
    redirect: 'follow',
    cache: 'no-store',
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) fail(`${path} returned HTTP ${response.status}`);
  const contentType = (response.headers.get('content-type') ?? '').toLowerCase();
  if (!contentType.includes('text/html')) {
    fail(
      path === RELEASE_MANIFEST_PATH && contentType.includes('application/json')
        ? 'Legacy bootstrap is forbidden because canonical production already has a release manifest'
        : `${path} did not return the expected legacy HTML fallback`,
    );
  }
  assertDocumentHeaders(response.headers);
  return new Uint8Array(await response.arrayBuffer());
};

export function validateProductionRecoveryManifest(value) {
  exactKeys(
    value,
    ['schemaVersion', 'deployment', 'documentPolicy', 'releaseManifest'],
    'Production recovery manifest',
  );
  if (value.schemaVersion !== 3) fail('Production recovery manifest schema is unsupported');
  if (!RECOVERY_DOCUMENT_POLICIES.includes(value.documentPolicy)) {
    fail('Production recovery document policy is unsupported');
  }
  validateDeploymentIdentity(value.deployment);
  validateReleaseManifest(value.releaseManifest, value.deployment.commit);
  return value;
}

export async function captureProductionRecoveryManifest({
  canonicalDeployment,
  fetchImpl = fetch,
}) {
  const deployment = identityFromCanonicalDeployment(canonicalDeployment);

  let releaseManifest;
  try {
    releaseManifest = await loadCanonicalReleaseManifest(deployment, fetchImpl);
  } catch (error) {
    fail(
      'Canonical production is not a hardened release baseline; '
        + `a valid commit-bound ${RELEASE_MANIFEST_PATH} is required before deployment: `
        + error.message,
    );
  }

  let documentPolicy;
  let policyError;
  for (const candidate of RECOVERY_DOCUMENT_POLICIES) {
    try {
      await verifyDeployedRelease(deployment.url, releaseManifest, 1, fetchImpl, undefined, candidate);
      documentPolicy = candidate;
      break;
    } catch (error) {
      policyError = error;
    }
  }
  if (!documentPolicy) {
    fail(`Canonical production failed exact recovery capture: ${policyError.message}`);
  }

  return validateProductionRecoveryManifest({
    schemaVersion: 3,
    deployment,
    documentPolicy,
    releaseManifest,
  });
}

export async function assertLegacyProductionBaseline({
  canonicalDeployment,
  fetchImpl = fetch,
}) {
  const deployment = identityFromCanonicalDeployment(canonicalDeployment);
  const [root, fallback] = await Promise.all([
    fetchLegacyDocument(fetchImpl, deployment, '/'),
    fetchLegacyDocument(fetchImpl, deployment, RELEASE_MANIFEST_PATH),
  ]);
  if (
    root.byteLength !== fallback.byteLength
    || !root.every((byte, index) => byte === fallback[index])
  ) {
    fail(
      'Legacy bootstrap is forbidden because /release-manifest.json is not the exact HTML fallback',
    );
  }
  return deployment;
}

export async function verifyProductionRecoveryManifest({
  baseUrl,
  manifest,
  fetchImpl = fetch,
  attempts = 10,
  waitImpl,
}) {
  const expected = validateProductionRecoveryManifest(manifest);
  await verifyDeployedRelease(
    baseUrl,
    expected.releaseManifest,
    attempts,
    fetchImpl,
    waitImpl,
    expected.documentPolicy,
  );
  return expected;
}
