import { describe, expect, it } from 'vitest';
import { DEFAULT_MODEL_CDN, resolveModelCdn } from '../src/runtime-config.js';

describe('model CDN runtime configuration', () => {
  it('routes models through the first-party mirror by default', () => {
    expect(resolveModelCdn(undefined)).toEqual({
      base: DEFAULT_MODEL_CDN,
      allowedOrigins: [DEFAULT_MODEL_CDN],
    });
  });

  it('preserves a custom base path while allowing only its origin', () => {
    expect(resolveModelCdn('https://models.example.test/mirror/')).toEqual({
      base: 'https://models.example.test/mirror',
      allowedOrigins: ['https://models.example.test'],
    });
  });

  it('allows only known upstream model hosts when the mirror is disabled', () => {
    const config = resolveModelCdn('disabled');
    expect(config.base).toBeNull();
    expect(config.allowedOrigins).toContain('https://huggingface.co');
    expect(config.allowedOrigins).toContain('https://us.aws.cdn.hf.co');
    expect(config.allowedOrigins).toContain('https://cdn.jsdelivr.net');
    expect(config.allowedOrigins).not.toContain('https://example.com');
  });

  it('rejects non-HTTP model CDN protocols', () => {
    expect(() => resolveModelCdn('file:///tmp/models')).toThrow(/http or https/);
  });
});
