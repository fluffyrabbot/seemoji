import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const ACCOUNT_ID_PATTERN = /^[0-9a-f]{32}$/;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const DEPLOYMENT_ID_PATTERN = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const PROJECT_NAME_PATTERN = /^[a-z0-9-]+$/;
const RETRYABLE_STATUSES = new Set([408, 409, 425, 429]);

const fail = (message) => {
  throw new Error(message);
};

const wait = (milliseconds) => new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));

const validateRequest = ({ accountId, apiToken, projectName }) => {
  if (!ACCOUNT_ID_PATTERN.test(accountId ?? '')) fail('Cloudflare account ID is invalid');
  if (typeof apiToken !== 'string' || apiToken.length === 0) fail('Cloudflare API token is missing');
  if (!PROJECT_NAME_PATTERN.test(projectName ?? '')) fail('Cloudflare Pages project name is invalid');
};

const validateAttempts = (attempts, context) => {
  if (!Number.isSafeInteger(attempts) || attempts < 1) fail(`${context} attempts must be positive`);
};

const projectUrl = (accountId, projectName) => new URL(
  `https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/${projectName}`,
);

const retryableStatus = (status) => RETRYABLE_STATUSES.has(status) || status >= 500;

const retryDelay = (response, attempt) => {
  const retryAfter = response?.headers.get('retry-after');
  const seconds = retryAfter === null ? Number.NaN : Number(retryAfter);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1_000, 30_000);
  const retryDate = retryAfter === null ? Number.NaN : Date.parse(retryAfter);
  if (Number.isFinite(retryDate)) {
    return Math.min(Math.max(retryDate - Date.now(), 0), 30_000);
  }
  return Math.min(500 * attempt, 5_000);
};

const responseError = (operation, response, payload, attempt) => {
  const detail = Array.isArray(payload?.errors)
    ? payload.errors.map((error) => error?.message).filter(Boolean).join('; ')
    : '';
  const error = new Error(
    `Cloudflare ${operation} returned HTTP ${response.status}${detail ? `: ${detail}` : ''}`,
  );
  error.retryable = retryableStatus(response.status);
  error.retryDelay = retryDelay(response, attempt);
  error.ambiguous = response.ok;
  return error;
};

export async function getCanonicalPagesDeployment({
  accountId,
  apiToken,
  projectName,
  fetchImpl = fetch,
  attempts = 3,
  waitImpl = wait,
}) {
  validateRequest({ accountId, apiToken, projectName });
  validateAttempts(attempts, 'Project lookup');
  const url = projectUrl(accountId, projectName);
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        headers: { authorization: `Bearer ${apiToken}` },
        signal: AbortSignal.timeout(10_000),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || payload?.success !== true) {
        throw responseError('project lookup', response, payload, attempt);
      }
      const deployment = payload.result?.canonical_deployment;
      if (!DEPLOYMENT_ID_PATTERN.test(deployment?.id ?? '')) {
        const error = new Error('Cloudflare project has no valid canonical production deployment');
        error.retryable = true;
        throw error;
      }
      return deployment;
    } catch (error) {
      lastError = error;
      if (error?.retryable === false || attempt === attempts) throw error;
      await waitImpl(error?.retryDelay ?? Math.min(500 * attempt, 5_000));
    }
  }
  throw lastError;
}

async function waitForCanonicalDeployment({
  accountId,
  apiToken,
  projectName,
  deploymentId,
  expectedCommit,
  fetchImpl,
  attempts,
  waitImpl,
}) {
  let lastDeploymentId;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const deployment = await getCanonicalPagesDeployment({
        accountId,
        apiToken,
        projectName,
        fetchImpl,
        attempts: 1,
        waitImpl,
      });
      lastDeploymentId = deployment.id;
      const commit = deployment.deployment_trigger?.metadata?.commit_hash;
      if (deployment.id === deploymentId && commit === expectedCommit) return deployment;
      if (deployment.id === deploymentId && commit !== expectedCommit) {
        const error = new Error('Canonical rollback deployment has an unexpected commit');
        error.retryable = false;
        throw error;
      }
    } catch (error) {
      if (error?.retryable === false) throw error;
      lastDeploymentId = `unavailable (${error.message})`;
    }
    if (attempt < attempts) await waitImpl(Math.min(500 * attempt, 2_000));
  }
  fail(
    `Cloudflare canonical production deployment did not converge to ${deploymentId}; `
      + `last observed ${lastDeploymentId ?? 'none'}`,
  );
}

export async function rollbackPagesDeployment({
  accountId,
  apiToken,
  projectName,
  deploymentId,
  expectedCommit,
  fetchImpl = fetch,
  attempts = 3,
  canonicalAttempts = 10,
  waitImpl = wait,
}) {
  validateRequest({ accountId, apiToken, projectName });
  if (!DEPLOYMENT_ID_PATTERN.test(deploymentId ?? '')) fail('Cloudflare deployment ID is invalid');
  if (!COMMIT_PATTERN.test(expectedCommit ?? '')) fail('Cloudflare rollback commit is invalid');
  validateAttempts(attempts, 'Rollback');
  validateAttempts(canonicalAttempts, 'Canonical verification');

  const url = new URL(`${projectUrl(accountId, projectName).href}/deployments/${deploymentId}/rollback`);
  let result;
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        method: 'POST',
        headers: { authorization: `Bearer ${apiToken}` },
        signal: AbortSignal.timeout(10_000),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || payload?.success !== true) {
        throw responseError('rollback', response, payload, attempt);
      }
      if (payload.result?.id !== deploymentId) {
        const error = new Error('Cloudflare rollback response identified an unexpected deployment');
        error.retryable = false;
        throw error;
      }
      if (payload.result?.deployment_trigger?.metadata?.commit_hash !== expectedCommit) {
        const error = new Error('Cloudflare rollback response identified an unexpected commit');
        error.retryable = false;
        throw error;
      }
      result = payload.result;
      break;
    } catch (error) {
      lastError = error;
      if (error?.retryable === undefined || error?.ambiguous === true) {
        try {
          const canonical = await getCanonicalPagesDeployment({
            accountId,
            apiToken,
            projectName,
            fetchImpl,
            attempts: 1,
            waitImpl,
          });
          if (
            canonical.id === deploymentId
            && canonical.deployment_trigger?.metadata?.commit_hash === expectedCommit
          ) {
            result = canonical;
            break;
          }
        } catch {
          // Preserve the original rollback error when reconciliation is also unavailable.
        }
      }
      if (error?.retryable === false || attempt === attempts) throw error;
      await waitImpl(error?.retryDelay ?? Math.min(500 * attempt, 5_000));
    }
  }
  if (!result) throw lastError;

  await waitForCanonicalDeployment({
    accountId,
    apiToken,
    projectName,
    deploymentId,
    expectedCommit,
    fetchImpl,
    attempts: canonicalAttempts,
    waitImpl,
  });
  return result;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  const projectName = process.argv[2];
  const deploymentId = process.argv[3];
  const expectedCommit = process.argv[4];
  if (!projectName || !deploymentId || !expectedCommit) {
    fail(
      'Usage: node scripts/rollback-pages-deployment.mjs '
        + '<project-name> <deployment-id> <full-git-sha>',
    );
  }
  const result = await rollbackPagesDeployment({
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
    apiToken: process.env.CLOUDFLARE_API_TOKEN,
    projectName,
    deploymentId,
    expectedCommit,
  });
  console.log(`Confirmed Cloudflare Pages production at rollback deployment ${result.id}`);
}
