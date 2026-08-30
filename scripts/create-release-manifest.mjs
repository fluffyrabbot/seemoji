import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import {
  createReleaseManifest,
  resolveReleaseCommit,
} from './release-manifest.mjs';

const directory = resolve(process.argv[2] ?? fileURLToPath(new URL('../dist/', import.meta.url)));
const commit = await resolveReleaseCommit();
const manifest = await createReleaseManifest(directory, commit);
console.log(
  `Created release manifest for ${manifest.commit} covering ${manifest.files.length} files`,
);
