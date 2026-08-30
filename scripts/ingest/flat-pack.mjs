import { execFile } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { REPOSITORY_ROOT, readJson, writeGeneratedJson } from './canonical.mjs';

const execute = promisify(execFile);
const SAFE_CODEPOINT = /^[0-9a-f]+(?:-[0-9a-f]+)*$/;

const argument = (flag) => {
  const position = process.argv.indexOf(flag);
  if (position < 0) return null;
  const value = process.argv[position + 1];
  if (!value) throw new Error(`${flag} requires a directory`);
  return resolve(value);
};

export const canonicalSequence = (parts) => parts
  .filter((part) => part.toLowerCase() !== 'fe0f')
  .map((part) => Number.parseInt(part, 16).toString(16))
  .join('-');

export async function ingestFlatPack(config) {
  const check = process.argv.includes('--check');
  const suppliedSource = argument('--source');
  const stillsRoot = argument('--stills');
  const pins = await readJson(resolve(REPOSITORY_ROOT, 'scripts/ingest/pins.json'));
  const pin = pins.packs[config.id];
  if (!pin || pin.format !== config.format) throw new Error(`${config.name} pin is missing`);

  let temporary = null;
  let source = suppliedSource;
  try {
    if (!source) {
      temporary = await mkdtemp(join(tmpdir(), `seemoji-${config.id}-`));
      source = join(temporary, 'upstream');
      await execute('git', ['clone', '--filter=blob:none', '--no-checkout', pin.repository, source]);
      await execute('git', ['-C', source, 'sparse-checkout', 'set', config.assetDirectory]);
      await execute('git', ['-C', source, 'checkout', '--detach', pin.ref]);
    }
    const assetDirectory = join(source, config.assetDirectory);
    const candidates = (await readdir(assetDirectory, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith(`.${config.format}`))
      .map((entry) => ({ name: entry.name, source: join(assetDirectory, entry.name) }));
    const entries = candidates.map((entry) => ({
      ...entry,
      codepoint: config.codepointFor(entry.name),
    })).filter((entry) => entry.codepoint !== null)
      .sort((left, right) => left.codepoint.localeCompare(right.codepoint));
    const invalid = entries.find(({ codepoint }) => !SAFE_CODEPOINT.test(codepoint));
    if (invalid
        || entries.length < config.minimumGlyphs
        || new Set(entries.map(({ codepoint }) => codepoint)).size !== entries.length) {
      throw new Error(`${config.name} inventory is incomplete, duplicated, or invalid (${entries.length})`);
    }
    let maximumBytes = 0;
    for (const entry of entries) {
      const bytes = await readFile(entry.source);
      if (bytes.byteLength === 0) throw new Error(`${basename(entry.source)} is empty`);
      maximumBytes = Math.max(maximumBytes, bytes.byteLength);
    }
    if (maximumBytes > config.maxAssetBytes) {
      throw new Error(`${config.name} asset exceeds ${config.maxAssetBytes} bytes`);
    }

    const manifest = {
      id: config.id,
      name: config.name,
      version: pin.snapshotVersion,
      style: null,
      format: config.format,
      license: config.license,
      unicodeLevel: config.unicodeLevel,
      assetRoot: `https://cdn.jsdelivr.net/gh/${pins.snapshotRepo}@v1.3.0/packs/${config.id}/${pin.snapshotVersion}/`,
      maxAssetBytes: config.maxAssetBytes,
      upstream: { repository: pin.repository, ref: pin.ref },
      glyphs: entries.map(({ codepoint }) => codepoint),
    };
    await writeGeneratedJson(
      resolve(REPOSITORY_ROOT, `public/packs/${config.id}/${pin.snapshotVersion}/manifest.json`),
      manifest,
      { check },
    );

    if (stillsRoot) {
      const target = join(stillsRoot, 'packs', config.id, pin.snapshotVersion, config.format);
      await mkdir(target, { recursive: true });
      for (const entry of entries) {
        const destination = join(target, `${entry.codepoint}.${config.format}`);
        const [existing, bytes] = await Promise.all([
          readFile(destination).catch(() => null),
          readFile(entry.source),
        ]);
        if (existing && !existing.equals(bytes)) {
          throw new Error(`published snapshot is write-once: ${config.id}/${entry.codepoint}.${config.format} differs`);
        }
        if (!existing) await copyFile(entry.source, destination);
      }
      const published = (await readdir(target))
        .filter((name) => name.endsWith(`.${config.format}`)).sort();
      const expected = entries.map(({ codepoint }) => `${codepoint}.${config.format}`).sort();
      if (JSON.stringify(published) !== JSON.stringify(expected)) {
        throw new Error(`published ${config.name} inventory contains unexpected files`);
      }
    }
    console.log(`${config.name} ${pin.snapshotVersion}: ${entries.length} canonical glyphs (${config.format})`);
  } finally {
    if (temporary) {
      await rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  }
}
