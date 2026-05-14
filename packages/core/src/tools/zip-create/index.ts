import type { ToolModule, ToolRunContext } from '../../types.js';

export type ZipCompression = 'DEFLATE' | 'STORE';

export interface ZipCreateParams {
  compression?: ZipCompression;
  compressionLevel?: number;
  filename?: string;
}

export const defaultZipCreateParams: ZipCreateParams = {
  compression: 'DEFLATE',
  compressionLevel: 6,
};

export const zipCreate: ToolModule<ZipCreateParams> = {
  id: 'zip-create',
  slug: 'zip-create',
  name: 'Create ZIP',
  description: 'Compress one or more files into a ZIP archive.',
  category: 'archive',
  keywords: ['zip', 'compress', 'archive', 'pack', 'bundle', 'deflate'],

  input: {
    accept: ['*/*'],
    min: 1,
    sizeLimit: 500 * 1024 * 1024,
  },
  output: { mime: 'application/zip' },

  interactive: false,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'low',

  defaults: defaultZipCreateParams,

  async run(
    inputs: File[],
    params: ZipCreateParams,
    ctx: ToolRunContext,
  ): Promise<Blob[]> {
    ctx.onProgress({ stage: 'loading-deps', percent: 0, message: 'Loading JSZip' });
    const JSZip = (await import('jszip')).default;

    if (ctx.signal.aborted) throw new Error('Aborted');

    const zip = new JSZip();
    const compression = params.compression ?? 'DEFLATE';
    const compressionLevel = params.compressionLevel ?? 6;

    ctx.onProgress({ stage: 'processing', percent: 20, message: 'Adding files' });

    for (let i = 0; i < inputs.length; i++) {
      if (ctx.signal.aborted) throw new Error('Aborted');
      const file = inputs[i]!;
      const bytes = new Uint8Array(await file.arrayBuffer());
      zip.file(file.name, bytes, {
        compression,
        compressionOptions: compression === 'DEFLATE' ? { level: compressionLevel } : undefined,
      });
      ctx.onProgress({
        stage: 'processing',
        percent: 20 + Math.floor((i / inputs.length) * 60),
        message: `Adding ${file.name}`,
      });
    }

    ctx.onProgress({ stage: 'encoding', percent: 80, message: 'Generating ZIP' });

    const outputBlob = await zip.generateAsync({
      type: 'blob',
      mimeType: 'application/zip',
    });

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });

    const filename = params.filename ?? 'archive.zip';
    return [new File([outputBlob], filename, { type: 'application/zip' })];
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['application/zip'],
  },
};
