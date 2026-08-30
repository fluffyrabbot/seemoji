import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getCanonicalPagesDeployment,
  rollbackPagesDeployment,
} from './rollback-pages-deployment.mjs';

const ACCOUNT_ID = 'a'.repeat(32);
const DEPLOYMENT_ID = '12345678-1234-1234-1234-123456789abc';
const OTHER_DEPLOYMENT_ID = '87654321-4321-4321-4321-cba987654321';
const COMMIT = 'a'.repeat(40);
const OTHER_COMMIT = 'b'.repeat(40);
const apiResponse = (result, options = {}) => new Response(JSON.stringify({
  success: options.success ?? true,
  result,
  errors: options.errors ?? [],
}), {
  status: options.status ?? 200,
  headers: { 'content-type': 'application/json', ...options.headers },
});
const deployment = (id = DEPLOYMENT_ID, commit = COMMIT) => ({
  id,
  deployment_trigger: { metadata: { commit_hash: commit } },
});
const canonicalResponse = (id = DEPLOYMENT_ID, commit = COMMIT) => apiResponse({
  canonical_deployment: deployment(id, commit),
});

test('captures the canonical production deployment instead of deployment-history order', async () => {
  let request;
  const deployment = await getCanonicalPagesDeployment({
    accountId: ACCOUNT_ID,
    apiToken: 'secret-token',
    projectName: 'seemoji',
    attempts: 1,
    fetchImpl: async (url, options) => {
      request = { url: url.href, options };
      return canonicalResponse(DEPLOYMENT_ID);
    },
  });
  assert.equal(
    request.url,
    `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/pages/projects/seemoji`,
  );
  assert.equal(request.options.method, undefined);
  assert.equal(request.options.headers.authorization, 'Bearer secret-token');
  assert.equal(deployment.id, DEPLOYMENT_ID);
});

test('calls the supported rollback endpoint and confirms canonical convergence', async () => {
  const requests = [];
  const result = await rollbackPagesDeployment({
    accountId: ACCOUNT_ID,
    apiToken: 'secret-token',
    projectName: 'seemoji',
    deploymentId: DEPLOYMENT_ID,
    expectedCommit: COMMIT,
    attempts: 1,
    canonicalAttempts: 1,
    fetchImpl: async (url, options) => {
      requests.push({ url: url.href, options });
      return options.method === 'POST'
        ? apiResponse(deployment())
        : canonicalResponse(DEPLOYMENT_ID);
    },
  });
  assert.equal(
    requests[0].url,
    `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}`
      + `/pages/projects/seemoji/deployments/${DEPLOYMENT_ID}/rollback`,
  );
  assert.equal(requests[0].options.method, 'POST');
  assert.equal(requests[0].options.headers.authorization, 'Bearer secret-token');
  assert.equal(requests[1].options.method, undefined);
  assert.equal(result.id, DEPLOYMENT_ID);
});

test('does not retry an authorization failure', async () => {
  let calls = 0;
  await assert.rejects(
    rollbackPagesDeployment({
      accountId: ACCOUNT_ID,
      apiToken: 'expired-token',
      projectName: 'seemoji',
      deploymentId: DEPLOYMENT_ID,
      expectedCommit: COMMIT,
      fetchImpl: async () => {
        calls += 1;
        return apiResponse(null, {
          success: false,
          status: 403,
          errors: [{ message: 'authentication failed' }],
        });
      },
    }),
    /HTTP 403: authentication failed/,
  );
  assert.equal(calls, 1);
});

for (const status of [408, 409, 425, 429]) {
  test(`retries a transient HTTP ${status} rollback response`, async () => {
    let calls = 0;
    const waits = [];
    const result = await rollbackPagesDeployment({
      accountId: ACCOUNT_ID,
      apiToken: 'secret-token',
      projectName: 'seemoji',
      deploymentId: DEPLOYMENT_ID,
      expectedCommit: COMMIT,
      attempts: 2,
      canonicalAttempts: 1,
      waitImpl: async (milliseconds) => waits.push(milliseconds),
      fetchImpl: async (_url, options) => {
        calls += 1;
        if (calls === 1) {
          return apiResponse(null, {
            success: false,
            status,
            headers: status === 429 ? { 'retry-after': '999' } : {},
          });
        }
        return options.method === 'POST'
          ? apiResponse(deployment())
          : canonicalResponse();
      },
    });
    assert.equal(calls, 3);
    assert.equal(result.id, DEPLOYMENT_ID);
    assert.equal(waits[0], status === 429 ? 30_000 : 500);
  });
}

test('rejects a successful rollback response for the wrong deployment', async () => {
  await assert.rejects(
    rollbackPagesDeployment({
      accountId: ACCOUNT_ID,
      apiToken: 'secret-token',
      projectName: 'seemoji',
      deploymentId: DEPLOYMENT_ID,
      expectedCommit: COMMIT,
      attempts: 1,
      fetchImpl: async () => apiResponse(deployment(OTHER_DEPLOYMENT_ID)),
    }),
    /unexpected deployment/,
  );
});

test('rejects a successful rollback response for the wrong commit', async () => {
  await assert.rejects(
    rollbackPagesDeployment({
      accountId: ACCOUNT_ID,
      apiToken: 'secret-token',
      projectName: 'seemoji',
      deploymentId: DEPLOYMENT_ID,
      expectedCommit: COMMIT,
      attempts: 1,
      fetchImpl: async () => apiResponse(deployment(DEPLOYMENT_ID, OTHER_COMMIT)),
    }),
    /unexpected commit/,
  );
});

test('waits until the rollback target becomes canonical', async () => {
  let calls = 0;
  const result = await rollbackPagesDeployment({
    accountId: ACCOUNT_ID,
    apiToken: 'secret-token',
    projectName: 'seemoji',
    deploymentId: DEPLOYMENT_ID,
    expectedCommit: COMMIT,
    attempts: 1,
    canonicalAttempts: 2,
    waitImpl: async () => {},
    fetchImpl: async (_url, options) => {
      calls += 1;
      if (options.method === 'POST') return apiResponse(deployment());
      return canonicalResponse(calls === 2 ? OTHER_DEPLOYMENT_ID : DEPLOYMENT_ID);
    },
  });
  assert.equal(calls, 3);
  assert.equal(result.id, DEPLOYMENT_ID);
});

test('reconciles an ambiguous rollback timeout before retrying the mutation', async () => {
  let calls = 0;
  const result = await rollbackPagesDeployment({
    accountId: ACCOUNT_ID,
    apiToken: 'secret-token',
    projectName: 'seemoji',
    deploymentId: DEPLOYMENT_ID,
    expectedCommit: COMMIT,
    attempts: 1,
    canonicalAttempts: 1,
    fetchImpl: async (_url, options) => {
      calls += 1;
      if (options.method === 'POST') throw new DOMException('timed out', 'TimeoutError');
      return canonicalResponse();
    },
  });
  assert.equal(calls, 3);
  assert.equal(result.id, DEPLOYMENT_ID);
});
