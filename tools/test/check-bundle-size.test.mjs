import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { checkBundleSize, checkPagesFileSize } from '../check-bundle-size.mjs';

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

describe('checkPagesFileSize', () => {
  beforeEach(async () => {
    await mkdir(TEST_DIR, { recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  it('flags a file over the Pages per-file limit', async () => {
    await writeFile(`${TEST_DIR}/big.wasm`, Buffer.alloc(2048));
    const result = await checkPagesFileSize({ targetDir: TEST_DIR, limitBytes: 1024 });
    expect(result.ok).toBe(false);
    expect(result.violations[0].file).toContain('big.wasm');
  });

  it('checks every extension, not just .js — a .wasm is what broke the deploy', async () => {
    await writeFile(`${TEST_DIR}/asset.wasm`, Buffer.alloc(4096));
    await writeFile(`${TEST_DIR}/asset.bin`, Buffer.alloc(4096));
    const result = await checkPagesFileSize({ targetDir: TEST_DIR, limitBytes: 1024 });
    expect(result.violations.map((v) => v.file).join()).toMatch(/asset\.wasm/);
    expect(result.violations.map((v) => v.file).join()).toMatch(/asset\.bin/);
  });

  it('warns, but does not fail, on a file merely approaching the limit', async () => {
    await writeFile(`${TEST_DIR}/close.wasm`, Buffer.alloc(950));
    const result = await checkPagesFileSize({
      targetDir: TEST_DIR,
      limitBytes: 1024,
      warnRatio: 0.9,
    });
    expect(result.ok).toBe(true);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].pct).toBe(93);
  });

  it('passes a comfortably small file with no warning', async () => {
    await writeFile(`${TEST_DIR}/small.wasm`, Buffer.alloc(10));
    const result = await checkPagesFileSize({ targetDir: TEST_DIR, limitBytes: 1024 });
    expect(result.ok).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });
});
