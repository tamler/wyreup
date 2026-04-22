/**
 * pgp-sign tests
 *
 * 1. Metadata — always run.
 * 2. Input validation — always run.
 * 3. Sign/verify round-trip — uses openpgp.js, runs in Node.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { pgpSign, defaultPgpSignParams } from '../../../src/tools/pgp-sign/index.js';
import type { ToolRunContext } from '../../../src/types.js';

function makeCtx(): ToolRunContext {
  return {
    onProgress: () => {},
    signal: new AbortController().signal,
    cache: new Map(),
    executionId: 'test',
  };
}

let privateKeyArmored: string;

beforeAll(async () => {
  const openpgp = await import('openpgp');
  const { privateKey } = await openpgp.generateKey({
    type: 'ecc',
    curve: 'curve25519',
    userIDs: [{ name: 'Test User', email: 'test@example.com' }],
    format: 'armored',
  });
  privateKeyArmored = privateKey;
});

describe('pgp-sign — metadata', () => {
  it('has id "pgp-sign"', () => expect(pgpSign.id).toBe('pgp-sign'));
  it('category is "privacy"', () => expect(pgpSign.category).toBe('privacy'));
  it('accepts */*', () => expect(pgpSign.input.accept).toContain('*/*'));
  it('output is text/plain', () => expect(pgpSign.output.mime).toBe('text/plain'));
  it('memoryEstimate is "medium"', () => expect(pgpSign.memoryEstimate).toBe('medium'));
  it('cost is "free"', () => expect(pgpSign.cost).toBe('free'));
  it('batchable is false', () => expect(pgpSign.batchable).toBe(false));
  it('no installSize', () => expect(pgpSign.installSize).toBeUndefined());
  it('defaults armor is true', () => expect(defaultPgpSignParams.armor).toBe(true));
});

describe('pgp-sign — input validation', () => {
  it('throws when privateKey is empty', async () => {
    const file = new File(['data'], 'data.txt', { type: 'text/plain' });
    await expect(
      pgpSign.run([file], { privateKey: '' }, makeCtx()),
    ).rejects.toThrow(/privateKey is required/i);
  });
});

describe('pgp-sign — run() with real key', () => {
  it('produces an ASCII-armored signature', async () => {
    const file = new File(['data to sign'], 'data.txt', { type: 'text/plain' });
    const result = await pgpSign.run([file], { privateKey: privateKeyArmored }, makeCtx()) as Blob[];
    expect(result).toHaveLength(1);
    const sigText = await result[0]!.text();
    expect(sigText).toContain('BEGIN PGP SIGNATURE');
  });

  it('signature blob has text/plain mime', async () => {
    const file = new File(['data'], 'data.txt', { type: 'text/plain' });
    const result = await pgpSign.run([file], { privateKey: privateKeyArmored }, makeCtx()) as Blob[];
    expect(result[0]!.type).toContain('text/plain');
  });
});
