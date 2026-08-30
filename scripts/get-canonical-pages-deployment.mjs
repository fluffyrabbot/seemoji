import { fileURLToPath } from 'node:url';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { getCanonicalPagesDeployment } from './rollback-pages-deployment.mjs';

const fail = (message) => {
  throw new Error(message);
};

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  const projectName = process.argv[2];
  const outputPath = process.argv[3];
  if (!projectName || !outputPath) {
    fail(
      'Usage: node scripts/get-canonical-pages-deployment.mjs '
        + '<project-name> <output-path>',
    );
  }
  const deployment = await getCanonicalPagesDeployment({
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
    apiToken: process.env.CLOUDFLARE_API_TOKEN,
    projectName,
  });
  const identity = {
    id: deployment.id,
    url: deployment.url,
    deployment_trigger: {
      metadata: {
        commit_hash: deployment.deployment_trigger?.metadata?.commit_hash,
      },
    },
  };
  await writeFile(outputPath, `${JSON.stringify(identity, null, 2)}\n`, 'utf8');
  console.log(`Captured canonical production identity ${deployment.id}`);
}
