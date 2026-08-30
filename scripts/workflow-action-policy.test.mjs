import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import test from 'node:test';

const WORKFLOW_DIRECTORY = resolve('.github/workflows');
const APPROVED_ACTIONS = new Map([
  ['actions/checkout', {
    sha: '3d3c42e5aac5ba805825da76410c181273ba90b1',
    version: 'v7.0.1',
  }],
  ['actions/setup-node', {
    sha: '820762786026740c76f36085b0efc47a31fe5020',
    version: 'v7.0.0',
  }],
  ['actions/upload-artifact', {
    sha: '043fb46d1a93c77aae656e7c1c64a875d1fc6a0a',
    version: 'v7.0.1',
  }],
  ['actions/download-artifact', {
    sha: '3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c',
    version: 'v8.0.1',
  }],
]);

const ACTION_REFERENCE = /^\s*-?\s*uses:\s*([^@\s]+)@([^\s#]+)(?:\s+#\s*(\S+))?\s*$/gm;

test('workflow actions use reviewed Node 24-native immutable pins', async () => {
  const workflowNames = (await readdir(WORKFLOW_DIRECTORY))
    .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
    .sort();
  assert.notEqual(workflowNames.length, 0, 'no GitHub Actions workflows found');

  const seen = new Set();
  for (const workflowName of workflowNames) {
    const source = await readFile(resolve(WORKFLOW_DIRECTORY, workflowName), 'utf8');
    for (const match of source.matchAll(ACTION_REFERENCE)) {
      const [, action, ref, version] = match;
      if (action.startsWith('./')) continue;

      const approved = APPROVED_ACTIONS.get(action);
      assert.ok(approved, `${workflowName} uses unreviewed action ${action}`);
      assert.equal(ref, approved.sha, `${workflowName} must pin ${action} to its reviewed commit`);
      assert.equal(
        version,
        approved.version,
        `${workflowName} must document the release behind the ${action} pin`,
      );
      seen.add(action);
    }

    assert.doesNotMatch(
      source,
      /^\s+node-version:\s*/m,
      `${basename(workflowName)} must use the repository's exact .node-version pin`,
    );
  }

  assert.deepEqual(seen, new Set(APPROVED_ACTIONS.keys()));
});
