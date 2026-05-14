import type { ToolModule, ToolRunContext } from '../../types.js';
import { getPipeline } from '../../lib/transformers.js';

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface TextNerParams {}

export const defaultTextNerParams: TextNerParams = {};

export interface NerEntity {
  text: string;
  type: string;
  start: number;
  end: number;
  score: number;
}

export interface TextNerResult {
  entities: NerEntity[];
}

// BERT-base NER — MIT licensed, ~110 MB
// https://huggingface.co/Xenova/bert-base-NER
// Entity types: PER (person), ORG (organization), LOC (location), MISC
const MODEL_ID = 'Xenova/bert-base-NER';

export const textNer: ToolModule<TextNerParams> = {
  id: 'text-ner',
  slug: 'text-ner',
  name: 'Named Entity Recognition',
  description: 'Identify people, organizations, and locations in text — runs on your device.',
  category: 'text',
  keywords: ['ner', 'entities', 'person', 'organization', 'location', 'nlp', 'extract'],

  input: {
    accept: ['text/plain'],
    min: 1,
    max: 1,
    sizeLimit: 1 * 1024 * 1024,
  },
  output: { mime: 'application/json' },

  interactive: true,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'medium',
  installSize: 110_000_000, // ~110 MB BERT-base
  installGroup: 'nlp-standard',
  requires: { webgpu: 'preferred' },

  defaults: defaultTextNerParams,

  async run(inputs: File[], _params: TextNerParams, ctx: ToolRunContext): Promise<Blob[]> {
    if (inputs.length !== 1) {
      throw new Error('text-ner accepts exactly one text file.');
    }
    const input = inputs[0]!;

    ctx.onProgress({ stage: 'loading-deps', percent: 0, message: 'Loading NER model' });

    const pipe = await getPipeline(ctx, 'token-classification', MODEL_ID, {
      aggregation_strategy: 'simple',
    }) as (input: string) => Promise<Array<{
      word?: string;
      entity_group?: string;
      entity?: string;
      start?: number;
      end?: number;
      score?: number;
    }>>;

    if (ctx.signal.aborted) throw new Error('Aborted');

    const text = await input.text();
    if (!text.trim()) {
      throw new Error('Input text is empty.');
    }

    ctx.onProgress({ stage: 'processing', percent: 50, message: 'Recognizing entities' });

    const rawResult = await pipe(text);

    const entities: NerEntity[] = rawResult.map((item) => ({
      text: item.word ?? '',
      type: item.entity_group ?? item.entity ?? 'MISC',
      start: item.start ?? 0,
      end: item.end ?? 0,
      score: Math.round((item.score ?? 0) * 10000) / 10000,
    }));

    const result: TextNerResult = { entities };

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' })];
  },

  __testFixtures: {
    valid: ['sample.txt'],
    weird: [],
    expectedOutputMime: ['application/json'],
  },
};
