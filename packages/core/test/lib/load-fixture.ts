import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Load a fixture file as a File object so tests exercise the same shape
 * that browser-dropped files present. Tests for tool modules should always
 * use this helper rather than reading fixtures ad hoc.
 */
export function loadFixture(name: string, mimeType: string): File {
  const path = join(__dirname, '..', 'fixtures', name);
  const buffer = readFileSync(path);
  // Node 20+ has global File.
  return new File([buffer], name, { type: mimeType });
}
