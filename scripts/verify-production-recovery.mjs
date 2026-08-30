import { readFile } from 'node:fs/promises';
import { verifyProductionRecoveryManifest } from './production-recovery-manifest.mjs';

const baseUrl = process.argv[2];
const manifestPath = process.argv[3];
if (!baseUrl || !manifestPath) {
  throw new Error('Usage: node scripts/verify-production-recovery.mjs <base-url> <manifest-path>');
}
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const verified = await verifyProductionRecoveryManifest({ baseUrl, manifest });
console.log(
  `Verified recovered production deployment ${verified.deployment.id} `
    + `at ${baseUrl} (${verified.releaseManifest.files.length} files)`,
);
