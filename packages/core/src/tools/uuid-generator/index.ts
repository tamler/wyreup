import type { ToolModule, ToolRunContext } from '../../types.js';
import type { UuidGeneratorParams } from './types.js';

export type { UuidGeneratorParams } from './types.js';
export { defaultUuidGeneratorParams } from './types.js';

const UuidGeneratorComponentStub = (): unknown => null;

export const uuidGenerator: ToolModule<UuidGeneratorParams> = {
  id: 'uuid-generator',
  slug: 'uuid-generator',
  name: 'UUID Generator',
  description: 'Generate one or more random UUID v4 identifiers.',
  category: 'create',
  presence: 'both',
  keywords: ['uuid', 'guid', 'generate', 'random', 'identifier', 'id'],

  input: {
    accept: [],
    min: 0,
    max: 0,
  },
  output: {
    mime: 'text/plain',
    multiple: false,
  },

  interactive: false,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'low',

  defaults: { version: 4, count: 1 },

  paramSchema: {
    version: {
      type: 'enum',
      label: 'version',
      help: 'UUID format. v4 is random and the most common.',
      options: [
        { value: 4, label: 'v4 (random)' },
      ],
    },
    count: {
      type: 'range',
      label: 'count',
      help: 'How many UUIDs to generate (one per line).',
      min: 1,
      max: 1000,
      step: 1,
    },
  },

  Component: UuidGeneratorComponentStub,

  // Tool contract requires Promise return; no internal await needed.
   
  async run(
    _inputs: File[],
    params: UuidGeneratorParams,
    ctx: ToolRunContext,
  ): Promise<Blob[]> {
    ctx.onProgress({ stage: 'processing', percent: 0, message: 'Generating UUID' });

    const version = params.version;
    if (version !== undefined && version !== 4) {
      throw new Error(`Unsupported UUID version: ${String(version)}. Only v4 is supported.`);
    }
    const count = params.count ?? 1;
    if (count < 1) throw new Error('count must be >= 1');
    if (count > 1000) throw new Error('count must be <= 1000');
    const uuids: string[] = [];

    for (let i = 0; i < count; i++) {
      uuids.push(crypto.randomUUID());
    }

    const output = uuids.join('\n');

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [new Blob([output], { type: 'text/plain' })];
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['text/plain'],
  },
};
