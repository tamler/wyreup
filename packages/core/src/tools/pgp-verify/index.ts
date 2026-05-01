import type { ToolModule, ToolRunContext } from '../../types.js';

export interface PgpVerifyParams {
  publicKey: string;
}

export interface PgpVerifyResult {
  verified: boolean;
  signerKeyId: string;
  signedAt: string | null;
  error?: string;
}

export const defaultPgpVerifyParams: PgpVerifyParams = {
  publicKey: '',
};

const PgpVerifyComponentStub = (): unknown => null;

export const pgpVerify: ToolModule<PgpVerifyParams> = {
  id: 'pgp-verify',
  slug: 'pgp-verify',
  name: 'PGP Verify',
  description: 'Verify a detached PGP signature against the original file using a public key.',
  category: 'privacy',
  presence: 'both',
  keywords: ['pgp', 'gpg', 'verify', 'signature', 'openpgp', 'public-key', 'authenticity'],

  input: {
    // First file: the original data. Second file: the detached signature.
    accept: ['*/*'],
    min: 2,
    max: 2,
    sizeLimit: 100 * 1024 * 1024,
  },
  output: { mime: 'application/json' },

  interactive: false,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'medium',

  defaults: defaultPgpVerifyParams,

  paramSchema: {
    publicKey: {
      type: 'string',
      label: 'Signer public key',
      multiline: true,
      placeholder: '-----BEGIN PGP PUBLIC KEY BLOCK-----\n...',
      help: 'ASCII-armored OpenPGP public key of whoever signed the file.',
    },
  },

  Component: PgpVerifyComponentStub,

  async run(
    inputs: File[],
    params: PgpVerifyParams,
    ctx: ToolRunContext,
  ): Promise<Blob[]> {
    if (!params.publicKey || params.publicKey.trim() === '') {
      throw new Error('publicKey is required.');
    }
    if (inputs.length < 2) {
      throw new Error('pgp-verify requires two files: the original file and its detached signature.');
    }

    ctx.onProgress({ stage: 'loading-deps', percent: 10, message: 'Loading OpenPGP.js' });
    const openpgp = await import('openpgp');

    if (ctx.signal.aborted) throw new Error('Aborted');

    ctx.onProgress({ stage: 'processing', percent: 30, message: 'Reading public key' });

    const publicKey = await openpgp.readKey({ armoredKey: params.publicKey });

    const dataFile = inputs[0]!;
    const sigFile = inputs[1]!;

    const dataBytes = new Uint8Array(await dataFile.arrayBuffer());
    const sigText = await sigFile.text();

    ctx.onProgress({ stage: 'processing', percent: 60, message: 'Verifying signature' });

    const result: PgpVerifyResult = {
      verified: false,
      signerKeyId: '',
      signedAt: null,
    };

    try {
      let signature: Awaited<ReturnType<typeof openpgp.readSignature>>;
      try {
        signature = await openpgp.readSignature({ armoredSignature: sigText });
      } catch {
        const sigBytes = new Uint8Array(await sigFile.arrayBuffer());
        signature = await openpgp.readSignature({ binarySignature: sigBytes });
      }

      const message = await openpgp.createMessage({ binary: dataBytes });

      const verificationResult = await openpgp.verify({
        message,
        signature,
        verificationKeys: publicKey,
      });

      const sig = verificationResult.signatures[0];
      if (sig) {
        result.signerKeyId = sig.keyID.toHex();
        try {
          await sig.verified;
          result.verified = true;
        } catch (err) {
          result.verified = false;
          result.error = err instanceof Error ? err.message : 'Signature verification failed';
        }
        // Best-effort: extract signing timestamp (sig.signature may be lazily parsed)
        try {
          const created = (sig.signature as unknown as { packets?: Array<{ created?: Date }> }).packets?.[0]?.created;
          result.signedAt = created?.toISOString() ?? null;
        } catch {
          result.signedAt = null;
        }
      } else {
        result.error = 'No signatures found';
      }
    } catch (err) {
      result.error = err instanceof Error ? err.message : 'Unknown error during verification';
    }

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [new Blob([JSON.stringify(result)], { type: 'application/json' })];
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['application/json'],
  },
};
