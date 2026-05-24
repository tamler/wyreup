import { describe, it, expect } from 'vitest';
import { sanitize } from '../src/sanitize.js';

describe('sanitize', () => {
  it('replaces the literal key', () => {
    expect(sanitize('failed with wk_live_abc', 'wk_live_abc')).toBe('failed with [REDACTED]');
  });

  it('replaces every occurrence of the literal key', () => {
    expect(sanitize('wk_live_abc x wk_live_abc', 'wk_live_abc')).toBe('[REDACTED] x [REDACTED]');
  });

  it('replaces Bearer <token> case-insensitively', () => {
    expect(sanitize('Authorization: Bearer abc.def-123', undefined)).toBe('Authorization: Bearer [REDACTED]');
    expect(sanitize('header: bearer XYZ==', undefined)).toBe('header: bearer [REDACTED]');
  });

  it('does not modify strings without secrets', () => {
    expect(sanitize('no secret here', 'wk_live_abc')).toBe('no secret here');
  });

  it('handles undefined key gracefully', () => {
    expect(sanitize('plain message', undefined)).toBe('plain message');
  });

  it('does not redact URL-encoded variants (documented out of scope)', () => {
    expect(sanitize('wk%5Flive%5Fabc', 'wk_live_abc')).toBe('wk%5Flive%5Fabc');
  });
});
