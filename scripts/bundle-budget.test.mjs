import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import {
  assertWithinBundleBudgets,
  classifyJavaScript,
  findBudgetFailures,
  findHtmlModuleRoots,
  formatBundleBudgetReport,
  measureJavaScript,
} from './bundle-budget.mjs';

const withBundle = async ({ html, assets }, run) => {
  const directory = await mkdtemp(join(tmpdir(), 'seemoji-bundle-budget-'));
  try {
    await writeFile(join(directory, 'index.html'), html);
    for (const [publicPath, source] of Object.entries(assets)) {
      const assetPath = join(directory, publicPath.slice(1));
      await mkdir(dirname(assetPath), { recursive: true });
      await writeFile(assetPath, source);
    }
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
};

test('classifies HTML entries, modulepreloads, and their complete static import graph as initial', async () => {
  await withBundle({
    html: `<!doctype html>
      <!-- <script type="module" src="/assets/commented-out.js"></script> -->
      <script crossorigin src="/assets/entry.js" type="module"></script>
      <link href="./assets/preloaded.js" rel="preload MODULEPRELOAD">
    `,
    assets: {
      '/assets/entry.js': `
        import './shared.js';
        export { shared } from './reexported.js';
        import('./lazy.js');
      `,
      '/assets/shared.js': `import './static-leaf.js';`,
      '/assets/static-leaf.js': 'export const leaf = true;',
      '/assets/reexported.js': 'export const shared = true;',
      '/assets/preloaded.js': `import './preloaded-leaf.js';`,
      '/assets/preloaded-leaf.js': 'export const preloaded = true;',
      '/assets/lazy.js': `import './lazy-leaf.js';`,
      '/assets/lazy-leaf.js': 'export const lazy = true;',
      '/assets/orphan.js': `import './orphan-leaf.js';`,
      '/assets/orphan-leaf.js': 'export const orphan = true;',
    },
  }, async (directory) => {
    const classification = await classifyJavaScript(directory);
    assert.deepEqual(classification.entrypoints, ['/assets/entry.js']);
    assert.deepEqual(classification.modulePreloads, ['/assets/preloaded.js']);
    assert.deepEqual(classification.initialAssets, [
      '/assets/entry.js',
      '/assets/preloaded-leaf.js',
      '/assets/preloaded.js',
      '/assets/reexported.js',
      '/assets/shared.js',
      '/assets/static-leaf.js',
    ]);
    assert.deepEqual(classification.deferredAssets, [
      '/assets/lazy-leaf.js',
      '/assets/lazy.js',
      '/assets/orphan-leaf.js',
      '/assets/orphan.js',
    ]);
  });
});

test('parses attribute order, rel token lists, root-relative and document-relative roots', () => {
  assert.deepEqual(findHtmlModuleRoots(`
    <link crossorigin rel='stylesheet modulepreload' href='assets/chunk.js'>
    <script defer src=./assets/main.js type=module></script>
  `), {
    entrypoints: ['/assets/main.js'],
    modulePreloads: ['/assets/chunk.js'],
  });
});

test('rejects missing HTML, static-import, and dynamic-import assets independently', async (t) => {
  await t.test('HTML module entrypoint', async () => {
    await withBundle({
      html: '<script type="module" src="/assets/missing.js"></script>',
      assets: { '/assets/orphan.js': '' },
    }, async (directory) => {
      await assert.rejects(
        classifyJavaScript(directory),
        /module entrypoint \/assets\/missing\.js resolves to a missing asset/,
      );
    });
  });

  await t.test('static import', async () => {
    await withBundle({
      html: '<script type="module" src="/assets/main.js"></script>',
      assets: { '/assets/main.js': `import './missing.js';` },
    }, async (directory) => {
      await assert.rejects(
        classifyJavaScript(directory),
        /static import "\.\/missing\.js".*missing asset \/assets\/missing\.js/,
      );
    });
  });

  await t.test('dynamic import', async () => {
    await withBundle({
      html: '<script type="module" src="/assets/main.js"></script>',
      assets: { '/assets/main.js': `import('./missing.js');` },
    }, async (directory) => {
      await assert.rejects(
        classifyJavaScript(directory),
        /dynamic import "\.\/missing\.js".*missing asset \/assets\/missing\.js/,
      );
    });
  });
});

test('fails closed on unsafe or unclassifiable references', async (t) => {
  assert.throws(
    () => findHtmlModuleRoots(
      '<script type="module" src="https://cdn.example/app.js"></script>',
    ),
    /not a safe local JavaScript reference/,
  );
  assert.throws(
    () => findHtmlModuleRoots('<script type="module">import("/assets/app.js")</script>'),
    /inline module scripts are unsupported/,
  );
  assert.throws(
    () => findHtmlModuleRoots(
      '<base href="/nested/"><script type="module" src="assets/app.js"></script>',
    ),
    /<base> is unsupported/,
  );
  assert.throws(
    () => findHtmlModuleRoots(
      '<link rel="module&#112;reload" href="/assets/app.js">'
      + '<script type="module" src="/assets/main.js"></script>',
    ),
    /character references.*unsupported/,
  );
  assert.throws(
    () => findHtmlModuleRoots(
      '<link rel="preload" as="script" href="/assets/eager.js">'
      + '<script type="module" src="/assets/main.js"></script>',
    ),
    /rel="preload" as="script".*unsupported/,
  );

  await t.test('parent traversal', async () => {
    await withBundle({
      html: '<script type="module" src="/assets/main.js"></script>',
      assets: {
        '/assets/main.js': `import '../outside.js';`,
        '/outside.js': '',
      },
    }, async (directory) => {
      await assert.rejects(classifyJavaScript(directory), /contains parent traversal/);
    });
  });

  await t.test('computed dynamic import', async () => {
    await withBundle({
      html: '<script type="module" src="/assets/main.js"></script>',
      assets: { '/assets/main.js': `const chunk = './lazy.js'; import(chunk);` },
    }, async (directory) => {
      await assert.rejects(
        classifyJavaScript(directory),
        /dynamic import.*must use a literal local \.js reference/,
      );
    });
  });

  await t.test('bare module import', async () => {
    await withBundle({
      html: '<script type="module" src="/assets/main.js"></script>',
      assets: { '/assets/main.js': `import 'unexpected-package';` },
    }, async (directory) => {
      await assert.rejects(classifyJavaScript(directory), /bare module reference/);
    });
  });

  await t.test('invalid orphan JavaScript', async () => {
    await withBundle({
      html: '<script type="module" src="/assets/main.js"></script>',
      assets: {
        '/assets/main.js': '',
        '/assets/orphan.js': 'export const =;',
      },
    }, async (directory) => {
      await assert.rejects(classifyJavaScript(directory), /orphan\.js is not valid JavaScript/);
    });
  });
});

test('reports raw and gzip failures independently for each loading class', () => {
  const budgets = {
    initial: { rawBytes: 100, gzipBytes: 50 },
    deferred: { rawBytes: 40, gzipBytes: 20 },
  };
  const compliant = {
    initial: { rawBytes: 100, gzipBytes: 50 },
    deferred: { rawBytes: 40, gzipBytes: 20 },
  };
  assert.deepEqual(findBudgetFailures(compliant, budgets), []);
  assert.doesNotThrow(() => assertWithinBundleBudgets(compliant, budgets));

  const cases = [
    ['initial', 'rawBytes', 101, 'initial raw exceeds its budget by 1 B'],
    ['initial', 'gzipBytes', 52, 'initial gzip-9 exceeds its budget by 2 B'],
    ['deferred', 'rawBytes', 43, 'deferred raw exceeds its budget by 3 B'],
    ['deferred', 'gzipBytes', 24, 'deferred gzip-9 exceeds its budget by 4 B'],
  ];
  for (const [group, field, value, expected] of cases) {
    const measurements = structuredClone(compliant);
    measurements[group][field] = value;
    assert.deepEqual(findBudgetFailures(measurements, budgets), [expected]);
    assert.throws(
      () => assertWithinBundleBudgets(measurements, budgets),
      new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    );
  }
});

test('measures and reports each asset class plus an informational total', async () => {
  await withBundle({
    html: '<script type="module" src="/assets/main.js"></script>',
    assets: {
      '/assets/main.js': `import './shared.js'; import('./lazy.js');`,
      '/assets/shared.js': 'export const shared = true;',
      '/assets/lazy.js': 'export const lazy = true;',
    },
  }, async (directory) => {
    const measurement = await measureJavaScript(directory);
    assert.equal(measurement.initialAssets.length, 2);
    assert.equal(measurement.deferredAssets.length, 1);
    assert.equal(
      measurement.total.rawBytes,
      measurement.initial.rawBytes + measurement.deferred.rawBytes,
    );
    assert.equal(
      measurement.total.gzipBytes,
      measurement.initial.gzipBytes + measurement.deferred.gzipBytes,
    );
    const report = formatBundleBudgetReport(measurement);
    assert.match(report, /initial \(HTML roots and their static import graph\)/);
    assert.match(report, /deferred \(dynamic or otherwise unreachable/);
    assert.match(report, /total \(informational\)/);
  });
});
