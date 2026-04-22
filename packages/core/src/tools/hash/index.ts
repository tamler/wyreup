import type { ToolModule, ToolRunContext } from '../../types.js';
import type { HashParams, HashFileResult, HashAlgorithm } from './types.js';

export type { HashParams, HashFileResult, HashAlgorithm } from './types.js';
export { defaultHashParams } from './types.js';

const HashComponentStub = (): unknown => null;

export const hash: ToolModule<HashParams> = {
  id: 'hash',
  slug: 'hash',
  name: 'Hash',
  description: 'Compute SHA-256, SHA-1, or SHA-512 hashes of files.',
  category: 'inspect',
  presence: 'both',
  keywords: ['hash', 'checksum', 'sha256', 'sha1', 'sha512', 'integrity'],

  input: {
    accept: ['*/*'],
    min: 1,
    sizeLimit: 500 * 1024 * 1024,
  },
  output: {
    mime: 'application/json',
    multiple: false,
  },

  interactive: false,
  batchable: true,
  cost: 'free',
  memoryEstimate: 'low',

  defaults: { algorithms: ['SHA-256'] },

  paramSchema: {
    algorithms: {
      type: 'multi-enum',
      label: 'algorithms',
      help: 'Select one or more hash algorithms to compute.',
      options: [
        { value: 'SHA-1', label: 'SHA-1' },
        { value: 'SHA-256', label: 'SHA-256' },
        { value: 'SHA-512', label: 'SHA-512' },
      ],
    },
  },

  Component: HashComponentStub,

  async run(
    inputs: File[],
    params: HashParams,
    ctx: ToolRunContext,
  ): Promise<Blob[]> {
    const { algorithms } = params;
    const results: HashFileResult[] = [];

    for (let i = 0; i < inputs.length; i++) {
      if (ctx.signal.aborted) throw new Error('Aborted');

      const input = inputs[i]!;
      ctx.onProgress({
        stage: 'processing',
        percent: Math.floor((i / inputs.length) * 100),
        message: `Hashing ${input.name} (${i + 1}/${inputs.length})`,
      });

      const buffer = await input.arrayBuffer();
      const hashes: Partial<Record<HashAlgorithm, string>> = {};

      for (const algo of algorithms) {
        const digest = await crypto.subtle.digest(algo, buffer);
        hashes[algo] = Array.from(new Uint8Array(digest))
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('');
      }

      results.push({ name: input.name, bytes: buffer.byteLength, hashes });
    }

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    const payload = results.length === 1 ? results[0] : results;
    return [new Blob([JSON.stringify(payload)], { type: 'application/json' })];
  },

  __testFixtures: {
    valid: ['photo.jpg', 'doc-a.pdf'],
    weird: [],
    expectedOutputMime: ['application/json'],
  },
};
