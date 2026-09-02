import { readdir, readFile } from 'node:fs/promises';
import { join, posix, resolve, sep } from 'node:path';
import { gzipSync } from 'node:zlib';
import ts from 'typescript';

export const JAVASCRIPT_BUDGETS = Object.freeze({
  initial: Object.freeze({
    rawBytes: 169_000,
    gzipBytes: 51_000,
  }),
  deferred: Object.freeze({
    rawBytes: 12_000,
    gzipBytes: 4_000,
  }),
});

const SAFE_PUBLIC_PATH = /^\/[A-Za-z0-9._/-]+$/;
const EXTERNAL_REFERENCE = /^(?:[A-Za-z][A-Za-z\d+.-]*:|\/\/)/;
const hasControlCharacter = (value) => [...value].some((character) => {
  const codePoint = character.codePointAt(0);
  return codePoint <= 31 || codePoint === 127;
});

const fail = (message) => {
  throw new Error(`Production JavaScript bundle classification failed: ${message}`);
};

const collectRelativeJavaScript = async (directory, nestedDirectory = '') => {
  const entries = await readdir(join(directory, nestedDirectory), { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const child = nestedDirectory ? `${nestedDirectory}/${entry.name}` : entry.name;
    if (entry.isDirectory()) return collectRelativeJavaScript(directory, child);
    return entry.isFile() && entry.name.endsWith('.js') ? [child] : [];
  }));
  return nested.flat().sort();
};

const scanTags = (html) => {
  const tags = [];
  const tagStart = /<(script|link|base)\b/gi;
  let match;
  while ((match = tagStart.exec(html)) !== null) {
    const commentStart = html.lastIndexOf('<!--', match.index);
    const commentEnd = html.lastIndexOf('-->', match.index);
    if (commentStart > commentEnd) continue;

    let quote;
    let end = tagStart.lastIndex;
    for (; end < html.length; end += 1) {
      const character = html[end];
      if (quote !== undefined) {
        if (character === quote) quote = undefined;
      } else if (character === '"' || character === "'") {
        quote = character;
      } else if (character === '>') {
        break;
      }
    }
    if (end === html.length) fail(`unterminated <${match[1].toLowerCase()}> tag in index.html`);
    tags.push({
      name: match[1].toLowerCase(),
      attributes: html.slice(tagStart.lastIndex, end),
    });
    tagStart.lastIndex = end + 1;
  }
  return tags;
};

