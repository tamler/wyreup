import type { ToolModule, ToolRunContext } from '../../types.js';

export interface PgpSignParams {
  privateKey: string;
  passphrase?: string;
  armor?: boolean;
}

export const defaultPgpSignParams: PgpSignParams = {
  privateKey: '',
  armor: true,
};

export const pgpSign: ToolModule<PgpSignParams> = {
  id: 'pgp-sign',
  slug: 'pgp-sign',
  name: 'PGP Sign',
  description: 'Create a detached PGP signature for any file using your private key.',
  category: 'privacy',
  keywords: ['pgp', 'gpg', 'sign', 'signature', 'openpgp', 'private-key', 'verify', 'authenticity'],

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

  defaults: defaultPgpSignParams,

  paramSchema: {
    privateKey: {
      type: 'string',
      label: 'Your private key',
      multiline: true,
      placeholder: '-----BEGIN PGP PRIVATE KEY BLOCK-----\n...',
      help: 'ASCII-armored OpenPGP private key. Stays on your device.',
    },
    passphrase: {
      type: 'string',
      label: 'Passphrase',
      placeholder: 'Required if your key is protected',
      help: 'Leave empty if the key has no passphrase.',
    },
    armor: {
      type: 'boolean',
      label: 'ASCII armor signature',
      help: 'On: signature is text. Off: binary `.sig`.',
    },
  },

  async run(
    inputs: File[],
    params: PgpSignParams,
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
    const bytes = new Uint8Array(await input.arrayBuffer());

    ctx.onProgress({ stage: 'processing', percent: 60, message: 'Signing' });

    const message = await openpgp.createMessage({ binary: bytes });
    const armor = params.armor !== false;

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });

    if (armor) {
      const sigArmored = await openpgp.sign({
        message,
        signingKeys: privateKey,
        detached: true,
        format: 'armored',
      }) as unknown as string;
      return [new Blob([sigArmored], { type: 'text/plain; charset=utf-8' })];
    }

    const sigBinary = await openpgp.sign({
      message,
      signingKeys: privateKey,
      detached: true,
      format: 'binary',
    });
    const sigBytes = sigBinary as Uint8Array;
    return [new Blob([sigBytes.buffer as ArrayBuffer], { type: 'application/pgp-signature' })];
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['text/plain; charset=utf-8'],
  },
};
