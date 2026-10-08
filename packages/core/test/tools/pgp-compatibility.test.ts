import { describe, expect, it } from 'vitest';
import fixture from '../fixtures/openpgp-standard-v4.json';
import legacy from '../fixtures/openpgp-legacy-v5.json';
import { pgpDecrypt } from '../../src/tools/pgp-decrypt/index.js';
import { pgpEncrypt } from '../../src/tools/pgp-encrypt/index.js';
import { pgpSign } from '../../src/tools/pgp-sign/index.js';
import { pgpVerify } from '../../src/tools/pgp-verify/index.js';
import type { ToolRunContext } from '../../src/types.js';

const context = (): ToolRunContext => ({ onProgress: () => {}, signal: new AbortController().signal,
  cache: new Map(), executionId: 'pgp-compatibility' });
const plaintext = () => new File([fixture.plaintext], 'message.txt');
const protectedKey = { privateKey: fixture.privateKey, passphrase: fixture.passphrase };
const binary = (value: string) => Uint8Array.from(Buffer.from(value, 'base64'));
async function outputs(work: Promise<Blob | Blob[]>): Promise<Blob[]> {
  const result = await work;
  if (!Array.isArray(result)) throw new Error('PGP tool must return an output array');
  return result;
}

describe('PGP standard v4 interoperability with OpenPGP.js 5-produced fixtures', () => {
  it('uses standard v4 key and signature packets', async () => {
    const openpgp = await import('openpgp');
    const key = await openpgp.readKey({ armoredKey: fixture.publicKey });
    const signature = await openpgp.readSignature({ armoredSignature: fixture.signatureArmored });
    expect(key.keyPacket.version).toBe(4);
    expect(signature.packets[0]!.version).toBe(4);
  });
  it('uses native secure crypto and Web Streams', () => {
    expect(globalThis.crypto.subtle).toBeDefined();
    expect(globalThis.ReadableStream).toBeDefined();
  });
  for (const armor of [true, false]) {
    it(`decrypts static standard ${armor ? 'armored' : 'binary'} ciphertext`, async () => {
      const input = new File([armor ? fixture.encryptedArmored : binary(fixture.encryptedBinary)], 'legacy.pgp');
      const [result] = await outputs(pgpDecrypt.run([input], protectedKey, context()));
      expect(await result!.text()).toBe(fixture.plaintext);
    });
    it(`verifies static v4 ${armor ? 'armored' : 'binary'} detached signature`, async () => {
      const signature = new File([armor ? fixture.signatureArmored : binary(fixture.signatureBinary)], 'legacy.sig');
      const [result] = await outputs(pgpVerify.run([plaintext(), signature], { publicKey: fixture.publicKey }, context()));
      expect(JSON.parse(await result!.text())).toMatchObject({ verified: true });
    });
    it(`roundtrips protected legacy keys in ${armor ? 'armored' : 'binary'} format`, async () => {
      const [encrypted] = await outputs(pgpEncrypt.run([plaintext()], { publicKey: fixture.publicKey, armor }, context()));
      if (armor) expect(await encrypted!.text()).toMatch(/\n=[A-Za-z0-9+/]{4}\r?\n-----END PGP MESSAGE/);
      const [decrypted] = await outputs(pgpDecrypt.run([new File([encrypted!], 'new.pgp')], protectedKey, context()));
      expect(await decrypted!.text()).toBe(fixture.plaintext);
      const [signed] = await outputs(pgpSign.run([plaintext()], { ...protectedKey, armor }, context()));
      const [verified] = await outputs(pgpVerify.run([plaintext(), new File([signed!], 'new.sig')], { publicKey: fixture.publicKey }, context()));
      expect(JSON.parse(await verified!.text())).toMatchObject({ verified: true });
    });
  }
  it('rejects the wrong passphrase', async () => {
    await expect(pgpDecrypt.run([new File([fixture.encryptedArmored], 'legacy.asc')],
      { ...protectedKey, passphrase: 'wrong' }, context())).rejects.toThrow();
    await expect(pgpSign.run([plaintext()], { ...protectedKey, passphrase: 'wrong' }, context())).rejects.toThrow();
  });
  it('rejects tampered encrypted data', async () => {
    const damaged = binary(fixture.encryptedBinary);
    damaged[damaged.length - 5] = damaged[damaged.length - 5]! ^ 1;
    await expect(pgpDecrypt.run([new File([damaged], 'damaged.pgp')], protectedKey, context())).rejects.toThrow();
  });
  it('rejects a tampered detached signature', async () => {
    const damaged = binary(fixture.signatureBinary);
    damaged[damaged.length - 1] = damaged[damaged.length - 1]! ^ 1;
    const [result] = await outputs(pgpVerify.run([plaintext(), new File([damaged], 'damaged.sig')], { publicKey: fixture.publicKey }, context()));
    expect(JSON.parse(await result!.text())).toMatchObject({ verified: false });
  });
});

describe('legacy v5 key packet rejection', () => {
  it('retains a genuine test-only v5 fixture and leaves parsing disabled', async () => {
    const openpgp = await import('openpgp');
    expect(legacy.packetVersion).toBe(5);
    expect(openpgp.config.enableParsingV5Entities).toBe(false);
    const parsed = await openpgp.readKey({ armoredKey: legacy.publicKey, config: { enableParsingV5Entities: true } });
    expect(parsed.keyPacket.version).toBe(5);
  });

  it('rejects v5 keys in encrypt, decrypt, sign and verify tools', async () => {
    await expect(pgpEncrypt.run([plaintext()], { publicKey: legacy.publicKey }, context())).rejects.toThrow();
    await expect(pgpDecrypt.run([new File([fixture.encryptedArmored], 'legacy.asc')], { privateKey: legacy.privateKey }, context())).rejects.toThrow();
    await expect(pgpSign.run([plaintext()], { privateKey: legacy.privateKey }, context())).rejects.toThrow();
    await expect(pgpVerify.run([plaintext(), new File([fixture.signatureArmored], 'legacy.sig')], { publicKey: legacy.publicKey }, context())).rejects.toThrow();
  });
});
