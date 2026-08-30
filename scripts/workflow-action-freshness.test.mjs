import assert from 'node:assert/strict';
import test from 'node:test';
import { auditWorkflowActions, formatAudit } from './check-workflow-action-freshness.mjs';
import { APPROVED_ACTIONS } from './workflow-action-policy.mjs';

const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { 'content-type': 'application/json' },
});

const githubApi = ({ latest = {}, runtimes = {} } = {}) => async (url) => {
  const parsed = new URL(url);
  const [, , owner, repository, resource, ...rest] = parsed.pathname.split('/');
  const action = `${owner}/${repository}`;
  const approved = APPROVED_ACTIONS[action];
  if (!approved) return json({ message: 'not found' }, 404);
  const resolved = latest[action] ?? approved;

  if (resource === 'releases' && rest[0] === 'latest') {
    return json({ tag_name: resolved.version });
  }
  if (resource === 'commits' && decodeURIComponent(rest[0]) === resolved.version) {
    return json({ sha: resolved.sha });
  }
  if (resource === 'contents' && rest[0] === 'action.yml') {
    const ref = parsed.searchParams.get('ref');
    const runtime = runtimes[`${action}@${ref}`] ?? 'node24';
    return json({ encoding: 'base64', content: Buffer.from(`runs:\n  using: '${runtime}'\n`).toString('base64') });
  }
  return json({ message: 'not found' }, 404);
};

test('accepts current approved releases with the supported runtime', async () => {
  const results = await auditWorkflowActions({ fetchImpl: githubApi() });
  assert.equal(results.length, Object.keys(APPROVED_ACTIONS).length);
  assert.ok(results.every(({ issues }) => issues.length === 0));
  assert.match(formatAudit(results), /^CURRENT actions\/checkout/m);
});

test('reports a newer release and inspects its runtime before adoption', async () => {
  const action = 'actions/download-artifact';
  const latest = { version: 'v8.0.2', sha: 'a'.repeat(40) };
  const results = await auditWorkflowActions({
    fetchImpl: githubApi({
      latest: { [action]: latest },
      runtimes: { [`${action}@${latest.sha}`]: 'node26' },
    }),
  });
  const result = results.find((candidate) => candidate.action === action);
  assert.deepEqual(result?.issues, [
    `latest release is ${latest.version}@${latest.sha}`,
    'latest release uses unsupported runtime node26',
  ]);
});

test('fails closed when GitHub cannot resolve release metadata', async () => {
  await assert.rejects(
    auditWorkflowActions({ fetchImpl: async () => json({ message: 'rate limited' }, 403) }),
    /GitHub API 403/,
  );
});
