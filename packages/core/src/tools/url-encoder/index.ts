import type { ToolModule, ToolRunContext } from '../../types.js';
import type { UrlEncoderParams } from './types.js';

export type { UrlEncoderParams } from './types.js';
export { defaultUrlEncoderParams } from './types.js';

const UrlEncoderComponentStub = (): unknown => null;

export const urlEncoder: ToolModule<UrlEncoderParams> = {
  id: 'url-encoder',
  slug: 'url-encoder',
  name: 'URL Encoder',
  description: 'Encode or decode URL components and full URLs.',
  category: 'convert',
  presence: 'both',
  keywords: ['url', 'encode', 'decode', 'percent', 'uri', 'query', 'string'],

  input: {
    accept: ['text/plain'],
    min: 1,
    max: 1,
    sizeLimit: 10 * 1024 * 1024,
  },
  output: {
    mime: 'text/plain',
    multiple: false,
  },

  interactive: false,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'low',

  defaults: { mode: 'encode', scope: 'component' },

  Component: UrlEncoderComponentStub,

  async run(
    inputs: File[],
    params: UrlEncoderParams,
    ctx: ToolRunContext,
  ): Promise<Blob[]> {
    ctx.onProgress({ stage: 'processing', percent: 0, message: 'Processing URL' });

    const text = await inputs[0]!.text();
    const scope = params.scope ?? 'component';
    let result: string;

    if (params.mode === 'encode') {
      result = scope === 'component' ? encodeURIComponent(text) : encodeURI(text);
    } else {
      result = scope === 'component' ? decodeURIComponent(text) : decodeURI(text);
    }

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [new Blob([result], { type: 'text/plain' })];
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['text/plain'],
  },
};
