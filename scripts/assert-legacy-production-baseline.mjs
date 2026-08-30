import { readFile } from 'node:fs/promises';
import { assertLegacyProductionBaseline } from './production-recovery-manifest.mjs';

const identityPath = process.argv[2];
if (!identityPath) {
  throw new Error('Usage: node scripts/assert-legacy-production-baseline.mjs <identity-path>');
}
const canonicalDeployment = JSON.parse(await readFile(identityPath, 'utf8'));
const deployment = await assertLegacyProductionBaseline({ canonicalDeployment });
console.log(
  `Confirmed one-time legacy baseline ${deployment.id} at commit ${deployment.commit}`,
);
