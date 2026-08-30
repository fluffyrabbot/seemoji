import { execFile } from 'node:child_process';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import {
  REPOSITORY_ROOT,
  TWEMOJI_LICENSE,
  readJson,
  writeGeneratedJson,
} from './canonical.mjs';

const execute = promisify(execFile);
const SAFE_CODEPOINT = /^[0-9a-f]+(?:-[0-9a-f]+)*$/;
const check = process.argv.includes('--check');
const sourceFlag = process.argv.indexOf('--source');
const suppliedSource = sourceFlag >= 0 ? process.argv[sourceFlag + 1] : null;
if (sourceFlag >= 0 && !suppliedSource) throw new Error('--source requires a directory');

const pins = await readJson(resolve(REPOSITORY_ROOT, 'scripts/ingest/pins.json'));
const pin = pins.packs.twemoji;
if (!pin || pin.format !== 'svg') throw new Error('Twemoji SVG pin is missing');

let temporary = null;
let source = suppliedSource ? resolve(suppliedSource) : null;
try {
  if (!source) {
    temporary = await mkdtemp(join(tmpdir(), 'seemoji-twemoji-'));
    source = join(temporary, 'upstream');
    await execute('git', [
      'clone', '--depth', '1', '--branch', pin.ref, '--single-branch',
      pin.repository, source,
    ]);
  }
  const assetDirectory = join(source, 'assets/svg');
  const assetNames = (await readdir(assetDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith('.svg'))
    .map((entry) => entry.name.slice(0, -4).toLowerCase().replace(/_/g, '-'));
  const invalid = assetNames.find((codepoint) => !SAFE_CODEPOINT.test(codepoint));
  if (invalid) throw new Error(`Twemoji filename is not canonical: ${invalid}`);
  const glyphs = assetNames.sort();
  if (glyphs.length < 3_000 || new Set(glyphs).size !== glyphs.length) {
    throw new Error(`Twemoji inventory is incomplete or duplicated (${glyphs.length} glyphs)`);
  }

  const manifest = {
    id: 'twemoji',
    name: 'Twemoji',
    version: pin.snapshotVersion,
    style: null,
    format: 'svg',
    license: TWEMOJI_LICENSE,
    unicodeLevel: '15.1',
    assetRoot: `https://cdn.jsdelivr.net/gh/${pins.snapshotRepo}@v1.0.0/packs/twemoji/${pin.snapshotVersion}/`,
    maxAssetBytes: 524288,
    upstream: { repository: pin.repository, ref: pin.ref },
    glyphs,
  };
  await writeGeneratedJson(
    resolve(REPOSITORY_ROOT, `public/packs/twemoji/${pin.snapshotVersion}/manifest.json`),
    manifest,
    { check },
  );
  console.log(`Twemoji ${pin.snapshotVersion}: ${glyphs.length} canonical glyphs`);
} finally {
  if (temporary) await rm(temporary, { recursive: true, force: true });
}
