import type { ToolModule, ToolRunContext } from '../../types.js';
import { extractFrontmatter } from '../markdown-frontmatter/index.js';
import { flattenJson } from '../json-flatten/index.js';

export interface FrontmatterToCsvParams {
  /** Frontmatter format to expect across all files. */
  format?: 'auto' | 'yaml' | 'toml' | 'json';
  /** Flatten nested frontmatter (e.g. seo.title) into dot-notation columns. */
  flatten?: boolean;
  /** Include the source filename as a leading column. */
  includeFilename?: boolean;
  /** Restrict columns to this comma-separated list (whitespace-trimmed). Empty = include every key seen. */
  columns?: string;
}

export const defaultFrontmatterToCsvParams: FrontmatterToCsvParams = {
  format: 'auto',
  flatten: true,
  includeFilename: true,
  columns: '',
};

export interface FrontmatterToCsvResult {
  filesProcessed: number;
  filesWithFrontmatter: number;
  filesSkipped: { name: string; reason: string }[];
  columns: string[];
}

const FrontmatterToCsvComponentStub = (): unknown => null;

function toCsvValue(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return v.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(';');
  return JSON.stringify(v);
}

export const frontmatterToCsv: ToolModule<FrontmatterToCsvParams> = {
  id: 'frontmatter-to-csv',
  slug: 'frontmatter-to-csv',
  name: 'Frontmatter to CSV',
  description:
    'Bulk-harvest frontmatter from a folder of markdown files into a single CSV. The header row is the union of every key seen; each row is one source file. Hugo / Astro / Jekyll content inventories in one drop.',
  category: 'convert',
  presence: 'both',
  keywords: ['frontmatter', 'csv', 'markdown', 'hugo', 'astro', 'jekyll', 'gatsby', 'inventory', 'bulk', 'metadata'],

  input: {
    accept: ['text/markdown', 'text/plain'],
    min: 1,
    max: 1000,
    sizeLimit: 100 * 1024 * 1024,
  },
  output: {
    mime: 'text/csv',
    multiple: true,
  },

  interactive: true,
  batchable: true,
  cost: 'free',
  memoryEstimate: 'low',

  defaults: defaultFrontmatterToCsvParams,

  paramSchema: {
    format: {
      type: 'enum',
      label: 'format',
      help: 'Auto picks YAML / TOML / JSON per file based on its opening fence.',
      options: [
        { value: 'auto', label: 'auto-detect (recommended)' },
        { value: 'yaml', label: 'YAML' },
        { value: 'toml', label: 'TOML' },
        { value: 'json', label: 'JSON' },
      ],
    },
    flatten: {
      type: 'boolean',
      label: 'flatten nested keys',
      help: 'Turn {"seo":{"title":"x"}} into seo.title rather than dropping the nested object.',
    },
    includeFilename: {
      type: 'boolean',
      label: 'include filename',
      help: 'Prepend the source filename as the first column.',
    },
    columns: {
      type: 'string',
      label: 'columns',
      help: 'Comma-separated allow-list. Blank = every key encountered across all files.',
      placeholder: 'title, date, draft, tags',
    },
  },

  Component: FrontmatterToCsvComponentStub,

  async run(inputs: File[], params: FrontmatterToCsvParams, ctx: ToolRunContext): Promise<Blob[]> {
    if (inputs.length === 0) throw new Error('frontmatter-to-csv requires at least one markdown file.');
    ctx.onProgress({ stage: 'loading-deps', percent: 10, message: 'Loading CSV writer' });
    const Papa = (await import('papaparse')).default;
    if (ctx.signal.aborted) throw new Error('Aborted');

    const format = params.format ?? 'auto';
    const flatten = params.flatten ?? true;
    const includeFilename = params.includeFilename ?? true;
    const explicitColumns = (params.columns ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const rows: Array<{ name: string; data: Record<string, unknown> }> = [];
    const skipped: { name: string; reason: string }[] = [];
    const seenKeys = new Set<string>();

    for (let i = 0; i < inputs.length; i++) {
      if (ctx.signal.aborted) throw new Error('Aborted');
      ctx.onProgress({
        stage: 'processing',
        percent: 20 + Math.floor((i / inputs.length) * 60),
        message: `Reading ${inputs[i]!.name} (${i + 1}/${inputs.length})`,
      });
      const file = inputs[i]!;
      const text = await file.text();
      let fm;
      try {
        fm = await extractFrontmatter(text, format);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        skipped.push({ name: file.name, reason: msg });
        continue;
      }
      if (!fm.frontmatter) {
        skipped.push({ name: file.name, reason: 'no frontmatter detected' });
        continue;
      }
      const data = flatten
        ? flattenJson(fm.frontmatter, { separator: '.', arrayStyle: 'dot', preserveArrays: true })
        : (fm.frontmatter);
      for (const k of Object.keys(data)) seenKeys.add(k);
      rows.push({ name: file.name, data });
    }

    ctx.onProgress({ stage: 'processing', percent: 85, message: 'Writing CSV' });
    const columns = explicitColumns.length > 0 ? explicitColumns : [...seenKeys].sort();
    const header = includeFilename ? ['_file', ...columns] : columns;

    const csvRows: string[][] = [header];
    for (const row of rows) {
      const out: string[] = [];
      if (includeFilename) out.push(row.name);
      for (const col of columns) out.push(toCsvValue(row.data[col]));
      csvRows.push(out);
    }
    const csv = Papa.unparse(csvRows);

    const stats: FrontmatterToCsvResult = {
      filesProcessed: inputs.length,
      filesWithFrontmatter: rows.length,
      filesSkipped: skipped,
      columns: header,
    };

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [
      new Blob([csv], { type: 'text/csv' }),
      new Blob([JSON.stringify(stats, null, 2)], { type: 'application/json' }),
    ];
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['text/csv', 'application/json'],
  },
};
