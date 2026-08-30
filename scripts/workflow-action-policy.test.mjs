import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import test from 'node:test';
import { APPROVED_ACTIONS } from './workflow-action-policy.mjs';

const WORKFLOW_DIRECTORY = resolve('.github/workflows');
const ACTION_REFERENCE = /^\s*-?\s*uses:\s*([^@\s]+)@([^\s#]+)(?:\s+#\s*(\S+))?\s*$/gm;
const RUNNER_REFERENCE = /^\s*runs-on:\s*([^\s#]+)\s*$/gm;

test('workflow actions use reviewed Node 24-native immutable pins', async () => {
  const workflowNames = (await readdir(WORKFLOW_DIRECTORY))
    .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
    .sort();
  assert.notEqual(workflowNames.length, 0, 'no GitHub Actions workflows found');

  const seen = new Set();
  let runnerCount = 0;
  for (const workflowName of workflowNames) {
    const source = await readFile(resolve(WORKFLOW_DIRECTORY, workflowName), 'utf8');
    for (const match of source.matchAll(ACTION_REFERENCE)) {
      const [, action, ref, version] = match;
      if (action.startsWith('./')) continue;

      const approved = APPROVED_ACTIONS[action];
      assert.ok(approved, `${workflowName} uses unreviewed action ${action}`);
      assert.equal(ref, approved.sha, `${workflowName} must pin ${action} to its reviewed commit`);
      assert.equal(
        version,
        approved.version,
        `${workflowName} must document the release behind the ${action} pin`,
      );
      seen.add(action);
    }

    for (const match of source.matchAll(RUNNER_REFERENCE)) {
      assert.equal(
        match[1],
        'ubuntu-24.04',
        `${workflowName} must use the reviewed Ubuntu 24.04 runner family`,
      );
      runnerCount += 1;
    }

    assert.doesNotMatch(
      source,
      /^\s+node-version:\s*/m,
      `${basename(workflowName)} must use the repository's exact .node-version pin`,
    );
  }

  assert.notEqual(runnerCount, 0, 'no GitHub-hosted runners found');
  assert.deepEqual(seen, new Set(Object.keys(APPROVED_ACTIONS)));
});
