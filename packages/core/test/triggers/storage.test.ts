import { describe, it, expect } from 'vitest';
import {
  parseTriggerKit,
  serializeTriggerKit,
  updateTriggerRule,
  strippedForImport,
} from '../../src/triggers/storage.js';
import type { TriggerRule } from '../../src/triggers/types.js';

function makeRule(over: Partial<TriggerRule> = {}): TriggerRule {
  return {
    id: 'r1',
    name: 'PDF cleanup',
    mime: 'application/pdf',
    chainId: 'chain-1',
    order: 0,
    confirmed: true,
    confirmedAt: 1_000,
    enabled: true,
    createdAt: 100,
    updatedAt: 100,
    ...over,
  };
}

describe('parseTriggerKit — happy path', () => {
  it('round-trips a kit', () => {
    const kit = { version: 1 as const, rules: [makeRule()] };
    const parsed = parseTriggerKit(JSON.parse(serializeTriggerKit(kit)));
    expect(parsed.rules.length).toBe(1);
    expect(parsed.rules[0]!.id).toBe('r1');
    expect(parsed.rules[0]!.confirmed).toBe(true);
  });

  it('defaults enabled=true when missing', () => {
    const kit = parseTriggerKit({
      version: 1,
      rules: [{ id: 'r1', name: 'n', mime: 'image/*', chainId: 'c', order: 0 }],
    });
    expect(kit.rules[0]!.enabled).toBe(true);
  });
});

describe('parseTriggerKit — rejections', () => {
  it('rejects non-objects', () => {
    expect(() => parseTriggerKit(null)).toThrow();
    expect(() => parseTriggerKit('hello')).toThrow();
  });

  it('rejects wrong version', () => {
    expect(() => parseTriggerKit({ version: 99, rules: [] })).toThrow(/version/);
  });

  it('rejects bare wildcard MIME', () => {
    expect(() =>
      parseTriggerKit({
        version: 1,
        rules: [{ id: 'r1', name: 'n', mime: '*', chainId: 'c', order: 0 }],
      }),
    ).toThrow(/too broad/);
  });

  it('rejects */* MIME', () => {
    expect(() =>
      parseTriggerKit({
        version: 1,
        rules: [{ id: 'r1', name: 'n', mime: '*/*', chainId: 'c', order: 0 }],
      }),
    ).toThrow(/too broad/);
  });

  it('rejects MIME without a slash', () => {
    expect(() =>
      parseTriggerKit({
        version: 1,
        rules: [{ id: 'r1', name: 'n', mime: 'image', chainId: 'c', order: 0 }],
      }),
    ).toThrow(/too broad/);
  });

  it('rejects empty required strings', () => {
    expect(() =>
      parseTriggerKit({
        version: 1,
        rules: [{ id: '', name: 'n', mime: 'image/*', chainId: 'c', order: 0 }],
      }),
    ).toThrow();
  });
});

describe('updateTriggerRule — G2 re-confirmation invariant', () => {
  it('re-arms confirmed=false on a name change', () => {
    const next = updateTriggerRule(makeRule(), { name: 'New name' });
    expect(next.confirmed).toBe(false);
    expect(next.confirmedAt).toBeUndefined();
  });

  it('re-arms confirmed=false on a MIME change', () => {
    const next = updateTriggerRule(makeRule(), { mime: 'application/zip' });
    expect(next.confirmed).toBe(false);
  });

  it('re-arms confirmed=false on a chainId change', () => {
    const next = updateTriggerRule(makeRule(), { chainId: 'chain-2' });
    expect(next.confirmed).toBe(false);
  });

  it('re-arms confirmed=false on an order change', () => {
    const next = updateTriggerRule(makeRule(), { order: 5 });
    expect(next.confirmed).toBe(false);
  });

  it('re-arms confirmed=false on enabling/disabling', () => {
    const next = updateTriggerRule(makeRule(), { enabled: false });
    expect(next.confirmed).toBe(false);
  });

  it('preserves confirmed=true when only confirmed is being toggled in', () => {
    const rule = makeRule({ confirmed: false, confirmedAt: undefined });
    const next = updateTriggerRule(rule, { confirmed: true });
    expect(next.confirmed).toBe(true);
    expect(next.confirmedAt).toBeGreaterThan(0);
  });

  it('clears confirmedAt when confirmed is set false', () => {
    const next = updateTriggerRule(makeRule(), { confirmed: false });
    expect(next.confirmed).toBe(false);
    expect(next.confirmedAt).toBeUndefined();
  });

  it('always advances updatedAt', () => {
    const before = makeRule({ updatedAt: 100 });
    const next = updateTriggerRule(before, { name: 'X' });
    expect(next.updatedAt).toBeGreaterThan(100);
  });
});

describe('strippedForImport — G2 import-from-share invariant', () => {
  it('clears confirmed on every rule', () => {
    const kit = {
      version: 1 as const,
      rules: [
        makeRule({ id: 'a', confirmed: true }),
        makeRule({ id: 'b', confirmed: true }),
      ],
    };
    const stripped = strippedForImport(kit);
    expect(stripped.rules.every((r) => r.confirmed === false)).toBe(true);
    expect(stripped.rules.every((r) => r.confirmedAt === undefined)).toBe(true);
  });
});
