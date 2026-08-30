import { execFile } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import {
  FLUENT_LICENSE,
  REPOSITORY_ROOT,
  readJson,
  writeGeneratedJson,
} from './canonical.mjs';

const execute = promisify(execFile);
const SAFE_CODEPOINT = /^[0-9a-f]+(?:-[0-9a-f]+)*$/;
const SKIN_FOLDERS = ['Default', 'Light', 'Medium-Light', 'Medium', 'Medium-Dark', 'Dark'];
const STYLE_SPECS = Object.freeze({
  color: { upstream: 'Color', minimumGlyphs: 3_000, maxAssetBytes: 1_048_576 },
  flat: { upstream: 'Flat', minimumGlyphs: 3_000, maxAssetBytes: 65_536 },
  'high-contrast': {
    upstream: 'High Contrast', minimumGlyphs: 1_500, maxAssetBytes: 65_536,
  },
});
const check = process.argv.includes('--check');
const argument = (flag) => {
  const position = process.argv.indexOf(flag);
  if (position < 0) return null;
  const value = process.argv[position + 1];
  if (!value) throw new Error(`${flag} requires a directory`);
  return resolve(value);
};
const suppliedSource = argument('--source');
const stillsRoot = argument('--stills');
const pins = await readJson(resolve(REPOSITORY_ROOT, 'scripts/ingest/pins.json'));
const pin = pins.packs.fluent;
if (!pin || pin.format !== 'svg' || !Array.isArray(pin.versions)
    || !pin.versions.some((version) => version.snapshotVersion === pin.defaultVersion)) {
  throw new Error('Fluent versioned SVG pin is missing');
}

const toCodepoint = (grapheme) => Array.from(grapheme.replace(/\uFE0F/g, ''))
  .map((character) => character.codePointAt(0).toString(16)).join('-');

const graphemeFromUnicodeHex = (sequence) => {
  const parts = sequence.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0 || parts.some((part) => !/^[0-9a-f]+$/i.test(part))) {
    throw new Error(`invalid Fluent Unicode sequence: ${sequence}`);
  }
  return String.fromCodePoint(...parts.map((part) => Number.parseInt(part, 16)));
};

const onlySvg = async (directory) => {
  const files = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith('.svg'));
  if (files.length !== 1) throw new Error(`${directory} must contain exactly one SVG`);
  return join(directory, files[0].name);
};

