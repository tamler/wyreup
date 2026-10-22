import { afterEach, describe, expect, it, vi } from 'vitest';
import { _resetEgressLockForTests } from '../src/lib/safety/egress.js';

const originalModelCdn = process.env['WYREUP_MODEL_CDN'];
const originalDisableLock = process.env['WYREUP_DISABLE_EGRESS_LOCK'];
const originalOrigin = process.env['WYREUP_ORIGIN'];

afterEach(() => {
  _resetEgressLockForTests();
  vi.resetModules();
  if (originalModelCdn === undefined) delete process.env['WYREUP_MODEL_CDN'];
  else process.env['WYREUP_MODEL_CDN'] = originalModelCdn;
  if (originalDisableLock === undefined) delete process.env['WYREUP_DISABLE_EGRESS_LOCK'];
  else process.env['WYREUP_DISABLE_EGRESS_LOCK'] = originalDisableLock;
  if (originalOrigin === undefined) delete process.env['WYREUP_ORIGIN'];
  else process.env['WYREUP_ORIGIN'] = originalOrigin;
});

describe('CLI egress installation', () => {
  it('reports a malformed public origin and installs the actual empty lock before any transport', async () => {
    const originalFetch = globalThis.fetch;
    const transport = vi.fn(() => Promise.resolve(new Response('stub transport')));
    globalThis.fetch = transport;
    process.env['WYREUP_ORIGIN'] = 'not-a-url';
    process.env['WYREUP_MODEL_CDN'] = 'https://models.wyreup.com';
    delete process.env['WYREUP_DISABLE_EGRESS_LOCK'];
    vi.resetModules();
    const egress = await import('../src/lib/safety/egress.js');
    try {
      const installed = await import('../src/lib/safety/install-egress.js');
      expect(installed.startupError).toMatch(/WYREUP_ORIGIN/);
      await expect.soft(fetch('https://wyreup.com/')).rejects.toBeInstanceOf(egress.EgressBlockedError);
      expect.soft(transport).not.toHaveBeenCalled();
    } finally {
      egress._resetEgressLockForTests();
      globalThis.fetch = originalFetch;
    }
  });

  it('reports malformed configuration while blocking all egress', async () => {
    process.env['WYREUP_MODEL_CDN'] = 'not-a-url';
    delete process.env['WYREUP_DISABLE_EGRESS_LOCK'];
    vi.resetModules();
    const installed = await import('../src/lib/safety/install-egress.js');
    expect(installed.startupError).toMatch(/WYREUP_MODEL_CDN/);
    await expect(fetch('https://wyreup.com/')).rejects.toThrow(/Egress blocked/);
  });
  it('keeps unrelated egress blocked when the first-party model mirror is disabled', async () => {
    process.env['WYREUP_MODEL_CDN'] = 'disabled';
    delete process.env['WYREUP_DISABLE_EGRESS_LOCK'];
    vi.resetModules();

    await import('../src/lib/safety/install-egress.js');

    await expect(fetch('https://example.com/')).rejects.toThrow(/Egress blocked/);
  });
});
