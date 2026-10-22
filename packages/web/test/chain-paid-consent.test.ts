import { expect, it } from 'vitest';
import type { ToolRegistry } from '@wyreup/core';
import {
  assertPaidAccount,
  paidChainDisclosure,
  summarizePaidChain,
} from '../src/lib/chainPaidConsent';

function registry(price: unknown): ToolRegistry {
  return {
    toolsById: new Map([
      ['paid', { id: 'paid', name: 'Actual paid step', cost: 'credit', creditCost: price }],
      ['free', { id: 'free', name: 'Local step', cost: 'free' }],
    ]),
  } as unknown as ToolRegistry;
}
it('captures repeated actual paid steps and whole batch total without a fallback cost', () => {
  const summary = summarizePaidChain(
    [
      { toolId: 'paid', params: {} },
      { toolId: 'free', params: {} },
      { toolId: 'paid', params: {} },
    ],
    registry(3),
    2,
  );
  expect(summary).toEqual({
    steps: [
      { id: 'paid', name: 'Actual paid step', credits: 3 },
      { id: 'paid', name: 'Actual paid step', credits: 3 },
    ],
    totalCredits: 12,
  });
  expect(Object.isFrozen(summary)).toBe(true);
  expect(Object.isFrozen(summary.steps)).toBe(true);
  expect(Object.isFrozen(summary.steps[0])).toBe(true);
  expect(
    paidChainDisclosure(summary, [{ name: 'current.png' }], 'owner@example.invalid'),
  ).toContain('current.png');
  expect(
    paidChainDisclosure(summary, [{ name: 'current.png' }], 'owner@example.invalid'),
  ).toContain('owner@example.invalid');
  expect(
    paidChainDisclosure(summary, [{ name: 'current.png' }], 'owner@example.invalid'),
  ).toContain('uploaded to wyreup.com');
});
it.each([undefined, null, '3', NaN, Infinity, -Infinity, -1])(
  'refuses unknown or nonfinite or negative actual price %s',
  (price) => {
    expect(() => summarizePaidChain([{ toolId: 'paid', params: {} }], registry(price))).toThrow(
      'Paid price unavailable',
    );
  },
);
it('refuses unknown steps, overflow totals, and invalid file counts before work', () => {
  expect(() => summarizePaidChain([{ toolId: 'unknown', params: {} }], registry(3))).toThrow(
    'Unknown tool',
  );
  expect(() =>
    summarizePaidChain([{ toolId: 'paid', params: {} }], registry(Number.MAX_VALUE), 2),
  ).toThrow('total');
  for (const count of [0, -1, 1.5, Infinity])
    expect(() => summarizePaidChain([], registry(3), count)).toThrow('file count');
});
it('requires current ready account and finite sufficient balance only for paid work', () => {
  const paid = summarizePaidChain([{ toolId: 'paid', params: {} }], registry(3));
  expect(() => assertPaidAccount(paid, false, { email: 'a', balance: 3 })).toThrow('loading');
  expect(() => assertPaidAccount(paid, true, null)).toThrow('Sign in');
  for (const balance of [NaN, Infinity, -1, 2])
    expect(() => assertPaidAccount(paid, true, { email: 'a', balance })).toThrow('requires 3');
  expect(() => assertPaidAccount(paid, true, { email: 'a', balance: 3 })).not.toThrow();
  expect(() =>
    assertPaidAccount(
      summarizePaidChain([{ toolId: 'free', params: {} }], registry(undefined)),
      false,
      null,
    ),
  ).not.toThrow();
});
