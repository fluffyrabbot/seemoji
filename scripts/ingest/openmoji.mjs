import { execFile } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import {
  OPENMOJI_LICENSE,
  REPOSITORY_ROOT,
  readJson,
  writeGeneratedJson,
} from './canonical.mjs';

const execute = promisify(execFile);
const SAFE_CODEPOINT = /^[0-9a-f]+(?:-[0-9a-f]+)*$/;
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
const pin = pins.packs.openmoji;
if (!pin || pin.format !== 'svg' || pin.defaultStyle !== 'color') {
  throw new Error('OpenMoji color SVG pin is missing');
}

const toCodepoint = (grapheme) => Array.from(grapheme.replace(/\uFE0F/g, ''))
  .map((character) => character.codePointAt(0).toString(16)).join('-');
const canonicalHexcode = (hexcode) => hexcode.split('-')
  .filter((part) => part.toUpperCase() !== 'FE0F')
  .map((part) => Number.parseInt(part, 16).toString(16)).join('-');
const isPrivateUse = (hexcode) => hexcode.split('-').some((part) => {
  const value = Number.parseInt(part, 16);
  return value >= 0xe000 && value <= 0xf8ff;
});

let temporary = null;
let source = suppliedSource;
try {
  if (!source) {
    temporary = await mkdtemp(join(tmpdir(), 'seemoji-openmoji-'));
    source = join(temporary, 'upstream');
    await execute('git', [
      'clone', '--depth', '1', '--branch', pin.ref, '--single-branch',
      pin.repository, source,
    ]);
  }
  const assetDirectory = join(source, 'color/svg');
  const metadata = await readJson(join(source, 'data/openmoji.json'));
  if (!Array.isArray(metadata)) throw new Error('OpenMoji metadata must be an array');
  const entries = metadata
    .filter((entry) => entry.group !== 'extras-openmoji' && entry.group !== 'extras-unicode')
    .filter((entry) => typeof entry.hexcode === 'string' && !isPrivateUse(entry.hexcode))
    .map((entry) => {
      if (typeof entry.emoji !== 'string' || !entry.emoji) {
        throw new Error(`OpenMoji ${entry.hexcode} has no grapheme`);
      }
      const codepoint = canonicalHexcode(entry.hexcode);
      if (codepoint !== toCodepoint(entry.emoji)) {
        throw new Error(`OpenMoji ${entry.hexcode} disagrees with its grapheme`);
      }
      return { codepoint, source: join(assetDirectory, `${entry.hexcode}.svg`) };
    })
    .sort((left, right) => left.codepoint.localeCompare(right.codepoint));
  if (entries.length < 3_500
      || entries.some(({ codepoint }) => !SAFE_CODEPOINT.test(codepoint))
      || new Set(entries.map(({ codepoint }) => codepoint)).size !== entries.length) {
    throw new Error(`OpenMoji inventory is incomplete, duplicated, or invalid (${entries.length})`);
  }
  for (const entry of entries) await readFile(entry.source);

  const manifest = {
    id: 'openmoji',
    name: 'OpenMoji',
    version: pin.snapshotVersion,
    style: 'color',
    format: 'svg',
    license: OPENMOJI_LICENSE,
    unicodeLevel: '17.0',
    assetRoot: `https://cdn.jsdelivr.net/gh/${pins.snapshotRepo}@v1.2.0/packs/openmoji/${pin.snapshotVersion}/color/`,
    maxAssetBytes: 524288,
    upstream: { repository: pin.repository, ref: pin.ref },
    glyphs: entries.map(({ codepoint }) => codepoint),
  };
  await writeGeneratedJson(
    resolve(REPOSITORY_ROOT, `public/packs/openmoji/${pin.snapshotVersion}/color/manifest.json`),
    manifest,
    { check },
  );

  if (stillsRoot) {
    const target = join(stillsRoot, 'packs/openmoji', pin.snapshotVersion, 'color/svg');
    await mkdir(target, { recursive: true });
    for (const entry of entries) {
      const destination = join(target, `${entry.codepoint}.svg`);
      const existing = await readFile(destination).catch(() => null);
      const bytes = await readFile(entry.source);
      if (existing && !existing.equals(bytes)) {
        throw new Error(`published snapshot is write-once: openmoji/${entry.codepoint}.svg differs`);
      }
      if (!existing) await copyFile(entry.source, destination);
    }
    const published = (await readdir(target)).filter((name) => name.endsWith('.svg')).sort();
    const expected = entries.map(({ codepoint }) => `${codepoint}.svg`).sort();
    if (JSON.stringify(published) !== JSON.stringify(expected)) {
      throw new Error('published OpenMoji inventory contains unexpected files');
    }
  }
  console.log(`OpenMoji ${pin.snapshotVersion} color: ${entries.length} Unicode glyphs`);
} finally {
  if (temporary) await rm(temporary, { recursive: true, force: true });
}
