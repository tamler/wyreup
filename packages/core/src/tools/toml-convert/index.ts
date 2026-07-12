import type { ToolModule, ToolRunContext } from '../../types.js';
import { defaultTomlConvertParams, type TomlConvertParams } from './types.js';

export type { TomlConvertDirection, TomlConvertParams } from './types.js';
export { defaultTomlConvertParams } from './types.js';

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new Error(`Invalid JSON: ${(error as Error).message}`);
  }
}

function validateIndent(indent: number): void {
  if (!Number.isInteger(indent) || indent < 0 || indent > 8) {
    throw new Error('Indent must be an integer from 0 to 8.');
  }
}

export const tomlConvert: ToolModule<TomlConvertParams> = {
  id: 'toml-convert',
  slug: 'toml-convert',
  name: 'TOML ↔ JSON',
  description:
    'Convert TOML to JSON or JSON to TOML. Auto mode tries JSON first and otherwise parses TOML. TOML date and time values become strings in JSON, and a JSON round trip does not preserve them as TOML date types.',
  llmDescription:
    'Convert configuration data between TOML and JSON with smol-toml. Auto mode first attempts JSON.parse, then treats the input as TOML. TOML tables and arrays are preserved structurally, while TOML date and time values serialize as JSON strings and return to TOML as strings rather than date types.',
  category: 'dev',
  categories: ['dev', 'convert'],
  keywords: [
    'toml',
    'json',
    'convert',
    'config',
    'configuration',
    'parse',
    'stringify',
    'developer',
  ],

  input: {
    accept: ['text/plain', 'application/json', 'application/toml'],
    min: 1,
    max: 1,
    sizeLimit: 10 * 1024 * 1024,
  },
  output: { mime: 'application/json', multiple: false },

  interactive: true,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'low',

  defaults: defaultTomlConvertParams,

  paramSchema: {
    direction: {
      type: 'enum',
      label: 'conversion direction',
      help: 'Auto tries JSON first; if JSON parsing fails, it parses the input as TOML.',
      options: [
        { value: 'auto', label: 'Auto detect' },
        { value: 'toml-to-json', label: 'TOML to JSON' },
        { value: 'json-to-toml', label: 'JSON to TOML' },
      ],
    },
    indent: {
      type: 'number',
      label: 'JSON indentation',
      help: 'Number of spaces used to indent JSON output. This does not affect TOML output.',
      min: 0,
      max: 8,
      step: 1,
    },
  },

  async run(inputs: File[], params: TomlConvertParams, ctx: ToolRunContext): Promise<Blob[]> {
    if (inputs.length !== 1) throw new Error('toml-convert accepts exactly one input file.');
    if (ctx.signal.aborted) throw new Error('Aborted');

    const indent = params.indent ?? 2;
    validateIndent(indent);
    ctx.onProgress({ stage: 'loading-deps', percent: 10, message: 'Loading TOML parser' });
    const toml = await import('smol-toml');
    const text = await inputs[0]!.text();
    const direction = params.direction ?? 'auto';
    if (!['auto', 'toml-to-json', 'json-to-toml'].includes(direction)) {
      throw new Error(`Invalid conversion direction: ${String(direction)}.`);
    }

    ctx.onProgress({ stage: 'processing', percent: 40, message: 'Converting data' });
    let output: string;
    let mime: 'application/json' | 'application/toml';

    if (direction === 'json-to-toml') {
      try {
        output = toml.stringify(parseJson(text));
      } catch (error) {
        if ((error as Error).message.startsWith('Invalid JSON:')) throw error;
        throw new Error(`Cannot convert JSON to TOML: ${(error as Error).message}`);
      }
      mime = 'application/toml';
    } else if (direction === 'toml-to-json') {
      try {
        output = JSON.stringify(toml.parse(text), null, indent);
      } catch (error) {
        throw new Error(`Invalid TOML: ${(error as Error).message}`);
      }
      mime = 'application/json';
    } else {
      let json: unknown;
      try {
        json = JSON.parse(text) as unknown;
      } catch {
        json = undefined;
      }
      if (json !== undefined) {
        try {
          output = toml.stringify(json);
        } catch (error) {
          throw new Error(`Cannot convert JSON to TOML: ${(error as Error).message}`);
        }
        mime = 'application/toml';
      } else {
        try {
          output = JSON.stringify(toml.parse(text), null, indent);
          mime = 'application/json';
        } catch (error) {
          throw new Error(`Invalid JSON or TOML: ${(error as Error).message}`);
        }
      }
    }

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [new Blob([output], { type: mime })];
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['application/json', 'application/toml'],
  },
};
