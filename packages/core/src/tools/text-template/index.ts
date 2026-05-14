import type { ToolModule, ToolRunContext } from '../../types.js';

export interface TextTemplateParams {
  /** Template string with {{path.to.value}} placeholders. */
  template?: string;
  /** What to substitute when a placeholder is missing — empty string, keep the {{tag}}, or throw. */
  onMissing?: 'empty' | 'keep' | 'error';
}

export const defaultTextTemplateParams: TextTemplateParams = {
  template: '',
  onMissing: 'empty',
};

export interface TextTemplateResult {
  rendered: string;
  resolved: string[];
  missing: string[];
}

function lookup(data: unknown, path: string): unknown {
  const segments = path.split('.').map((s) => s.trim()).filter(Boolean);
  let cursor: unknown = data;
  for (const seg of segments) {
    if (cursor === null || cursor === undefined) return undefined;
    if (Array.isArray(cursor)) {
      const idx = Number(seg);
      if (!Number.isInteger(idx)) return undefined;
      cursor = cursor[idx];
    } else if (typeof cursor === 'object') {
      cursor = (cursor as Record<string, unknown>)[seg];
    } else {
      return undefined;
    }
  }
  return cursor;
}

function stringify(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

export function renderTemplate(
  template: string,
  data: unknown,
  onMissing: 'empty' | 'keep' | 'error' = 'empty',
): TextTemplateResult {
  const resolved: string[] = [];
  const missing: string[] = [];
  const rendered = template.replace(/\{\{\s*([^\s{}][^{}]*?)\s*\}\}/g, (match, expr: string) => {
    const value = lookup(data, expr);
    if (value === undefined) {
      missing.push(expr);
      if (onMissing === 'error') throw new Error(`Template placeholder "{{${expr}}}" has no matching data value.`);
      return onMissing === 'keep' ? match : '';
    }
    resolved.push(expr);
    return stringify(value);
  });
  return { rendered, resolved, missing };
}

export const textTemplate: ToolModule<TextTemplateParams> = {
  id: 'text-template',
  slug: 'text-template',
  name: 'Text Template',
  description:
    'Mustache-style {{path.to.value}} substitution. Takes a JSON data file plus a template parameter, returns the rendered text with a report of which placeholders matched and which were missing. Pairs with csv-json to render one document per row.',
  category: 'text',
  keywords: ['template', 'mustache', 'render', 'substitute', 'placeholder', 'merge'],

  input: {
    accept: ['application/json', 'text/plain'],
    min: 1,
    max: 1,
    sizeLimit: 50 * 1024 * 1024,
  },
  output: {
    mime: 'text/plain',
    multiple: true,
  },

  interactive: true,
  batchable: true,
  cost: 'free',
  memoryEstimate: 'low',

  defaults: defaultTextTemplateParams,

  paramSchema: {
    template: {
      type: 'string',
      label: 'template',
      help: 'Use {{name}}, {{user.email}}, {{items.0.title}} to reference values from the JSON file.',
      placeholder: 'Hello {{name}}, welcome to {{company}}!',
      multiline: true,
    },
    onMissing: {
      type: 'enum',
      label: 'on missing',
      help: 'What to do when a placeholder has no matching value in the JSON.',
      options: [
        { value: 'empty', label: 'empty — replace with blank string' },
        { value: 'keep', label: 'keep — leave the {{tag}} intact' },
        { value: 'error', label: 'error — fail the render' },
      ],
    },
  },

  async run(inputs: File[], params: TextTemplateParams, ctx: ToolRunContext): Promise<Blob[]> {
    if (inputs.length !== 1) throw new Error('text-template accepts exactly one JSON file.');
    const template = params.template ?? '';
    if (!template) throw new Error('text-template requires a template string.');

    ctx.onProgress({ stage: 'processing', percent: 30, message: 'Parsing JSON' });
    const text = await inputs[0]!.text();
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Input is not valid JSON: ${msg}`);
    }
    if (ctx.signal.aborted) throw new Error('Aborted');

    ctx.onProgress({ stage: 'processing', percent: 70, message: 'Rendering' });
    const result = renderTemplate(template, data, params.onMissing ?? 'empty');

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [
      new Blob([result.rendered], { type: 'text/plain' }),
      new Blob([JSON.stringify({ resolved: result.resolved, missing: result.missing }, null, 2)], { type: 'application/json' }),
    ];
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['text/plain', 'application/json'],
  },
};
