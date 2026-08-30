import { execFile } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import {
  NOTO_LICENSE,
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
const pin = pins.packs.noto;
if (!pin || pin.format !== 'svg') throw new Error('Noto SVG pin is missing');

let temporary = null;
let source = suppliedSource;
try {
  if (!source) {
    temporary = await mkdtemp(join(tmpdir(), 'seemoji-noto-'));
    source = join(temporary, 'upstream');
    await execute('git', [
      'clone', '--depth', '1', '--branch', pin.ref, '--single-branch',
      pin.repository, source,
    ]);
  }
  const assetDirectory = join(source, 'svg');
  const entries = (await readdir(assetDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && /^emoji_u[0-9a-f_]+\.svg$/i.test(entry.name))
    .map((entry) => ({
      codepoint: entry.name.slice('emoji_u'.length, -'.svg'.length)
        .toLowerCase().split('_').filter((part) => part !== 'fe0f')
        .map((part) => Number.parseInt(part, 16).toString(16)).join('-'),
      source: join(assetDirectory, entry.name),
    }));
  const invalid = entries.find(({ codepoint }) => !SAFE_CODEPOINT.test(codepoint));
  if (invalid) throw new Error(`Noto filename is not canonical: ${basename(invalid.source)}`);
  entries.sort((left, right) => left.codepoint.localeCompare(right.codepoint));
  if (entries.length < 3_000 || new Set(entries.map(({ codepoint }) => codepoint)).size !== entries.length) {
    throw new Error(`Noto inventory is incomplete or duplicated (${entries.length} glyphs)`);
  }

  const manifest = {
    id: 'noto',
    name: 'Noto Emoji',
    version: pin.snapshotVersion,
    style: null,
    format: 'svg',
    license: NOTO_LICENSE,
    unicodeLevel: '15.1',
    assetRoot: `https://cdn.jsdelivr.net/gh/${pins.snapshotRepo}@v1.1.0/packs/noto/${pin.snapshotVersion}/`,
    maxAssetBytes: 524288,
    upstream: { repository: pin.repository, ref: pin.ref },
    glyphs: entries.map(({ codepoint }) => codepoint),
  };
  await writeGeneratedJson(
    resolve(REPOSITORY_ROOT, `public/packs/noto/${pin.snapshotVersion}/manifest.json`),
    manifest,
    { check },
  );

  if (stillsRoot) {
    const target = join(stillsRoot, 'packs/noto', pin.snapshotVersion, 'svg');
    await mkdir(target, { recursive: true });
    for (const entry of entries) {
      const destination = join(target, `${entry.codepoint}.svg`);
      const existing = await readFile(destination).catch(() => null);
      const bytes = await readFile(entry.source);
      if (existing && !existing.equals(bytes)) {
        throw new Error(`published snapshot is write-once: noto/${entry.codepoint}.svg differs`);
      }
      if (!existing) await copyFile(entry.source, destination);
    }
    const published = (await readdir(target)).filter((name) => name.endsWith('.svg')).sort();
    const expected = entries.map(({ codepoint }) => `${codepoint}.svg`).sort();
    if (JSON.stringify(published) !== JSON.stringify(expected)) {
      throw new Error('published Noto inventory contains unexpected files');
    }
  }
  console.log(`Noto Emoji ${pin.snapshotVersion}: ${entries.length} canonical glyphs`);
} finally {
  if (temporary) await rm(temporary, { recursive: true, force: true });
}
