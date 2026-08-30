import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  resolveReleaseCommit,
  verifyReleaseDirectory,
} from './release-manifest.mjs';

const directory = resolve(process.argv[2] ?? fileURLToPath(new URL('../dist/', import.meta.url)));
const expectedCommit = process.argv[3] ?? await resolveReleaseCommit();
const manifest = await verifyReleaseDirectory(directory, expectedCommit);
console.log(
  `Verified immutable release artifact for ${manifest.commit} (${manifest.files.length} files)`,
);
