import { fileURLToPath } from 'node:url';
import {
  APPROVED_ACTIONS,
  SUPPORTED_ACTION_RUNTIME,
} from './workflow-action-policy.mjs';

const DEFAULT_API_ROOT = 'https://api.github.com';
const SHA = /^[0-9a-f]{40}$/;

const requestJson = async (path, { apiRoot, fetchImpl, token }) => {
  const headers = {
    accept: 'application/vnd.github+json',
    'user-agent': 'seemoji-workflow-action-audit',
    'x-github-api-version': '2022-11-28',
  };
  if (token) headers.authorization = `Bearer ${token}`;

  const response = await fetchImpl(`${apiRoot}${path}`, { headers });
  if (!response.ok) {
    throw new Error(`GitHub API ${response.status} for ${path}`);
  }
  return response.json();
};

const actionRuntime = async (action, ref, options) => {
  const payload = await requestJson(
    `/repos/${action}/contents/action.yml?ref=${encodeURIComponent(ref)}`,
    options,
  );
  if (typeof payload.content !== 'string' || payload.encoding !== 'base64') {
    throw new Error(`${action}@${ref} did not return a base64 action.yml`);
  }
  const source = Buffer.from(payload.content.replaceAll('\n', ''), 'base64').toString('utf8');
  const runtime = source.match(/^\s*using:\s*['"]?(node\d+)['"]?\s*$/m)?.[1];
  if (!runtime) throw new Error(`${action}@${ref} does not declare a Node action runtime`);
  return runtime;
};

export const auditWorkflowActions = async ({
  actions = APPROVED_ACTIONS,
  apiRoot = DEFAULT_API_ROOT,
  fetchImpl = fetch,
  token = process.env.GITHUB_TOKEN,
} = {}) => {
  const options = { apiRoot, fetchImpl, token };
  const results = [];

  for (const [action, approved] of Object.entries(actions)) {
    const release = await requestJson(`/repos/${action}/releases/latest`, options);
    if (typeof release.tag_name !== 'string') {
      throw new Error(`${action} latest release did not name a tag`);
    }
    const commit = await requestJson(
      `/repos/${action}/commits/${encodeURIComponent(release.tag_name)}`,
      options,
    );
    if (typeof commit.sha !== 'string' || !SHA.test(commit.sha)) {
      throw new Error(`${action}@${release.tag_name} did not resolve to a full commit SHA`);
    }

    const pinnedRuntime = await actionRuntime(action, approved.sha, options);
    const latestRuntime = commit.sha === approved.sha
      ? pinnedRuntime
      : await actionRuntime(action, commit.sha, options);
    const issues = [];
    if (pinnedRuntime !== SUPPORTED_ACTION_RUNTIME) {
      issues.push(`approved pin uses ${pinnedRuntime}, expected ${SUPPORTED_ACTION_RUNTIME}`);
    }
    if (release.tag_name !== approved.version || commit.sha !== approved.sha) {
      issues.push(`latest release is ${release.tag_name}@${commit.sha}`);
    }
    if (latestRuntime !== SUPPORTED_ACTION_RUNTIME) {
      issues.push(`latest release uses unsupported runtime ${latestRuntime}`);
    }

    results.push({
      action,
      approved,
      pinnedRuntime,
      latest: { version: release.tag_name, sha: commit.sha, runtime: latestRuntime },
      issues,
    });
  }

  return results;
};

export const formatAudit = (results) => results.map((result) => {
  const prefix = result.issues.length === 0 ? 'CURRENT' : 'REVIEW';
  const summary = `${prefix} ${result.action} ${result.approved.version}`
    + ` ${result.approved.sha} ${result.pinnedRuntime}`;
  return result.issues.length === 0
    ? summary
    : `${summary}\n  - ${result.issues.join('\n  - ')}`;
}).join('\n');

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  try {
    const results = await auditWorkflowActions();
    console.log(formatAudit(results));
    if (results.some(({ issues }) => issues.length > 0)) process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
