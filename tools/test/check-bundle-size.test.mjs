import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { mkdir, writeFile, rm, mkdtemp } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
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

describe('production bundle profiles without a uniform override', () => {
  let ownedRoot;
  let small;
  let medium;
  let large;

  beforeAll(async () => {
    function fixedBytes(length) {
      const bytes = Buffer.alloc(length);
      let x = 0x9e3779b9;
      for (let i = 0; i < bytes.length; i++) {
        x ^= x << 13;
        x ^= x >>> 17;
        x ^= x << 5;
        x >>>= 0;
        bytes[i] = x & 255;
      }
      return bytes;
    }

    small = fixedBytes(192 * 1024);
    medium = fixedBytes(384 * 1024);
    large = fixedBytes(768 * 1024);
    const smallGzip = gzipSync(small).length;
    const mediumGzip = gzipSync(medium).length;
    const largeGzip = gzipSync(large).length;
    console.log(JSON.stringify({
      fixture: 'fixed-xorshift-production-bands',
      rawBytes: [small.length, medium.length, large.length],
      gzipBytes: [smallGzip, mediumGzip, largeGzip],
    }));
    expect(smallGzip / 1024).toBeGreaterThan(150);
    expect(smallGzip / 1024).toBeLessThanOrEqual(250);
    expect(mediumGzip / 1024).toBeGreaterThan(250);
    expect(mediumGzip / 1024).toBeLessThanOrEqual(600);
    expect(largeGzip / 1024).toBeGreaterThan(600);
    ownedRoot = await mkdtemp('tools/test/.tmp-bundle-production-');
  });

  afterAll(async () => {
    if (ownedRoot) await rm(ownedRoot, { recursive: true, force: true });
  });

  it('accepts a medium bank worker under its exact 600 KiB production profile', async () => {
    const targetDir = `${ownedRoot}/bank-medium`;
    await mkdir(targetDir);
    await writeFile(`${targetDir}/bank-pdf-worker-fixture.js`, medium);
    const result = await checkBundleSize({ targetDir, extensions: ['.js'] });
    expect(result.ok).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it('rejects an oversized bank worker with its exact 600 KiB production budget', async () => {
    const targetDir = `${ownedRoot}/bank-large`;
    await mkdir(targetDir);
    const file = `${targetDir}/bank-pdf-worker-fixture.js`;
    await writeFile(file, large);
    const result = await checkBundleSize({ targetDir, extensions: ['.js'] });
    expect(result.ok).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]).toMatchObject({ file, budgetKb: 600 });
  });

  it('rejects an unrelated medium worker under the unchanged 150 KiB default', async () => {
    const targetDir = `${ownedRoot}/unrelated-medium`;
    await mkdir(targetDir);
    const file = `${targetDir}/unrelated-worker-fixture.js`;
    await writeFile(file, medium);
    const result = await checkBundleSize({ targetDir, extensions: ['.js'] });
    expect(result.ok).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]).toMatchObject({ file, budgetKb: 150 });
  });

  it('accepts the small core registry chunk under the retargeted 250 KiB profile', async () => {
    const targetDir = `${ownedRoot}/core-registry-small`;
    await mkdir(targetDir);
    await writeFile(`${targetDir}/core-registry.fixture.js`, small);
    const result = await checkBundleSize({ targetDir, extensions: ['.js'] });
    expect(result.ok).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it('rejects the medium core registry chunk under the retargeted 250 KiB profile', async () => {
    const targetDir = `${ownedRoot}/core-registry-medium`;
    await mkdir(targetDir);
    const file = `${targetDir}/core-registry.fixture.js`;
    await writeFile(file, medium);
    const result = await checkBundleSize({ targetDir, extensions: ['.js'] });
    expect(result.ok).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]).toMatchObject({ file, budgetKb: 250 });
  });

  it('rejects the small browser chunk under the unchanged 150 KiB default', async () => {
    const targetDir = `${ownedRoot}/browser-small`;
    await mkdir(targetDir);
    const file = `${targetDir}/browser.fixture.js`;
    await writeFile(file, small);
    const result = await checkBundleSize({ targetDir, extensions: ['.js'] });
    expect(result.ok).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]).toMatchObject({ file, budgetKb: 150 });
  });
});
