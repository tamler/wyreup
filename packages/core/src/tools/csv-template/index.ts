import type { ToolModule, ToolRunContext } from '../../types.js';
import { renderTemplate } from '../text-template/index.js';

export type CsvTemplateOnMissing = 'empty' | 'keep' | 'error';

export interface CsvTemplateParams {
  /** Mustache template — uses {{column}} or {{nested.path}}. Required. */
  template?: string;
  /** Filename pattern for each output. May reference the row, e.g. "{{id}}.md". */
  filenamePattern?: string;
  /** How to handle missing placeholders in the template. */
  onMissing?: CsvTemplateOnMissing;
  /** Output file extension when filenamePattern doesn't include one. */
  defaultExtension?: string;
  /** Treat first row as header (column names). */
  hasHeader?: boolean;
}

export const defaultCsvTemplateParams: CsvTemplateParams = {
  template: '',
  filenamePattern: 'row-{{__row}}.txt',
  onMissing: 'empty',
  defaultExtension: 'txt',
  hasHeader: true,
};

function sanitizeFilename(name: string, fallback: string): string {
  // Strip path separators + control chars; keep something resembling a filename.
  // eslint-disable-next-line no-control-regex
  const cleaned = name.replace(/[\x00-\x1f\\/]+/g, '_').trim();
  return cleaned || fallback;
}

export const csvTemplate: ToolModule<CsvTemplateParams> = {
  id: 'csv-template',
  slug: 'csv-template',
  name: 'CSV Template',
  description:
    'Mail-merge: take a CSV plus a mustache-style template, render one document per row, return a ZIP of the outputs. Filename pattern can reference row columns (e.g. "{{id}}-{{slug}}.md"). Composes csv-json + text-template + zip-create — the canonical "batch render data into N files" tool.',
  category: 'convert',
  keywords: ['csv', 'template', 'mustache', 'mail-merge', 'batch', 'render', 'export'],

  input: {
    accept: ['text/csv', 'application/csv', 'text/plain'],
    min: 1,
    max: 1,
    sizeLimit: 50 * 1024 * 1024,
  },
  output: { mime: 'application/zip' },

  interactive: false,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'medium',

  defaults: defaultCsvTemplateParams,

  paramSchema: {
    template: {
      type: 'string',
      label: 'template',
      help: 'Mustache-style {{column}} or {{nested.path}}. Required.',
      multiline: true,
    },
    filenamePattern: {
      type: 'string',
      label: 'filename pattern',
      help: 'May reference columns. {{__row}} is the row index (1-based).',
    },
    onMissing: {
      type: 'enum',
      label: 'missing placeholder',
      help: 'empty = strip; keep = leave {{tag}} in output; error = throw on missing column',
      options: [
        { value: 'empty', label: 'empty' },
        { value: 'keep', label: 'keep' },
        { value: 'error', label: 'error' },
      ],
    },
    defaultExtension: {
      type: 'string',
      label: 'default extension',
      help: 'Appended to filenamePattern when it has no extension.',
    },
    hasHeader: {
      type: 'boolean',
      label: 'first row is header',
    },
  },

  async run(inputs: File[], params: CsvTemplateParams, ctx: ToolRunContext): Promise<Blob[]> {
    if (inputs.length !== 1) throw new Error('csv-template accepts exactly one CSV file.');
    const template = (params.template ?? '').trim();
    if (!template) throw new Error('csv-template needs a "template" parameter (mustache-style).');

    ctx.onProgress({ stage: 'loading-deps', percent: 0, message: 'Loading parsers' });
    const Papa = (await import('papaparse')).default;
    const JSZip = (await import('jszip')).default;

    ctx.onProgress({ stage: 'processing', percent: 20, message: 'Parsing CSV' });
    const text = await inputs[0]!.text();
    const parsed = Papa.parse<Record<string, string>>(text, {
      header: params.hasHeader ?? true,
      skipEmptyLines: true,
      dynamicTyping: true,
    });
    if (parsed.errors.length > 0) {
      const e = parsed.errors[0]!;
      throw new Error(`CSV parse error at row ${e.row ?? '?'}: ${e.message}`);
    }
    const rows = parsed.data as Record<string, unknown>[];
    if (rows.length === 0) throw new Error('CSV had no data rows.');
    if (ctx.signal.aborted) throw new Error('Aborted');

    ctx.onProgress({ stage: 'processing', percent: 50, message: `Rendering ${rows.length} rows` });
    const filenamePattern = params.filenamePattern ?? 'row-{{__row}}.txt';
    const onMissing: CsvTemplateOnMissing = params.onMissing ?? 'empty';
    const defaultExt = (params.defaultExtension ?? 'txt').replace(/^\./, '');

    const zip = new JSZip();
    const seen = new Map<string, number>();
    const report: Array<{ row: number; filename: string; missing: string[]; resolved: number }> = [];
    let totalMissing = 0;

    for (let i = 0; i < rows.length; i++) {
      const data = { ...rows[i], __row: i + 1 };
      const body = renderTemplate(template, data, onMissing === 'error' ? 'error' : onMissing);
      const fnameRendered = renderTemplate(filenamePattern, data, 'empty').rendered;
      let filename = sanitizeFilename(fnameRendered, `row-${i + 1}`);
      if (!/\.[a-z0-9]+$/i.test(filename)) filename += '.' + defaultExt;

      // Collision handling — first one keeps its name, dupes get -2, -3 …
      const count = (seen.get(filename) ?? 0) + 1;
      seen.set(filename, count);
      const finalName = count === 1 ? filename : filename.replace(/(\.[^.]+)?$/, `-${count}$1`);

      zip.file(finalName, body.rendered);
      totalMissing += body.missing.length;
      report.push({
        row: i + 1,
        filename: finalName,
        missing: body.missing,
        resolved: body.resolved.length,
      });
      if (ctx.signal.aborted) throw new Error('Aborted');
    }

    zip.file(
      '_report.json',
      JSON.stringify(
        {
          rows: rows.length,
          template: { length: template.length },
          totalMissing,
          rowsRendered: report,
        },
        null,
        2,
      ),
    );

    ctx.onProgress({ stage: 'processing', percent: 90, message: 'Zipping' });
    const blob = await zip.generateAsync({ type: 'blob' });
    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [blob];
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['application/zip'],
  },
};
