import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

// Set process cwd to repo root so relative paths in tests resolve correctly.
export function setup() {
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');
  process.chdir(repoRoot);
}
