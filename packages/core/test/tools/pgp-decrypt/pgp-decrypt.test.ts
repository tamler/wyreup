/**
 * pgp-decrypt tests
 *
 * 1. Metadata — always run.
 * 2. Input validation — always run.
 * 3. Encrypt/decrypt round-trip — uses openpgp.js, runs in Node.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { pgpDecrypt, defaultPgpDecryptParams } from '../../../src/tools/pgp-decrypt/index.js';
import { pgpEncrypt } from '../../../src/tools/pgp-encrypt/index.js';
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
let privateKeyArmored: string;

beforeAll(async () => {
  const openpgp = await import('openpgp');
  const { privateKey, publicKey } = await openpgp.generateKey({
    type: 'ecc',
    curve: 'curve25519',
    userIDs: [{ name: 'Test User', email: 'test@example.com' }],
    format: 'armored',
  });
  publicKeyArmored = publicKey;
  privateKeyArmored = privateKey;
});

describe('pgp-decrypt — metadata', () => {
  it('has id "pgp-decrypt"', () => expect(pgpDecrypt.id).toBe('pgp-decrypt'));
  it('category is "privacy"', () => expect(pgpDecrypt.category).toBe('privacy'));
  it('memoryEstimate is "medium"', () => expect(pgpDecrypt.memoryEstimate).toBe('medium'));
  it('cost is "free"', () => expect(pgpDecrypt.cost).toBe('free'));
  it('batchable is false', () => expect(pgpDecrypt.batchable).toBe(false));
  it('no installSize', () => expect(pgpDecrypt.installSize).toBeUndefined());
  it('defaults privateKey is empty string', () => expect(defaultPgpDecryptParams.privateKey).toBe(''));
});

describe('pgp-decrypt — input validation', () => {
  it('throws when privateKey is empty', async () => {
    const file = new File(['encrypted'], 'msg.asc', { type: 'text/plain' });
    await expect(
      pgpDecrypt.run([file], { privateKey: '' }, makeCtx()),
    ).rejects.toThrow(/privateKey is required/i);
  });
});

describe('pgp-decrypt — round-trip', () => {
  it('decrypts data encrypted by pgp-encrypt', async () => {
    const original = 'round-trip test payload';
    const plainFile = new File([original], 'plain.txt', { type: 'text/plain' });

    // Encrypt
    const encrypted = await pgpEncrypt.run([plainFile], { publicKey: publicKeyArmored }, makeCtx()) as Blob[];
    const encryptedText = await encrypted[0]!.text();
    const encryptedFile = new File([encryptedText], 'msg.asc', { type: 'text/plain' });

    // Decrypt
    const decrypted = await pgpDecrypt.run([encryptedFile], { privateKey: privateKeyArmored }, makeCtx()) as Blob[];
    expect(decrypted).toHaveLength(1);
    const decryptedText = await decrypted[0]!.text();
    expect(decryptedText).toBe(original);
  });
});
