import type { ToolModule, ToolRunContext } from '../../types.js';

export interface PgpDecryptParams {
  privateKey: string;
  passphrase?: string;
}

export const defaultPgpDecryptParams: PgpDecryptParams = {
  privateKey: '',
};

const PgpDecryptComponentStub = (): unknown => null;

export const pgpDecrypt: ToolModule<PgpDecryptParams> = {
  id: 'pgp-decrypt',
  slug: 'pgp-decrypt',
  name: 'PGP Decrypt',
  description: 'Decrypt a PGP-encrypted file using your private key.',
  category: 'privacy',
  presence: 'both',
  keywords: ['pgp', 'gpg', 'decrypt', 'openpgp', 'private-key', 'security', 'privacy'],

  input: {
    accept: ['text/plain', 'application/pgp-encrypted', 'application/octet-stream'],
    min: 1,
    max: 1,
    sizeLimit: 100 * 1024 * 1024,
  },
  output: { mime: 'application/octet-stream' },

  interactive: false,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'medium',

  defaults: defaultPgpDecryptParams,

  Component: PgpDecryptComponentStub,

  async run(
    inputs: File[],
    params: PgpDecryptParams,
    ctx: ToolRunContext,
  ): Promise<Blob[]> {
    if (!params.privateKey || params.privateKey.trim() === '') {
      throw new Error('privateKey is required.');
    }

    ctx.onProgress({ stage: 'loading-deps', percent: 10, message: 'Loading OpenPGP.js' });
    const openpgp = await import('openpgp');

    if (ctx.signal.aborted) throw new Error('Aborted');

    ctx.onProgress({ stage: 'processing', percent: 30, message: 'Reading private key' });

    let privateKey = await openpgp.readPrivateKey({ armoredKey: params.privateKey });
    if (params.passphrase) {
      privateKey = await openpgp.decryptKey({
        privateKey,
        passphrase: params.passphrase,
      });
    }

    const input = inputs[0]!;
    const text = await input.text();

    ctx.onProgress({ stage: 'processing', percent: 60, message: 'Decrypting' });

    let message: Awaited<ReturnType<typeof openpgp.readMessage>>;
    try {
      message = await openpgp.readMessage({ armoredMessage: text });
    } catch {
      const bytes = new Uint8Array(await input.arrayBuffer());
      message = await openpgp.readMessage({ binaryMessage: bytes });
    }

    const { data } = await openpgp.decrypt({
      message,
      decryptionKeys: privateKey,
      format: 'binary',
    });

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    const decryptedBytes = data as Uint8Array;
    // Copy into a fresh ArrayBuffer-backed view so the Blob constructor's
    // strict TS type (BlobPart = ArrayBufferView<ArrayBuffer>) accepts it.
    // Uint8Array's backing can be SharedArrayBuffer in some runtimes, which
    // TS rejects for Blob. Copy avoids that at negligible cost.
    const copy = new Uint8Array(decryptedBytes.byteLength);
    copy.set(decryptedBytes);
    return [new Blob([copy], { type: 'application/octet-stream' })];
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['application/octet-stream'],
  },
};
