import { fileURLToPath } from 'node:url';
import {
  assertWithinBundleBudgets,
  formatBundleBudgetReport,
  measureJavaScript,
} from './bundle-budget.mjs';

const directory = fileURLToPath(new URL('../dist/', import.meta.url));
const measurements = await measureJavaScript(directory);
console.log(formatBundleBudgetReport(measurements));
assertWithinBundleBudgets(measurements);