const parseAttributes = ({ name, attributes }) => {
  const parsed = new Map();
  let offset = 0;
  while (offset < attributes.length) {
    while (/\s/.test(attributes[offset] ?? '')) offset += 1;
    if (offset === attributes.length || attributes[offset] === '/') break;

    const nameMatch = /^[^\s"'=<>`/]+/.exec(attributes.slice(offset));
    if (!nameMatch) fail(`cannot safely parse <${name}> attributes in index.html`);
    const attributeName = nameMatch[0].toLowerCase();
    offset += nameMatch[0].length;
    while (/\s/.test(attributes[offset] ?? '')) offset += 1;

    let value = '';
    if (attributes[offset] === '=') {
      offset += 1;
      while (/\s/.test(attributes[offset] ?? '')) offset += 1;
      const quote = attributes[offset];
      if (quote === '"' || quote === "'") {
        offset += 1;
        const valueEnd = attributes.indexOf(quote, offset);
        if (valueEnd === -1) fail(`unterminated ${attributeName} attribute in <${name}>`);
        value = attributes.slice(offset, valueEnd);
        offset = valueEnd + 1;
      } else {
        const valueMatch = /^[^\s"'=<>`]+/.exec(attributes.slice(offset));
        if (!valueMatch) fail(`missing ${attributeName} value in <${name}>`);
        value = valueMatch[0];
        offset += value.length;
      }
    }
    if (parsed.has(attributeName)) {
      fail(`duplicate ${attributeName} attribute in <${name}> is ambiguous`);
    }
    parsed.set(attributeName, value);
  }
  return parsed;
};

const referenceContext = (kind, reference, importer) =>
  importer === '/index.html'
    ? `${kind} ${JSON.stringify(reference)} in index.html`
    : `${kind} ${JSON.stringify(reference)} from ${importer}`;

const resolveJavaScriptReference = (reference, importer, kind) => {
  const context = referenceContext(kind, reference, importer);
  if (
    typeof reference !== 'string'
    || reference.length === 0
    || hasControlCharacter(reference)
    || EXTERNAL_REFERENCE.test(reference)
    || reference.includes('\\')
    || reference.includes('?')
    || reference.includes('#')
    || reference.includes('%')
  ) {
    fail(`${context} is not a safe local JavaScript reference`);
  }
  if (importer !== '/index.html' && !reference.startsWith('.') && !reference.startsWith('/')) {
    fail(`${context} is a bare module reference and cannot be classified without an import map`);
  }

  const referenceSegments = reference.split('/');
  if (referenceSegments.includes('..')) {
    fail(`${context} contains parent traversal and is not a normalized emitted reference`);
  }
  const publicPath = reference.startsWith('/')
    ? posix.normalize(reference)
    : posix.resolve(posix.dirname(importer), reference);
  if (
    !SAFE_PUBLIC_PATH.test(publicPath)
    || publicPath.includes('//')
    || !publicPath.endsWith('.js')
  ) {
    fail(`${context} does not resolve to a safe .js public path`);
  }
  return publicPath;
};

export const findHtmlModuleRoots = (html) => {
  const entrypoints = [];
  const modulePreloads = [];
  for (const tag of scanTags(html)) {
    if (tag.attributes.includes('&')) {
      fail(`HTML character references in <${tag.name}> attributes are unsupported`);
    }
    const attributes = parseAttributes(tag);
    if (tag.name === 'base') {
      fail('<base> is unsupported because it changes document-relative module resolution');
    }
    if (tag.name === 'script') {
      const type = attributes.get('type')?.trim().toLowerCase();
      const source = attributes.get('src');
      if (source !== undefined && type !== 'module') {
        fail(`external <script src=${JSON.stringify(source)}> is not type="module"`);
      }
      if (type !== 'module') continue;
      if (source === undefined || source.length === 0) {
        fail('inline module scripts are unsupported because their imports cannot be asset-audited');
      }
      entrypoints.push(resolveJavaScriptReference(source, '/index.html', 'module entrypoint'));
      continue;
    }

    const rel = new Set(
      (attributes.get('rel') ?? '').toLowerCase().split(/\s+/).filter(Boolean),
    );
    if (rel.has('preload') && attributes.get('as')?.trim().toLowerCase() === 'script') {
      fail('<link rel="preload" as="script"> is unsupported; use modulepreload');
    }
    if (!rel.has('modulepreload')) continue;
    const source = attributes.get('href');
    if (source === undefined || source.length === 0) {
      fail('<link rel="modulepreload"> is missing href');
    }
    modulePreloads.push(resolveJavaScriptReference(source, '/index.html', 'modulepreload'));
  }

  const roots = {
    entrypoints: [...new Set(entrypoints)].sort(),
    modulePreloads: [...new Set(modulePreloads)].sort(),
  };
  if (roots.entrypoints.length === 0) fail('index.html has no JavaScript module entrypoint');
  return roots;
};

const diagnosticText = (diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ');

export const findJavaScriptModuleReferences = (publicPath, source) => {
  const sourceFile = ts.createSourceFile(
    publicPath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  if (sourceFile.parseDiagnostics.length > 0) {
    fail(`${publicPath} is not valid JavaScript: ${diagnosticText(sourceFile.parseDiagnostics[0])}`);
  }

  const references = [];
  const addReference = (kind, specifier) => {
    const reference = specifier.text;
    references.push({
      kind,
      publicPath: resolveJavaScriptReference(reference, publicPath, `${kind} import`),
      reference,
    });
  };
  const visit = (node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
      && node.moduleSpecifier !== undefined
    ) {
      if (!ts.isStringLiteralLike(node.moduleSpecifier)) {
        fail(`static import in ${publicPath} does not have a literal module reference`);
      }
      addReference('static', node.moduleSpecifier);
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const [specifier] = node.arguments;
      if (specifier === undefined || !ts.isStringLiteralLike(specifier)) {
        fail(`dynamic import in ${publicPath} must use a literal local .js reference`);
      }
      addReference('dynamic', specifier);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return references;
};

const assertReferencedAssetExists = (assets, reference, importer) => {
  if (!assets.has(reference.publicPath)) {
    fail(
      `${reference.kind} import ${JSON.stringify(reference.reference)} from ${importer} `
      + `resolves to missing asset ${reference.publicPath}`,
    );
  }
};

export const classifyJavaScript = async (directory) => {
  const root = resolve(directory);
  const relativeAssets = await collectRelativeJavaScript(root);
  if (relativeAssets.length === 0) {
    fail('no JavaScript assets exist in dist; run the production build first');
  }

  const assets = new Map(await Promise.all(relativeAssets.map(async (relativePath) => {
    const publicPath = `/${relativePath.split(sep).join('/')}`;
    return [publicPath, await readFile(join(root, relativePath))];
  })));
  const html = await readFile(join(root, 'index.html'), 'utf8');
  const roots = findHtmlModuleRoots(html);
  for (const [kind, paths] of [
    ['module entrypoint', roots.entrypoints],
    ['modulepreload', roots.modulePreloads],
  ]) {
    for (const publicPath of paths) {
      if (!assets.has(publicPath)) fail(`${kind} ${publicPath} resolves to a missing asset`);
    }
  }

  const references = new Map();
  for (const [publicPath, bytes] of assets) {
    const assetReferences = findJavaScriptModuleReferences(publicPath, bytes.toString('utf8'));
    for (const reference of assetReferences) {
      assertReferencedAssetExists(assets, reference, publicPath);
    }
    references.set(publicPath, assetReferences);
  }

  const initial = new Set([...roots.entrypoints, ...roots.modulePreloads]);
  const pending = [...initial];
  while (pending.length > 0) {
    const importer = pending.pop();
    for (const reference of references.get(importer) ?? []) {
      if (reference.kind !== 'static' || initial.has(reference.publicPath)) continue;
      initial.add(reference.publicPath);
      pending.push(reference.publicPath);
    }
  }

  const allAssets = [...assets.keys()].sort();
  return {
    ...roots,
    allAssets,
    initialAssets: allAssets.filter((publicPath) => initial.has(publicPath)),
    deferredAssets: allAssets.filter((publicPath) => !initial.has(publicPath)),
    bytesByAsset: assets,
  };
};

const sumMeasurements = (measurements) => measurements.reduce(
  (totals, measurement) => ({
    rawBytes: totals.rawBytes + measurement.rawBytes,
    gzipBytes: totals.gzipBytes + measurement.gzipBytes,
  }),
  { rawBytes: 0, gzipBytes: 0 },
);

export const measureJavaScript = async (directory) => {
  const classification = await classifyJavaScript(directory);
  const { bytesByAsset, ...metadata } = classification;
  const measurementByAsset = new Map(classification.allAssets.map((publicPath) => {
    const bytes = bytesByAsset.get(publicPath);
    return [publicPath, {
      publicPath,
      rawBytes: bytes.byteLength,
      gzipBytes: gzipSync(bytes, { level: 9 }).byteLength,
    }];
  }));
  const initialAssets = classification.initialAssets.map((path) => measurementByAsset.get(path));
  const deferredAssets = classification.deferredAssets.map((path) => measurementByAsset.get(path));
  const initial = sumMeasurements(initialAssets);
  const deferred = sumMeasurements(deferredAssets);
  return {
    ...metadata,
    initialAssets,
    deferredAssets,
    initial,
    deferred,
    total: {
      rawBytes: initial.rawBytes + deferred.rawBytes,
      gzipBytes: initial.gzipBytes + deferred.gzipBytes,
    },
  };
};

export const findBudgetFailures = (measurements, budgets = JAVASCRIPT_BUDGETS) => {
  const failures = [];
  for (const group of ['initial', 'deferred']) {
    const measured = measurements[group];
    const budget = budgets[group];
    if (measured.rawBytes > budget.rawBytes) {
      failures.push(
        `${group} raw exceeds its budget by ${measured.rawBytes - budget.rawBytes} B`,
      );
    }
    if (measured.gzipBytes > budget.gzipBytes) {
      failures.push(
        `${group} gzip-9 exceeds its budget by ${measured.gzipBytes - budget.gzipBytes} B`,
      );
    }
  }
  return failures;
};

export const assertWithinBundleBudgets = (measurements, budgets = JAVASCRIPT_BUDGETS) => {
  const failures = findBudgetFailures(measurements, budgets);
  if (failures.length > 0) {
    throw new Error(`Production JavaScript bundle budget failed: ${failures.join('; ')}`);
  }
};

const formatGroup = (name, measurements, budget) => {
  const lines = [`  ${name}:`];
  if (measurements.assets.length === 0) lines.push('    (no assets)');
  for (const asset of measurements.assets) {
    lines.push(`    ${asset.publicPath}: ${asset.rawBytes} B raw, ${asset.gzipBytes} B gzip-9`);
  }
  lines.push(
    `    subtotal: ${measurements.totals.rawBytes}/${budget.rawBytes} B raw, `
    + `${measurements.totals.gzipBytes}/${budget.gzipBytes} B gzip-9`,
  );
  return lines;
};

export const formatBundleBudgetReport = (measurements, budgets = JAVASCRIPT_BUDGETS) => [
  'Production JavaScript bundle budget',
  ...formatGroup('initial (HTML roots and their static import graph)', {
    assets: measurements.initialAssets,
    totals: measurements.initial,
  }, budgets.initial),
  ...formatGroup('deferred (dynamic or otherwise unreachable from initial roots)', {
    assets: measurements.deferredAssets,
    totals: measurements.deferred,
  }, budgets.deferred),
  `  total (informational): ${measurements.total.rawBytes} B raw, `
    + `${measurements.total.gzipBytes} B gzip-9`,
].join('\n');
