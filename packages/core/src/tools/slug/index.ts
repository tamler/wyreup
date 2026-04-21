import type { ToolModule, ToolRunContext } from '../../types.js';

export interface SlugParams {
  separator?: '-' | '_';
  lowercase?: boolean;
  maxLength?: number;
}

export const defaultSlugParams: SlugParams = {
  separator: '-',
  lowercase: true,
  maxLength: undefined,
};

function slugify(text: string, params: SlugParams): string {
  const sep = params.separator ?? '-';
  let result = text
    // Normalize unicode: decompose accents from base letters
    .normalize('NFD')
    // Remove combining diacritical marks
    .replace(/[\u0300-\u036f]/g, '')
    // Replace non-alphanumeric (except hyphens/underscores) with separator
    .replace(/[^a-zA-Z0-9]+/g, sep)
    // Collapse runs of separator
    .replace(new RegExp(`${sep === '-' ? '-' : '_'}+`, 'g'), sep)
    // Trim leading/trailing separator
    .replace(new RegExp(`^${sep === '-' ? '-' : '_'}|${sep === '-' ? '-' : '_'}$`, 'g'), '');

  if (params.lowercase !== false) {
    result = result.toLowerCase();
  }

  if (params.maxLength !== undefined && params.maxLength > 0) {
    result = result.slice(0, params.maxLength);
    // Trim trailing separator after truncation
    result = result.replace(new RegExp(`${sep === '-' ? '-' : '_'}$`), '');
  }

  return result;
}

const SlugComponentStub = (): unknown => null;

export const slug: ToolModule<SlugParams> = {
  id: 'slug',
  slug: 'slug',
  name: 'Slug Generator',
  description: 'Convert text into URL-friendly slugs. Strips diacritics, collapses whitespace, removes special characters.',
  category: 'create',
  presence: 'both',
  keywords: ['slug', 'url', 'permalink', 'sanitize', 'kebab', 'friendly'],

  input: {
    accept: ['text/plain'],
    min: 1,
    max: 1,
    sizeLimit: 1 * 1024 * 1024,
  },
  output: {
    mime: 'text/plain',
    multiple: false,
  },

  interactive: true,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'low',

  defaults: defaultSlugParams,

  Component: SlugComponentStub,

  async run(
    inputs: File[],
    params: SlugParams,
    ctx: ToolRunContext,
  ): Promise<Blob[]> {
    ctx.onProgress({ stage: 'processing', percent: 0, message: 'Generating slug' });

    if (ctx.signal.aborted) throw new Error('Aborted');

    const text = await inputs[0]!.text();
    const result = slugify(text.trim(), params);

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [new Blob([result], { type: 'text/plain' })];
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['text/plain'],
  },
};
