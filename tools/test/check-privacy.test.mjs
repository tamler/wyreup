import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm } from 'node:fs/promises';
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
});