let temporary = null;
let source = suppliedSource;
try {
  if (!source) {
    temporary = await mkdtemp(join(tmpdir(), 'seemoji-fluent-'));
    source = join(temporary, 'upstream');
    await execute('git', ['clone', '--filter=blob:none', '--no-checkout', pin.repository, source]);
    await execute('git', ['-C', source, 'sparse-checkout', 'set', 'assets']);
    await execute('git', ['-C', source, 'checkout', '--detach', pin.ref]);
  }
  const styles = new Set(pin.versions.flatMap((version) => version.styles));
  if ([...styles].some((style) => !(style in STYLE_SPECS))) {
    throw new Error('Fluent pin names an unsupported style');
  }
  const entriesByStyle = new Map([...styles].map((style) => [style, new Map()]));
  const add = async (style, codepoint, directory) => {
    const entries = entriesByStyle.get(style);
    if (!entries) return;
    if (entries.has(codepoint)) throw new Error(`duplicate Fluent ${style} glyph ${codepoint}`);
    entries.set(codepoint, await onlySvg(directory));
  };

  const assets = join(source, 'assets');
  const folders = (await readdir(assets, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name));
  for (const folder of folders) {
    const root = join(assets, folder.name);
    const metadata = await readJson(join(root, 'metadata.json'));
    if (typeof metadata.glyph !== 'string' || !metadata.glyph) {
      throw new Error(`${folder.name} metadata has no glyph`);
    }
    if (metadata.unicodeSkintones !== undefined) {
      if (!Array.isArray(metadata.unicodeSkintones)
          || metadata.unicodeSkintones.length !== SKIN_FOLDERS.length) {
        throw new Error(`${folder.name} must map every Fluent skin folder`);
      }
      for (const [index, unicode] of metadata.unicodeSkintones.entries()) {
        if (typeof unicode !== 'string') throw new Error(`${folder.name} has invalid skin metadata`);
        const codepoint = toCodepoint(graphemeFromUnicodeHex(unicode));
        for (const style of ['color', 'flat']) {
          const spec = STYLE_SPECS[style];
          await add(style, codepoint, join(root, SKIN_FOLDERS[index], spec.upstream));
        }
        if (index === 0) {
          await add('high-contrast', codepoint,
            join(root, SKIN_FOLDERS[index], STYLE_SPECS['high-contrast'].upstream));
        }
      }
    } else {
      const codepoint = toCodepoint(metadata.glyph);
      for (const style of styles) {
        await add(style, codepoint, join(root, STYLE_SPECS[style].upstream));
      }
    }
  }

  const canonicalByStyle = new Map();
  for (const [style, byCodepoint] of entriesByStyle) {
    const entries = [...byCodepoint].map(([codepoint, file]) => ({ codepoint, source: file }))
      .sort((left, right) => left.codepoint.localeCompare(right.codepoint));
    const spec = STYLE_SPECS[style];
    if (entries.length < spec.minimumGlyphs
        || entries.some(({ codepoint }) => !SAFE_CODEPOINT.test(codepoint))) {
      throw new Error(`Fluent ${style} inventory is incomplete or invalid (${entries.length})`);
    }
    let maximumBytes = 0;
    for (const entry of entries) {
      const bytes = await readFile(entry.source);
      maximumBytes = Math.max(maximumBytes, bytes.byteLength);
    }
    if (maximumBytes > spec.maxAssetBytes) {
      throw new Error(`Fluent ${style} asset exceeds ${spec.maxAssetBytes} bytes`);
    }
    canonicalByStyle.set(style, entries);
  }

  for (const version of pin.versions) {
    if (!version.styles.includes(version.defaultStyle)) {
      throw new Error(`Fluent ${version.snapshotVersion} default style must be listed`);
    }
    for (const style of version.styles) {
      const entries = canonicalByStyle.get(style);
      const spec = STYLE_SPECS[style];
      const manifest = {
        id: 'fluent',
        name: 'Fluent Emoji',
        version: version.snapshotVersion,
        style,
        format: 'svg',
        license: FLUENT_LICENSE,
        unicodeLevel: '15.1',
        assetRoot: `https://cdn.jsdelivr.net/gh/${pins.snapshotRepo}@${version.snapshotTag}/packs/fluent/${version.snapshotVersion}/${style}/`,
        maxAssetBytes: spec.maxAssetBytes,
        upstream: { repository: pin.repository, ref: pin.ref },
        glyphs: entries.map(({ codepoint }) => codepoint),
      };
      await writeGeneratedJson(
        resolve(REPOSITORY_ROOT,
          `public/packs/fluent/${version.snapshotVersion}/${style}/manifest.json`),
        manifest,
        { check },
      );

      if (stillsRoot) {
        const target = join(stillsRoot, 'packs/fluent', version.snapshotVersion, style, 'svg');
        await mkdir(target, { recursive: true });
        for (const entry of entries) {
          const destination = join(target, `${entry.codepoint}.svg`);
          const [existing, bytes] = await Promise.all([
            readFile(destination).catch(() => null),
            readFile(entry.source),
          ]);
          if (existing && !existing.equals(bytes)) {
            throw new Error(`published snapshot is write-once: fluent/${version.snapshotVersion}/${style}/${entry.codepoint}.svg differs`);
          }
          if (!existing) await copyFile(entry.source, destination);
        }
        const published = (await readdir(target)).filter((name) => name.endsWith('.svg')).sort();
        const expected = entries.map(({ codepoint }) => `${codepoint}.svg`).sort();
        if (JSON.stringify(published) !== JSON.stringify(expected)) {
          throw new Error(`published Fluent ${version.snapshotVersion}/${style} inventory differs`);
        }
      }
      console.log(`Fluent Emoji ${version.snapshotVersion} ${style}: ${entries.length} canonical glyphs`);
    }
  }
} finally {
  if (temporary) {
    await rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}
