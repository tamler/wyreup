import { describe, expect, it } from 'vitest';
import { DEFAULT_MODEL_CDN, resolveModelCdn } from '../src/lib/safety/runtime-config.js';

describe('CLI model CDN runtime configuration', () => {
  it('routes models through the first-party mirror by default', () => {
    expect(resolveModelCdn(undefined)).toEqual({
      base: DEFAULT_MODEL_CDN,
      allowedOrigins: [DEFAULT_MODEL_CDN],
    });
  });

  it('keeps the egress lock enabled for the upstream fallback', () => {
    const config = resolveModelCdn('disabled');
    expect(config.base).toBeNull();
    expect(config.allowedOrigins).toContain('https://huggingface.co');
    expect(config.allowedOrigins).toContain('https://us.aws.cdn.hf.co');
    expect(config.allowedOrigins).not.toContain('https://example.com');
  });

  it('preserves a custom base path while allowing only its origin', () => {
    expect(resolveModelCdn('https://models.example.test/mirror/')).toEqual({
      base: 'https://models.example.test/mirror',
      allowedOrigins: ['https://models.example.test'],
    });
  });

  it('rejects non-HTTP model CDN protocols', () => {
    expect(() => resolveModelCdn('file:///tmp/models')).toThrow(/http or https/);
  });
});
