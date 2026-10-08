import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm, cp, readFile } from 'node:fs/promises';
import { checkPrivacy } from '../check-privacy.mjs';

const TEST_DIR = 'tools/test/.tmp-privacy';

describe('checkPrivacy', () => {
  beforeEach(async () => {
    await mkdir(TEST_DIR, { recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  it('passes when built output contains only allowlisted domains', async () => {
    await writeFile(
      `${TEST_DIR}/index.html`,
      '<script src="https://static.cloudflareinsights.com/beacon.js"></script>',
    );
    const result = await checkPrivacy({
      distDir: TEST_DIR,
      allowlist: ['wyreup.com', 'static.cloudflareinsights.com'],
    });
    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it('fails on disallowed external domain', async () => {
    await writeFile(
      `${TEST_DIR}/index.html`,
      '<script src="https://cdn.evil.example/track.js"></script>',
    );
    const result = await checkPrivacy({
      distDir: TEST_DIR,
      allowlist: ['wyreup.com', 'static.cloudflareinsights.com'],
    });
    expect(result.ok).toBe(false);
    expect(result.violations.length).toBeGreaterThan(0);
    expect(result.violations[0].domain).toBe('cdn.evil.example');
  });

  it('ignores relative paths and same-origin references', async () => {
    await writeFile(
      `${TEST_DIR}/index.html`,
      '<link href="/styles.css" /><script src="./app.js"></script>',
    );
    const result = await checkPrivacy({
      distDir: TEST_DIR,
      allowlist: ['wyreup.com'],
    });
    expect(result.ok).toBe(true);
  });

  async function copyNotices() {
    await cp('packages/web/licenses', `${TEST_DIR}/licenses`, { recursive: true });
  }

  const pinnedOptions = { distDir: TEST_DIR, allowlist: [], verifyOnnxNotices: true };
  const noticePath = `${TEST_DIR}/licenses/onnxruntime-web@1.24.3/ThirdPartyNotices.txt`;

  it('exempts only exact notices whose built bytes match both pins', async () => {
    await copyNotices();
    expect((await checkPrivacy(pinnedOptions)).ok).toBe(true);
    await writeFile(
      `${TEST_DIR}/licenses/another-notice.txt`,
      'https://unapproved.example/license',
    );
    const result = await checkPrivacy(pinnedOptions);
    expect(result.ok).toBe(false);
    expect(result.violations).toEqual([
      { file: `${TEST_DIR}/licenses/another-notice.txt`, domain: 'unapproved.example' },
    ]);
  });

  it('fails closed for a same-length notice mutation', async () => {
    await copyNotices();
    const bytes = await readFile(noticePath);
    bytes[0] ^= 1;
    await writeFile(noticePath, bytes);
    await expect(checkPrivacy(pinnedOptions)).rejects.toThrow('does not match its pin');
  });

  it('fails closed for missing and wrong-version notices', async () => {
    await copyNotices();
    await cp(noticePath, `${TEST_DIR}/licenses/wrong-version.txt`);
    await rm(noticePath);
    await expect(checkPrivacy(pinnedOptions)).rejects.toThrow('ENOENT');
  });

  it('does not exempt a matching notice copied to another path', async () => {
    await copyNotices();
    await cp(noticePath, `${TEST_DIR}/licenses/wrong-version.txt`);
    const result = await checkPrivacy(pinnedOptions);
    expect(result.ok).toBe(false);
    expect(
      result.violations.every((violation) => violation.file.endsWith('/wrong-version.txt')),
    ).toBe(true);
  });
});
