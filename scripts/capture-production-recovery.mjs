import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { captureProductionRecoveryManifest } from './production-recovery-manifest.mjs';

export async function writeProductionRecoveryBundle(outputDirectory, manifest) {
  await mkdir(outputDirectory, { recursive: true });
  await Promise.all([
    writeFile(
      join(outputDirectory, 'recovery.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
      'utf8',
    ),
    writeFile(
      join(outputDirectory, 'release-manifest.json'),
      `${JSON.stringify(manifest.releaseManifest, null, 2)}\n`,
      'utf8',
    ),
  ]);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  const identityPath = process.argv[2];
  const outputDirectory = process.argv[3];
  if (!identityPath || !outputDirectory) {
    throw new Error(
      'Usage: node scripts/capture-production-recovery.mjs '
        + '<canonical-identity-path> <output-directory>',
    );
  }
  const canonicalDeployment = JSON.parse(await readFile(identityPath, 'utf8'));
  const manifest = await captureProductionRecoveryManifest({ canonicalDeployment });
  await writeProductionRecoveryBundle(outputDirectory, manifest);
  console.log(
    `Captured exact known-good production deployment ${manifest.deployment.id} `
      + `(${manifest.releaseManifest.files.length} files)`,
  );
}
