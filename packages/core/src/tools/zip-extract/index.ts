import type { ToolModule, ToolRunContext } from '../../types.js';

export interface ZipExtractParams {
  filter?: string;
}

export const defaultZipExtractParams: ZipExtractParams = {};

function matchesGlob(name: string, pattern: string): boolean {
  // Simple glob: * matches anything except /; ** matches everything
  const regexStr = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '.+')
    .replace(/\*/g, '[^/]+')
    .replace(/\?/g, '[^/]');
  const regex = new RegExp(`^${regexStr}$`);
  return regex.test(name);
}

export function shouldInclude(path: string, filter: string | undefined): boolean {
  if (!filter || filter.trim() === '') return true;
  return matchesGlob(path, filter.trim());
}

const ZipExtractComponentStub = (): unknown => null;

export const zipExtract: ToolModule<ZipExtractParams> = {
  id: 'zip-extract',
  slug: 'zip-extract',
  name: 'Extract ZIP',
  description: 'Extract files from a ZIP archive. Optional glob filter to extract only matching files.',
  category: 'archive',
  presence: 'both',
  keywords: ['zip', 'extract', 'unzip', 'decompress', 'archive', 'files'],

  input: {
    accept: ['application/zip', 'application/x-zip-compressed'],
    min: 1,
    max: 1,
    sizeLimit: 500 * 1024 * 1024,
  },
  output: { mime: 'application/octet-stream', multiple: true },

  interactive: false,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'low',

  defaults: defaultZipExtractParams,

  Component: ZipExtractComponentStub,

  async run(
    inputs: File[],
    params: ZipExtractParams,
    ctx: ToolRunContext,
  ): Promise<Blob[]> {
    ctx.onProgress({ stage: 'loading-deps', percent: 0, message: 'Loading JSZip' });
    const JSZip = (await import('jszip')).default;

    if (ctx.signal.aborted) throw new Error('Aborted');

    const bytes = await inputs[0]!.arrayBuffer();
    ctx.onProgress({ stage: 'processing', percent: 20, message: 'Opening ZIP' });

    const zip = await JSZip.loadAsync(bytes);

    const entries = Object.values(zip.files).filter(
      (f) => !f.dir && shouldInclude(f.name, params.filter),
    );

    if (entries.length === 0) {
      throw new Error('No files found in the archive matching the filter.');
    }

    const blobs: Blob[] = [];
    for (let i = 0; i < entries.length; i++) {
      if (ctx.signal.aborted) throw new Error('Aborted');
      const entry = entries[i]!;
      ctx.onProgress({
        stage: 'processing',
        percent: 20 + Math.floor((i / entries.length) * 70),
        message: `Extracting ${entry.name}`,
      });
      const content = await entry.async('uint8array');
      blobs.push(new File([content.buffer as ArrayBuffer], entry.name, { type: 'application/octet-stream' }));
    }

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return blobs;
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['application/octet-stream'],
  },
};
