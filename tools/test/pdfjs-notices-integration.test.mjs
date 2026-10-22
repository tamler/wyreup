import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { checkPrivacy } from '../check-privacy.mjs';

describe('exact distributed PDF.js passive notices', () => {
  let root;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'wyreup-pdfjs-notices-'));
    await cp('packages/web/public/licenses', join(root, 'licenses'), { recursive: true });
    await cp('packages/web/licenses', join(root, 'licenses'), { recursive: true });
  });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });
  const scan = () => checkPrivacy({ distDir: root, allowlist: [], verifyPdfJsNotices: true });

  it('accepts only the complete pinned PDF.js notice set while preserving other passive notice rules', async () => {
    const result = await scan();
    expect(result.violations.filter(({ file }) => file.includes('pdfjs-dist@6.4.299'))).toEqual([]);
    expect(result.violations.some(({ file }) => file.includes('onnxruntime-web@'))).toBe(true);
  });
  it('still rejects the same Apache URL in an unpinned authored text file', async () => {
    await writeFile(join(root, 'ordinary.txt'), 'http://www.apache.org/licenses/LICENSE-2.0');
    expect((await scan()).violations).toContainEqual({ file: join(root, 'ordinary.txt'), domain: 'www.apache.org' });
  });
  it('refuses a same-length mutation', async () => {
    const path = join(root, 'licenses/pdfjs-dist@6.4.299/LICENSE.txt');
    const bytes = await readFile(path);
    bytes[0] = bytes[0] === 32 ? 33 : 32;
    await writeFile(path, bytes);
    await expect(scan()).rejects.toThrow(/PDF.js|PDFJS|PDF notice/i);
  });
  it('refuses an absent required notice', async () => {
    await rm(join(root, 'licenses/pdfjs-dist@6.4.299/NOTICE.txt'));
    await expect(scan()).rejects.toThrow();
  });
  it('does not exempt a valid license copied to another path', async () => {
    await cp(join(root, 'licenses/pdfjs-dist@6.4.299/LICENSE.txt'), join(root, 'copied.txt'));
    expect((await scan()).violations).toContainEqual({ file: join(root, 'copied.txt'), domain: 'www.apache.org' });
  });
  it('refuses the wrong version even with unchanged notice bytes', async () => {
    await cp(join(root, 'licenses/pdfjs-dist@6.4.299'), join(root, 'licenses/pdfjs-dist@6.4.298'), { recursive: true });
    await rm(join(root, 'licenses/pdfjs-dist@6.4.299'), { recursive: true });
    await expect(scan()).rejects.toThrow();
  });
});
