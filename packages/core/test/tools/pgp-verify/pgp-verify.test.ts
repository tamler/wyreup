/**
 * pgp-verify tests
 *
 * 1. Metadata — always run.
 * 2. Input validation — always run.
 * 3. Sign/verify round-trip — uses openpgp.js, runs in Node.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { pgpVerify, defaultPgpVerifyParams } from '../../../src/tools/pgp-verify/index.js';
import { pgpSign } from '../../../src/tools/pgp-sign/index.js';
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

describe('pgp-verify — metadata', () => {
  it('has id "pgp-verify"', () => expect(pgpVerify.id).toBe('pgp-verify'));
  it('category is "privacy"', () => expect(pgpVerify.category).toBe('privacy'));
  it('input min is 2', () => expect(pgpVerify.input.min).toBe(2));
  it('output is application/json', () => expect(pgpVerify.output.mime).toBe('application/json'));
  it('memoryEstimate is "medium"', () => expect(pgpVerify.memoryEstimate).toBe('medium'));
  it('cost is "free"', () => expect(pgpVerify.cost).toBe('free'));
  it('batchable is false', () => expect(pgpVerify.batchable).toBe(false));
  it('no installSize', () => expect(pgpVerify.installSize).toBeUndefined());
  it('defaults publicKey is empty', () => expect(defaultPgpVerifyParams.publicKey).toBe(''));
});

describe('pgp-verify — input validation', () => {
  it('throws when publicKey is empty', async () => {
    const file = new File(['data'], 'data.txt', { type: 'text/plain' });
    const sig = new File(['sig'], 'sig.asc', { type: 'text/plain' });
    await expect(
      pgpVerify.run([file, sig], { publicKey: '' }, makeCtx()),
    ).rejects.toThrow(/publicKey is required/i);
  });

  it('throws when fewer than 2 inputs', async () => {
    const file = new File(['data'], 'data.txt', { type: 'text/plain' });
    await expect(
      pgpVerify.run([file], { publicKey: publicKeyArmored }, makeCtx()),
    ).rejects.toThrow(/two files/i);
  });
});

describe('pgp-verify — sign/verify round-trip', () => {
  it('verifies a valid signature', async () => {
    const data = 'payload to sign and verify';
    const dataFile = new File([data], 'data.txt', { type: 'text/plain' });

    // Sign
    const sigResult = await pgpSign.run([dataFile], { privateKey: privateKeyArmored }, makeCtx()) as Blob[];
    const sigText = await sigResult[0]!.text();
    const sigFile = new File([sigText], 'data.txt.asc', { type: 'text/plain' });

    // Verify
    const verifyResult = await pgpVerify.run([dataFile, sigFile], { publicKey: publicKeyArmored }, makeCtx()) as Blob[];
    const json = JSON.parse(await verifyResult[0]!.text()) as { verified: boolean; signerKeyId: string };
    expect(json.verified).toBe(true);
    expect(json.signerKeyId).toBeTruthy();
  });

  it('reports failure for tampered data', async () => {
    const data = 'original data';
    const dataFile = new File([data], 'data.txt', { type: 'text/plain' });

    const sigResult = await pgpSign.run([dataFile], { privateKey: privateKeyArmored }, makeCtx()) as Blob[];
    const sigText = await sigResult[0]!.text();
    const sigFile = new File([sigText], 'data.txt.asc', { type: 'text/plain' });

    // Verify against tampered data
    const tamperedFile = new File(['tampered data'], 'data.txt', { type: 'text/plain' });
    const verifyResult = await pgpVerify.run([tamperedFile, sigFile], { publicKey: publicKeyArmored }, makeCtx()) as Blob[];
    const json = JSON.parse(await verifyResult[0]!.text()) as { verified: boolean };
    expect(json.verified).toBe(false);
  });
});
