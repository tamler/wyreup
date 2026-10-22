import type { ParamFieldSchema, ToolModule } from '../types.js';
import { validateUtilityParams, type UtilityParams } from './common.js';
import { exportCsv, type CsvDelimiter } from './csv-data.js';
import { runCsvFileJob, runPsdFileJob } from './file-job.js';

export const psdToPng: ToolModule<UtilityParams> = {
  id: 'psd-to-png', slug: 'psd-to-png', name: 'PSD Composite to PNG',
  description: 'Export the saved RGB or grayscale composite from an 8-bit raw or RLE PSD. Layers are not recomposited; save a composite in your editor first.',
  category: 'convert', keywords: ['psd', 'photoshop', 'png', 'composite'],
  input: { accept: ['image/vnd.adobe.photoshop', 'application/octet-stream', '.psd'], min: 1, max: 1, sizeLimit: 64 * 1024 * 1024 },
  output: { mime: 'image/png', multiple: false },
  defaults: { alphaMode: 'auto' },
  paramSchema: { alphaMode: { type: 'enum', label: 'Transparency', options: [
    { value: 'auto', label: 'Use saved merged transparency; auxiliary masks stay opaque' },
    { value: 'channel-as-transparency', label: 'Treat the extra channel as transparency' },
  ] } },
  interactive: true, batchable: false, cost: 'free', memoryEstimate: 'high', surfaces: ['web', 'cli', 'mcp'],
  async run(inputs, provided, ctx) {
    if (ctx.signal.aborted) throw new Error('PSD conversion cancelled.');
    if (inputs.length !== 1 || inputs[0]!.size > 64 * 1024 * 1024)
      throw new Error('Select one PSD file of at most 64 MiB.');
    const params = validateUtilityParams(psdToPng.defaults, {
      alphaMode: { type: 'enum', options: [{ value: 'auto', label: 'Automatic' }, { value: 'channel-as-transparency', label: 'Explicit extra channel' }] },
    }, provided);
    const bytes = new Uint8Array(await inputs[0]!.arrayBuffer());
    if (ctx.signal.aborted) throw new Error('PSD conversion cancelled.');
    ctx.onProgress({ stage: 'processing', percent: 10, message: 'Reading saved PSD composite' });
    const value = await runPsdFileJob({ type: 'psd-png', bytes, params: { alphaMode: params.alphaMode as 'auto' | 'channel-as-transparency' } }, ctx.signal);
    if (ctx.signal.aborted) throw new Error('PSD conversion cancelled.');
    ctx.onProgress({ stage: 'done', percent: 100 });
    return [new Blob([new Uint8Array(value.bytes)], { type: 'image/png' })];
  },
  __testFixtures: { valid: ['test/fixtures/catalog-composite.psd'], weird: [], expectedOutputMime: ['image/png'] },
};

export const csvViewer: ToolModule<UtilityParams> = {
  id: 'csv-viewer',
  slug: 'csv-viewer',
  name: 'CSV Viewer',
  description:
    'View, search, sort and edit CSV strings locally. Exports use the complete edited data; spreadsheet-safe conversion is optional.',
  category: 'inspect',
  keywords: ['csv', 'viewer', 'table', 'edit', 'sort', 'filter'],
  input: {
    accept: ['text/csv', 'text/tab-separated-values', 'text/plain', '.csv', '.tsv'],
    min: 1,
    max: 1,
    sizeLimit: 10 * 1024 * 1024,
  },
  output: { mime: 'text/csv', multiple: false },
  defaults: { delimiter: 'auto', hasHeader: true, spreadsheetSafe: false, selection: 'all' },
  paramSchema: {
    delimiter: {
      type: 'enum',
      label: 'Input delimiter',
      options: ['auto', 'comma', 'tab', 'semicolon', 'pipe'].map((value) => ({
        value,
        label: value,
      })),
    },
    hasHeader: { type: 'boolean', label: 'First row is a header' },
    spreadsheetSafe: {
      type: 'boolean',
      label: 'Spreadsheet-safe text',
      help: 'Prefixes formula-like strings with an apostrophe; signed numeric cells may become spreadsheet text.',
    },
    selection: {
      type: 'enum',
      label: 'Export data',
      options: [{ value: 'all', label: 'All rows' }],
    },
  },
  interactive: true,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'high',
  surfaces: ['web', 'cli', 'mcp'],
  async run(inputs, provided, ctx) {
    if (ctx.signal.aborted) throw new Error('File processing cancelled.');
    if (inputs.length !== 1) throw new Error('Select one CSV file.');
    const input = inputs[0]!;
    if (input.size > 10 * 1024 * 1024) throw new Error('CSV file exceeds 10 MiB.');
    const schema = csvViewer.paramSchema;
    if (!schema) throw new Error('CSV viewer parameter schema is unavailable.');
    const checkedSchema: Record<string, ParamFieldSchema> = {};
    for (const [key, field] of Object.entries(schema)) {
      if (field === undefined) throw new Error(`CSV viewer parameter schema is missing ${key}.`);
      checkedSchema[key] = field;
    }
    const params = validateUtilityParams(csvViewer.defaults, checkedSchema, provided);
    const bytes = new Uint8Array(await input.arrayBuffer());
    if (ctx.signal.aborted) throw new Error('File processing cancelled.');
    ctx.onProgress({ stage: 'processing', percent: 10, message: 'Parsing CSV' });
    const table = await runCsvFileJob(
      {
        type: 'csv-parse',
        bytes,
        params: {
          delimiter: params.delimiter as CsvDelimiter,
          hasHeader: params.hasHeader === true,
        },
      },
      ctx.signal,
    );
    const output = exportCsv(
      table,
      { spreadsheetSafe: params.spreadsheetSafe === true },
      ctx.signal,
    );
    if (ctx.signal.aborted) throw new Error('File processing cancelled.');
    ctx.onProgress({ stage: 'done', percent: 100 });
    return [new Blob([output], { type: 'text/csv' })];
  },
  __testFixtures: {
    valid: ['test/fixtures/catalog-csv.csv'],
    weird: [],
    expectedOutputMime: ['text/csv'],
  },
};
