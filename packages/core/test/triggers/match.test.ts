import { describe, it, expect } from 'vitest';
import { matchRule, type FireRecord } from '../../src/triggers/match.js';
import type { TriggerRule } from '../../src/triggers/types.js';

function rule(partial: Partial<TriggerRule> & { id: string; mime: string }): TriggerRule {
  return {
    name: `rule ${partial.id}`,
    chainId: 'chain-A',
    order: 0,
    confirmed: false,
    enabled: true,
    createdAt: 0,
    updatedAt: 0,
    ...partial,
  };
}

describe('matchRule — basic resolution', () => {
  it('returns no-match when no rules match', () => {
    const r = matchRule('image/png', [rule({ id: '1', mime: 'audio/*' })], []);
    expect(r.kind).toBe('no-match');
  });

  it('matches an exact MIME', () => {
    const r = matchRule(
      'application/pdf',
      [rule({ id: '1', mime: 'application/pdf' })],
      [],
    );
    expect(r.kind).toBe('match');
    if (r.kind === 'match') expect(r.rule.id).toBe('1');
  });

  it('matches a wildcard pattern', () => {
    const r = matchRule('image/png', [rule({ id: '1', mime: 'image/*' })], []);
    expect(r.kind).toBe('match');
    if (r.kind === 'match') expect(r.rule.id).toBe('1');
  });

  it('does not cross-match top-level types', () => {
    const r = matchRule('image/png', [rule({ id: '1', mime: 'audio/*' })], []);
    expect(r.kind).toBe('no-match');
  });
});

describe('matchRule — specificity', () => {
  it('exact match beats wildcard', () => {
    const r = matchRule(
      'application/pdf',
      [
        rule({ id: 'broad', mime: 'application/*' }),
        rule({ id: 'narrow', mime: 'application/pdf' }),
      ],
      [],
    );
    expect(r.kind).toBe('match');
    if (r.kind === 'match') expect(r.rule.id).toBe('narrow');
  });

  it('user-defined order breaks ties between equally specific rules', () => {
    const r = matchRule(
      'image/png',
      [
        rule({ id: 'second', mime: 'image/*', order: 5 }),
        rule({ id: 'first', mime: 'image/*', order: 1 }),
      ],
      [],
    );
    expect(r.kind).toBe('match');
    if (r.kind === 'match') expect(r.rule.id).toBe('first');
  });

  it('stable tiebreaker by id when order is equal', () => {
    const r = matchRule(
      'image/png',
      [
        rule({ id: 'b', mime: 'image/*', order: 1 }),
        rule({ id: 'a', mime: 'image/*', order: 1 }),
      ],
      [],
    );
    expect(r.kind).toBe('match');
    if (r.kind === 'match') expect(r.rule.id).toBe('a');
  });
});

describe('matchRule — enabled flag', () => {
  it('skips disabled rules', () => {
    const r = matchRule(
      'application/pdf',
      [rule({ id: '1', mime: 'application/pdf', enabled: false })],
      [],
    );
    expect(r.kind).toBe('no-match');
  });

  it('falls through to a less specific enabled rule when the better one is disabled', () => {
    const r = matchRule(
      'application/pdf',
      [
        rule({ id: 'narrow', mime: 'application/pdf', enabled: false }),
        rule({ id: 'broad', mime: 'application/*' }),
      ],
      [],
    );
    expect(r.kind).toBe('match');
    if (r.kind === 'match') expect(r.rule.id).toBe('broad');
  });
});

describe('matchRule — rate limiting (G7)', () => {
  it('fires below the limit', () => {
    const r = matchRule(
      'image/png',
      [rule({ id: '1', mime: 'image/*', rateLimit: { count: 3, windowMs: 60_000 } })],
      [
        { ruleId: '1', firedAt: Date.now() - 1_000 },
        { ruleId: '1', firedAt: Date.now() - 2_000 },
      ],
    );
    expect(r.kind).toBe('match');
  });

  it('rate-limits at the cap', () => {
    const now = 1_000_000;
    const r = matchRule(
      'image/png',
      [rule({ id: '1', mime: 'image/*', rateLimit: { count: 2, windowMs: 60_000 } })],
      [
        { ruleId: '1', firedAt: now - 1_000 },
        { ruleId: '1', firedAt: now - 2_000 },
      ],
      now,
    );
    expect(r.kind).toBe('rate-limited');
    if (r.kind === 'rate-limited') {
      expect(r.recentFires).toBe(2);
      expect(r.rule.id).toBe('1');
    }
  });

  it('ignores fires outside the window', () => {
    const now = 1_000_000;
    const r = matchRule(
      'image/png',
      [rule({ id: '1', mime: 'image/*', rateLimit: { count: 2, windowMs: 60_000 } })],
      [
        { ruleId: '1', firedAt: now - 70_000 }, // outside window
        { ruleId: '1', firedAt: now - 65_000 }, // outside window
      ],
      now,
    );
    expect(r.kind).toBe('match');
  });

  it('only counts fires for the matched rule, not others', () => {
    const now = 1_000_000;
    const r = matchRule(
      'image/png',
      [rule({ id: '1', mime: 'image/*', rateLimit: { count: 2, windowMs: 60_000 } })],
      [
        { ruleId: 'other', firedAt: now - 1_000 },
        { ruleId: 'other', firedAt: now - 2_000 },
        { ruleId: 'other', firedAt: now - 3_000 },
      ],
      now,
    );
    expect(r.kind).toBe('match');
  });

  it('falls back to default rate limit when undefined', () => {
    // DEFAULT_RATE_LIMIT = { count: 10, windowMs: 60_000 }
    const now = 1_000_000;
    const fires: FireRecord[] = Array.from({ length: 10 }, (_, i) => ({
      ruleId: '1',
      firedAt: now - (i + 1) * 100,
    }));
    const r = matchRule('image/png', [rule({ id: '1', mime: 'image/*' })], fires, now);
    expect(r.kind).toBe('rate-limited');
  });
});

describe('matchRule — security invariants from docs/triggers-security.md', () => {
  it('never matches a disabled rule even when it is the only candidate', () => {
    // G2 corollary: disabled rules are inert. The matcher must not fire them.
    const r = matchRule(
      'application/pdf',
      [rule({ id: '1', mime: 'application/pdf', enabled: false, confirmed: true })],
      [],
    );
    expect(r.kind).toBe('no-match');
  });

  it('confirmed=true does not affect matching — only the preview-bypass decision', () => {
    // The matcher's job is selection. The preview-skip decision is the
    // caller's job. So confirmed=true must NOT make a rule outrank
    // confirmed=false.
    const r = matchRule(
      'image/png',
      [
        rule({ id: 'unconfirmed', mime: 'image/*', order: 1, confirmed: false }),
        rule({ id: 'confirmed', mime: 'image/*', order: 5, confirmed: true }),
      ],
      [],
    );
    expect(r.kind).toBe('match');
    if (r.kind === 'match') expect(r.rule.id).toBe('unconfirmed');
  });
});
