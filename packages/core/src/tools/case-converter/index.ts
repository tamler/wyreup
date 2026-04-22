import type { ToolModule, ToolRunContext } from '../../types.js';

export interface CaseConverterParams {
  case: 'upper' | 'lower' | 'title' | 'camel' | 'snake' | 'kebab' | 'pascal' | 'constant';
}

export const defaultCaseConverterParams: CaseConverterParams = {
  case: 'lower',
};

function toWords(text: string): string[] {
  // Split on whitespace, underscores, hyphens, and camelCase boundaries
  return text
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[\s_-]+/)
    .filter((w) => w.length > 0);
}

function convertCase(text: string, targetCase: CaseConverterParams['case']): string {
  switch (targetCase) {
    case 'upper':
      return text.toUpperCase();
    case 'lower':
      return text.toLowerCase();
    case 'title':
      return text.replace(/\b\w/g, (c) => c.toUpperCase());
    case 'camel': {
      const words = toWords(text);
      return words
        .map((w, i) =>
          i === 0
            ? w.toLowerCase()
            : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase(),
        )
        .join('');
    }
    case 'snake':
      return toWords(text).map((w) => w.toLowerCase()).join('_');
    case 'kebab':
      return toWords(text).map((w) => w.toLowerCase()).join('-');
    case 'pascal':
      return toWords(text)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join('');
    case 'constant':
      return toWords(text).map((w) => w.toUpperCase()).join('_');
    default:
      throw new Error(`Unknown case: ${String(targetCase)}`);
  }
}

const CaseConverterComponentStub = (): unknown => null;

export const caseConverter: ToolModule<CaseConverterParams> = {
  id: 'case-converter',
  slug: 'case-converter',
  name: 'Case Converter',
  description:
    'Convert text between uppercase, lowercase, title, camelCase, snake_case, kebab-case, PascalCase, and CONSTANT_CASE.',
  category: 'dev',
  presence: 'both',
  keywords: ['case', 'convert', 'camel', 'snake', 'kebab', 'pascal', 'upper', 'lower', 'title'],

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

  defaults: defaultCaseConverterParams,

  paramSchema: {
    case: {
      type: 'enum',
      label: 'case',
      options: [
        { value: 'upper', label: 'UPPERCASE' },
        { value: 'lower', label: 'lowercase' },
        { value: 'title', label: 'Title Case' },
        { value: 'camel', label: 'camelCase' },
        { value: 'snake', label: 'snake_case' },
        { value: 'kebab', label: 'kebab-case' },
        { value: 'pascal', label: 'PascalCase' },
        { value: 'constant', label: 'CONSTANT_CASE' },
      ],
    },
  },

  Component: CaseConverterComponentStub,

  async run(
    inputs: File[],
    params: CaseConverterParams,
    ctx: ToolRunContext,
  ): Promise<Blob[]> {
    ctx.onProgress({ stage: 'processing', percent: 0, message: 'Converting case' });

    if (ctx.signal.aborted) throw new Error('Aborted');

    const text = await inputs[0]!.text();
    const result = convertCase(text, params.case);

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [new Blob([result], { type: 'text/plain' })];
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['text/plain'],
  },
};
