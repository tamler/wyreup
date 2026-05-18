import type { ToolModule, ToolRunContext } from '../../types.js';
import { shouldInclude } from '../zip-extract/index.js';

export interface ZipRemoveParams {
  /**
   * Glob pattern matching entries to remove. Supports `*` (any non-slash
   * chars), `**` (any chars including slashes), and `?` (single char).
   * Example: `**​/.env` to drop all dotenvs, `*.log` to drop top-level logs.
   */
  pattern?: string;
  /** Operate on directory entries too (matches stripped, descendants also removed). */
  removeDirectories?: boolean;
}

export const defaultZipRemoveParams: ZipRemoveParams = {
  pattern: '**/.env',
  removeDirectories: true,
};

export const zipRemove: ToolModule<ZipRemoveParams> = {
  id: 'zip-remove',
  slug: 'zip-remove',
  name: 'Remove from ZIP',
  description:
    'Strip entries from a ZIP archive by glob pattern (e.g. `**/.env` to drop dotfiles before sharing). Returns a new archive — original is untouched. Runs entirely in your browser.',
  category: 'archive',
  keywords: ['zip', 'archive', 'remove', 'strip', 'delete', 'clean', 'glob'],

  input: {
    accept: ['application/zip', 'application/x-zip-compressed'],
    min: 1,
    max: 1,
    sizeLimit: 500 * 1024 * 1024,
  },
  output: { mime: 'application/zip' },

  interactive: false,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'medium',

  chainSuggestions: ['zip-info', 'zip-extract', 'zip-flatten'],

  defaults: defaultZipRemoveParams,
  paramSchema: {
    pattern: {
      type: 'string',
      label: 'glob pattern',
      placeholder: '**/.env',
      help: '* matches anything except /, ** matches everything, ? matches one char. Match is against the full path.',
    },
    removeDirectories: {
      type: 'boolean',
      label: 'remove matching directories',
      help: 'When on, a directory match also drops all its descendants.',
    },
  },

  async run(
    inputs: File[],
    params: ZipRemoveParams,
    ctx: ToolRunContext,
  ): Promise<Blob> {
    if (inputs.length !== 1) throw new Error('zip-remove accepts exactly one ZIP file.');
    if (ctx.signal.aborted) throw new Error('Aborted');

    const pattern = (params.pattern ?? '').trim();
    if (!pattern) throw new Error('Glob pattern is required.');

    ctx.onProgress({ stage: 'loading-deps', percent: 0, message: 'Loading JSZip' });
    const JSZip = (await import('jszip')).default;
    if (ctx.signal.aborted) throw new Error('Aborted');

    const bytes = await inputs[0]!.arrayBuffer();
    ctx.onProgress({ stage: 'processing', percent: 30, message: 'Reading archive' });
    const zip = await JSZip.loadAsync(bytes);

    if (ctx.signal.aborted) throw new Error('Aborted');

    const removeDirs = params.removeDirectories !== false;
    const toRemove: string[] = [];
    const removedDirs: string[] = [];

    // First pass: collect everything that matches.
    zip.forEach((relativePath, file) => {
      if (file.dir && !removeDirs) return;
      if (shouldInclude(relativePath, pattern)) {
        toRemove.push(relativePath);
        if (file.dir) removedDirs.push(relativePath);
      }
    });

    // Cascade: if a directory matched, also remove its descendants.
    if (removeDirs && removedDirs.length > 0) {
      zip.forEach((relativePath, _file) => {
        for (const dir of removedDirs) {
          if (relativePath.startsWith(dir) && !toRemove.includes(relativePath)) {
            toRemove.push(relativePath);
            break;
          }
        }
      });
    }

    if (toRemove.length === 0) {
      throw new Error(`No entries matched ${pattern}`);
    }

    ctx.onProgress({
      stage: 'processing',
      percent: 60,
      message: `Removing ${toRemove.length} ${toRemove.length === 1 ? 'entry' : 'entries'}`,
    });

    for (const path of toRemove) {
      zip.remove(path);
    }

    if (ctx.signal.aborted) throw new Error('Aborted');
    ctx.onProgress({ stage: 'encoding', percent: 80, message: 'Writing archive' });

    const out = await zip.generateAsync(
      { type: 'arraybuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } },
      (m) => {
        ctx.onProgress({
          stage: 'encoding',
          percent: 80 + Math.floor(m.percent * 0.2),
        });
      },
    );

    ctx.onProgress({ stage: 'done', percent: 100 });
    return new Blob([out], { type: 'application/zip' });
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['application/zip'],
  },
};
