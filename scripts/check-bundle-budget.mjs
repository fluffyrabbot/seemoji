import { readdir, readFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';

const DIST_DIRECTORY = new URL('../dist/', import.meta.url);
// The synchronous workspace journal plus the strictly decoded emoji catalog,
// version-scoped session orchestration, coverage gating, and dynamic attribution
// produce a measured 155,429 B / 46,750 B gzip-9 baseline after all eight
// canonical packs, version-scoped Fluent styles, unified pack operations, picker art, and license UI.
// Glyph inventories remain static JSON and artwork remains external.
const JAVASCRIPT_BUDGET = Object.freeze({
  rawBytes: 156_000,
  gzipBytes: 47_000,
});

const collectJavaScript = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const url = new URL(entry.name, directory);
      if (entry.isDirectory()) return collectJavaScript(new URL(`${entry.name}/`, directory));
      return entry.isFile() && entry.name.endsWith('.js') ? [url] : [];
    }),
  );
  return nested.flat().sort((left, right) => left.href.localeCompare(right.href));
};

const assets = await collectJavaScript(DIST_DIRECTORY);
if (assets.length === 0) {
  throw new Error('Bundle budget could not find any JavaScript assets in dist/. Run the build first.');
}

const measurements = await Promise.all(
  assets.map(async (asset) => {
    const bytes = await readFile(asset);
    return {
      asset: asset.pathname.split('/').at(-1),
      rawBytes: bytes.byteLength,
      gzipBytes: gzipSync(bytes, { level: 9 }).byteLength,
    };
  }),
);

const totals = measurements.reduce(
  (sum, measurement) => ({
    rawBytes: sum.rawBytes + measurement.rawBytes,
    gzipBytes: sum.gzipBytes + measurement.gzipBytes,
  }),
  { rawBytes: 0, gzipBytes: 0 },
);

console.log('Production JavaScript bundle budget');
for (const measurement of measurements) {
  console.log(
    `  ${measurement.asset}: ${measurement.rawBytes} B raw, ${measurement.gzipBytes} B gzip-9`,
  );
}
console.log(
  `  total: ${totals.rawBytes}/${JAVASCRIPT_BUDGET.rawBytes} B raw, ` +
    `${totals.gzipBytes}/${JAVASCRIPT_BUDGET.gzipBytes} B gzip-9`,
);

const failures = [];
if (totals.rawBytes > JAVASCRIPT_BUDGET.rawBytes) {
  failures.push(`raw total exceeds its budget by ${totals.rawBytes - JAVASCRIPT_BUDGET.rawBytes} B`);
}
if (totals.gzipBytes > JAVASCRIPT_BUDGET.gzipBytes) {
  failures.push(
    `gzip-9 total exceeds its budget by ${totals.gzipBytes - JAVASCRIPT_BUDGET.gzipBytes} B`,
  );
}
if (failures.length > 0) {
  throw new Error(`Production JavaScript bundle budget failed: ${failures.join('; ')}`);
}
