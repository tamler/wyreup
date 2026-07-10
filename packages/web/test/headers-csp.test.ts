/**
 * Regression guard for the Content-Security-Policy in public/_headers.
 *
 * transformers.js v4 / onnxruntime-web bootstrap the ORT wasm backend by
 * creating a Blob of the runtime .mjs and dynamically import()-ing it. Module
 * imports are governed by `script-src`, so without `blob:` there the import is
 * refused ("Failed to fetch dynamically imported module: blob:…") and ORT
 * reports "no available backend found" — breaking every transformers.js tool
 * (transcribe, ocr-pro, text-*, bg-remove, …). This locks the directive in.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const headersPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', '_headers');
const headers = readFileSync(headersPath, 'utf8');

function directive(name: string): string {
  const cspLine = headers.split('\n').find((l) => l.includes('Content-Security-Policy:'));
  expect(cspLine, 'CSP header must exist in _headers').toBeTruthy();
  const csp = cspLine!.split('Content-Security-Policy:')[1] ?? '';
  const match = csp
    .split(';')
    .map((d) => d.trim())
    .find((d) => d.startsWith(`${name} `) || d === name);
  return match ?? '';
}

describe('CSP — _headers', () => {
  it('script-src allows blob: (transformers.js v4 ORT backend import)', () => {
    expect(directive('script-src')).toContain('blob:');
  });

  it('worker-src allows blob: (wasm worker proxy path)', () => {
    expect(directive('worker-src')).toContain('blob:');
  });

  it("script-src keeps 'wasm-unsafe-eval' (WebAssembly compilation)", () => {
    expect(directive('script-src')).toContain("'wasm-unsafe-eval'");
  });

  it('connect-src permits the first-party model host', () => {
    expect(directive('connect-src')).toContain('https://models.wyreup.com');
  });
});
