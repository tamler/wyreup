import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// html-to-pdf is browser-only: its run() throws in Node because html2canvas
// needs a real DOM, and the html2canvas/jspdf modules are browser-only. We
// therefore can't exercise run() in the Node vitest runner. Instead we assert
// the load-bearing security property directly from the source: the iframe that
// renders untrusted user HTML is sandboxed WITHOUT allow-scripts (so inline
// <script> / event handlers can't execute in the wyreup.com origin) while
// keeping allow-same-origin (so html2canvas can still read the iframe to
// screenshot it).
const SRC = readFileSync(
  join(__dirname, '..', '..', '..', 'src', 'tools', 'html-to-pdf', 'index.ts'),
  'utf8',
);

describe('html-to-pdf — iframe sandbox', () => {
  it('sets the sandbox attribute to allow-same-origin', () => {
    expect(SRC).toContain("iframe.setAttribute('sandbox', 'allow-same-origin')");
  });

  it('does NOT grant allow-scripts in the sandbox attribute value', () => {
    // Inspect the actual setAttribute('sandbox', '…') value, not the whole
    // file (the surrounding explanatory comment legitimately names the flag).
    const m = SRC.match(/setAttribute\('sandbox',\s*'([^']*)'\)/);
    expect(m).not.toBeNull();
    const value = m![1]!;
    expect(value).toContain('allow-same-origin');
    expect(value).not.toContain('allow-scripts');
  });

  it('sandboxes the iframe before appending it to the DOM', () => {
    const sandboxIdx = SRC.indexOf("setAttribute('sandbox'");
    const appendIdx = SRC.indexOf('document.body.appendChild(iframe)');
    expect(sandboxIdx).toBeGreaterThan(-1);
    expect(appendIdx).toBeGreaterThan(-1);
    expect(sandboxIdx).toBeLessThan(appendIdx);
  });
});
