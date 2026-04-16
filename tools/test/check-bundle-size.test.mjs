import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { checkBundleSize } from '../check-bundle-size.mjs';

const TEST_DIR = 'tools/test/.tmp-bundle';

describe('checkBundleSize', () => {
  beforeEach(async () => {
    await mkdir(TEST_DIR, { recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  it('passes when total gzipped size is under budget', async () => {
    // Write a small file that gzips to well under 1 KB.
    await writeFile(`${TEST_DIR}/a.js`, 'console.log("small");');
    const result = await checkBundleSize({
      targetDir: TEST_DIR,
      maxGzipKb: 150,
      extensions: ['.js'],
    });
    expect(result.ok).toBe(true);
  });

  it('fails when a file exceeds the budget', async () => {
    // Write a large, high-entropy file that will not gzip below the limit.
    const big = Array.from({ length: 60_000 }, () => Math.random().toString(36)).join('\n');
    await writeFile(`${TEST_DIR}/big.js`, big);
    const result = await checkBundleSize({
      targetDir: TEST_DIR,
      maxGzipKb: 1,
      extensions: ['.js'],
    });
    expect(result.ok).toBe(false);
    expect(result.violations.length).toBeGreaterThan(0);
  });
});
