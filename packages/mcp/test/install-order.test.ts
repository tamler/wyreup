import { describe, it, expect, afterEach } from 'vitest';
import { _resetEgressLockForTests, EgressBlockedError } from '../src/egress.js';

describe('egress install order', () => {
  afterEach(() => { _resetEgressLockForTests(); });

  it('install-egress module installs the lock when WYREUP_DISABLE_EGRESS_LOCK is not 1', async () => {
    _resetEgressLockForTests();
    const ORIG_ORIGIN = process.env['WYREUP_ORIGIN'];
    const ORIG_DISABLE = process.env['WYREUP_DISABLE_EGRESS_LOCK'];
    process.env['WYREUP_ORIGIN'] = 'https://wyreup.com';
    delete process.env['WYREUP_DISABLE_EGRESS_LOCK'];
    try {
      // Re-import the side-effect module to trigger the lock installation.
      // Vitest's module cache will only run this once unless invalidated; for
      // this smoke test, a fresh import is fine because afterEach resets.
      await import('../src/install-egress.js');

      // Sanity assertion: confirm the lock actually installed before testing fetch behavior.
      const INSTALLED = Symbol.for('@wyreup/mcp/egress-installed');
      expect((globalThis as Record<symbol, unknown>)[INSTALLED]).toBe(true);

      await expect(fetch('http://evil.example/')).rejects.toBeInstanceOf(EgressBlockedError);
    } finally {
      if (ORIG_ORIGIN === undefined) delete process.env['WYREUP_ORIGIN'];
      else process.env['WYREUP_ORIGIN'] = ORIG_ORIGIN;
      if (ORIG_DISABLE !== undefined) process.env['WYREUP_DISABLE_EGRESS_LOCK'] = ORIG_DISABLE;
    }
  });
});
