import type { ToolModule, ToolRunContext } from '../../types.js';

export interface ZipEntryInfo {
  path: string;
  size: number;
  compressedSize: number;
  modified: string;
  isDirectory: boolean;
}

export interface ZipInfoResult {
  entries: number;
  totalUncompressed: number;
  totalCompressed: number;
  compressionRatio: number;
  files: ZipEntryInfo[];
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ZipInfoParams {}

export const defaultZipInfoParams: ZipInfoParams = {};

export const zipInfo: ToolModule<ZipInfoParams> = {
  id: 'zip-info',
  slug: 'zip-info',
  name: 'ZIP Info',
  description: 'Inspect a ZIP archive: list entries, sizes, compression ratio, and timestamps.',
  category: 'archive',
  keywords: ['zip', 'inspect', 'info', 'list', 'archive', 'contents', 'metadata'],

  input: {
    accept: ['application/zip', 'application/x-zip-compressed'],
    min: 1,
    max: 1,
    sizeLimit: 500 * 1024 * 1024,
  },
  output: { mime: 'application/json' },

  interactive: false,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'low',

  defaults: defaultZipInfoParams,

  async run(
    inputs: File[],
    _params: ZipInfoParams,
    ctx: ToolRunContext,
  ): Promise<Blob[]> {
    ctx.onProgress({ stage: 'loading-deps', percent: 0, message: 'Loading JSZip' });
    const JSZip = (await import('jszip')).default;

    if (ctx.signal.aborted) throw new Error('Aborted');

    const bytes = await inputs[0]!.arrayBuffer();
    ctx.onProgress({ stage: 'processing', percent: 30, message: 'Reading ZIP metadata' });

    const zip = await JSZip.loadAsync(bytes);

    let totalUncompressed = 0;
    let totalCompressed = 0;
    const files: ZipEntryInfo[] = [];

    for (const [path, entry] of Object.entries(zip.files)) {
      // JSZip doesn't expose raw compressed sizes directly, so we use the
      // internal _data field which is set after loading.
      const internalData = (entry as unknown as { _data?: { uncompressedSize?: number; compressedSize?: number } })._data;
      const uncompressedSize = internalData?.uncompressedSize ?? 0;
      const compressedSize = internalData?.compressedSize ?? uncompressedSize;

      if (!entry.dir) {
        totalUncompressed += uncompressedSize;
        totalCompressed += compressedSize;
      }

      files.push({
        path,
        size: uncompressedSize,
        compressedSize,
        modified: entry.date?.toISOString() ?? new Date(0).toISOString(),
        isDirectory: entry.dir,
      });
    }

    const compressionRatio =
      totalUncompressed > 0
        ? Math.round((1 - totalCompressed / totalUncompressed) * 10000) / 100
        : 0;

    const result: ZipInfoResult = {
      entries: files.length,
      totalUncompressed,
      totalCompressed,
      compressionRatio,
      files,
    };

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' })];
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['application/json'],
  },
};
