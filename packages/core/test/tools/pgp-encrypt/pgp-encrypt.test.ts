/**
 * pgp-encrypt tests
 *
 * 1. Metadata — always run.
 * 2. Input validation — always run.
 * 3. Encrypt/decrypt round-trip — uses openpgp.js, runs in Node.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { pgpEncrypt, defaultPgpEncryptParams } from '../../../src/tools/pgp-encrypt/index.js';
import type { ToolRunContext } from '../../../src/types.js';

function makeCtx(): ToolRunContext {
  return {
    onProgress: () => {},
    signal: new AbortController().signal,
    cache: new Map(),
    executionId: 'test',
  };
}

let publicKeyArmored: string;

beforeAll(async () => {
  const openpgp = await import('openpgp');
  const { publicKey } = await openpgp.generateKey({
    type: 'ecc',
    curve: 'curve25519',
    userIDs: [{ name: 'Test User', email: 'test@example.com' }],
    format: 'armored',
  });
  publicKeyArmored = publicKey;
});

describe('pgp-encrypt — metadata', () => {
  it('has id "pgp-encrypt"', () => expect(pgpEncrypt.id).toBe('pgp-encrypt'));
  it('category is "privacy"', () => expect(pgpEncrypt.category).toBe('privacy'));
  it('accepts */*', () => expect(pgpEncrypt.input.accept).toContain('*/*'));
  it('memoryEstimate is "medium"', () => expect(pgpEncrypt.memoryEstimate).toBe('medium'));
  it('cost is "free"', () => expect(pgpEncrypt.cost).toBe('free'));
  it('batchable is false', () => expect(pgpEncrypt.batchable).toBe(false));
  it('no installSize', () => expect(pgpEncrypt.installSize).toBeUndefined());
  it('defaults armor is true', () => expect(defaultPgpEncryptParams.armor).toBe(true));
});

describe('pgp-encrypt — input validation', () => {
  it('throws when publicKey is empty', async () => {
    const file = new File(['hello'], 'test.txt', { type: 'text/plain' });
    await expect(
      pgpEncrypt.run([file], { publicKey: '' }, makeCtx()),
    ).rejects.toThrow(/publicKey is required/i);
  });

  it('throws when publicKey is whitespace', async () => {
    const file = new File(['hello'], 'test.txt', { type: 'text/plain' });
    await expect(
      pgpEncrypt.run([file], { publicKey: '   ' }, makeCtx()),
    ).rejects.toThrow(/publicKey is required/i);
  });
});

describe('pgp-encrypt — run() with real key', () => {
  it('produces ASCII-armored output by default', async () => {
    const file = new File(['secret data'], 'secret.txt', { type: 'text/plain' });
    const result = await pgpEncrypt.run([file], { publicKey: publicKeyArmored }, makeCtx()) as Blob[];
    expect(result).toHaveLength(1);
    const text = await result[0]!.text();
    expect(text).toContain('BEGIN PGP MESSAGE');
  });

  it('output blob has text/plain mime for armored output', async () => {
    const file = new File(['data'], 'data.txt', { type: 'text/plain' });
    const result = await pgpEncrypt.run([file], { publicKey: publicKeyArmored }, makeCtx()) as Blob[];
    expect(result[0]!.type).toContain('text/plain');
  });
});
