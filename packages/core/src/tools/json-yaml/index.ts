import type { ToolModule, ToolRunContext } from '../../types.js';

export interface JsonYamlParams {
  direction?: 'auto' | 'json-to-yaml' | 'yaml-to-json';
  indent?: number;
}

export const defaultJsonYamlParams: JsonYamlParams = {
  direction: 'auto',
  indent: 2,
};

function looksLikeJson(text: string): boolean {
  const t = text.trimStart();
  return t.startsWith('{') || t.startsWith('[');
}

const JsonYamlComponentStub = (): unknown => null;

export const jsonYaml: ToolModule<JsonYamlParams> = {
  id: 'json-yaml',
  slug: 'json-yaml',
  name: 'JSON ↔ YAML',
  description: 'Convert between JSON and YAML formats. Auto-detects direction from input.',
  category: 'dev',
  presence: 'both',
  keywords: ['json', 'yaml', 'convert', 'transform', 'config', 'format'],

  input: {
    accept: ['text/plain', 'application/json', 'application/x-yaml', 'text/yaml'],
    min: 1,
    max: 1,
    sizeLimit: 10 * 1024 * 1024,
  },
  output: {
    mime: 'text/plain',
    multiple: false,
  },

  interactive: true,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'low',

  defaults: defaultJsonYamlParams,

  Component: JsonYamlComponentStub,

  async run(
    inputs: File[],
    params: JsonYamlParams,
    ctx: ToolRunContext,
  ): Promise<Blob[]> {
    ctx.onProgress({ stage: 'loading-deps', percent: 0, message: 'Loading YAML library' });

    if (ctx.signal.aborted) throw new Error('Aborted');

    const yaml = await import('js-yaml');

    ctx.onProgress({ stage: 'processing', percent: 30, message: 'Converting' });

    const text = await inputs[0]!.text();
    const direction = params.direction ?? 'auto';

    const toYaml = direction === 'json-to-yaml' || (direction === 'auto' && looksLikeJson(text));

    let result: string;
    if (toYaml) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch (e) {
        throw new Error(`Invalid JSON: ${(e as Error).message}`);
      }
      result = yaml.dump(parsed, { indent: params.indent ?? 2, lineWidth: -1 });
    } else {
      let parsed: unknown;
      try {
        parsed = yaml.load(text, { schema: yaml.DEFAULT_SCHEMA });
      } catch (e) {
        throw new Error(`Invalid YAML: ${(e as Error).message}`);
      }
      result = JSON.stringify(parsed, null, params.indent ?? 2);
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
