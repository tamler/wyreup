import type { ToolModule, ToolRunContext } from '../../types.js';

export interface PgpEncryptParams {
  publicKey: string;
  armor?: boolean;
  filename?: string;
}

export const defaultPgpEncryptParams: PgpEncryptParams = {
  publicKey: '',
  armor: true,
};

const PgpEncryptComponentStub = (): unknown => null;

export const pgpEncrypt: ToolModule<PgpEncryptParams> = {
  id: 'pgp-encrypt',
  slug: 'pgp-encrypt',
  name: 'PGP Encrypt',
  description: 'Encrypt a file using a PGP public key. Outputs ASCII-armored or binary ciphertext.',
  category: 'privacy',
  presence: 'both',
  keywords: ['pgp', 'gpg', 'encrypt', 'openpgp', 'public-key', 'security', 'privacy'],

  input: {
    accept: ['*/*'],
    min: 1,
    max: 1,
    sizeLimit: 100 * 1024 * 1024,
  },
  output: { mime: 'text/plain' },

  interactive: false,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'medium',

  defaults: defaultPgpEncryptParams,

  paramSchema: {
    publicKey: {
      type: 'string',
      label: 'Recipient public key',
      multiline: true,
      placeholder: '-----BEGIN PGP PUBLIC KEY BLOCK-----\n...',
      help: 'ASCII-armored OpenPGP public key of the recipient.',
    },
    armor: {
      type: 'boolean',
      label: 'ASCII armor output',
      help: 'On: output is text. Off: output is binary `.pgp`.',
    },
    filename: {
      type: 'string',
      label: 'Filename hint',
      placeholder: 'Original filename (optional)',
      help: 'Stored inside the encrypted message; used by some clients on decrypt.',
    },
  },

  Component: PgpEncryptComponentStub,

  async run(
    inputs: File[],
    params: PgpEncryptParams,
    ctx: ToolRunContext,
  ): Promise<Blob[]> {
    if (!params.publicKey || params.publicKey.trim() === '') {
      throw new Error('publicKey is required.');
    }

    ctx.onProgress({ stage: 'loading-deps', percent: 10, message: 'Loading OpenPGP.js' });
    const openpgp = await import('openpgp');

    if (ctx.signal.aborted) throw new Error('Aborted');

    ctx.onProgress({ stage: 'processing', percent: 30, message: 'Reading key' });
    const publicKey = await openpgp.readKey({ armoredKey: params.publicKey });

    const input = inputs[0]!;
    const bytes = new Uint8Array(await input.arrayBuffer());

    ctx.onProgress({ stage: 'processing', percent: 60, message: 'Encrypting' });

    const armor = params.armor !== false;
    const message = await openpgp.createMessage({
      binary: bytes,
      filename: params.filename ?? input.name,
    });

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });

    if (armor) {
      const encryptedArmored = await openpgp.encrypt({
        message,
        encryptionKeys: publicKey,
        format: 'armored',
      }) as unknown as string;
      return [new Blob([encryptedArmored], { type: 'text/plain; charset=utf-8' })];
    }

    const encryptedBinary = await openpgp.encrypt({
      message,
      encryptionKeys: publicKey,
      format: 'binary',
    });
    const binaryBytes = encryptedBinary as Uint8Array;
    return [new Blob([binaryBytes.buffer as ArrayBuffer], { type: 'application/pgp-encrypted' })];
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['text/plain; charset=utf-8'],
  },
};
