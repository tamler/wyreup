import { afterEach, describe, expect, it, vi } from 'vitest';
import { _resetEgressLockForTests } from '../src/egress.js';

afterEach(() => { _resetEgressLockForTests(); vi.unstubAllEnvs(); vi.resetModules(); });

describe('MCP startup configuration', () => {
  it('reports malformed configuration while denying egress', async () => {
    vi.stubEnv('WYREUP_MODEL_CDN', 'not-a-url');
    vi.stubEnv('WYREUP_DISABLE_EGRESS_LOCK', undefined);
    vi.resetModules();
    const installed = await import('../src/install-egress.js');
    expect(installed.startupError).toMatch(/WYREUP_MODEL_CDN/);
    await expect(fetch('https://wyreup.com/')).rejects.toThrow(/Egress blocked/);
  });
});
