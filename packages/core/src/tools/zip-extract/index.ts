import type { ToolModule, ToolRunContext } from '../../types.js';
import { sanitizeZipEntryName, assertEntryBudget, assertDeclaredSizeBudget, MAX_ZIP_ENTRIES, MAX_ZIP_UNCOMPRESSED_BYTES, ZipSafetyError } from '../../lib/zip-safety.js';

// JSZip's internalStream is a runtime method not exposed in the public TypeScript
// types. We cast through unknown to access it; the JSZipStreamHelper shape is
// public and documented in JSZip's type definitions.
type JSZipStreamHelper = JSZip.JSZipStreamHelper<Uint8Array>;
import type JSZip from 'jszip';

/** Decompress a JSZip entry via the streaming API so we can enforce a
 *  per-entry byte budget mid-flight rather than loading the entire
 *  decompressed content into memory first (belt-and-suspenders vs the
 *  pre-flight declared-size check). */
async function streamingExtract(
  entry: { internalStream: (type: string) => JSZipStreamHelper },
  maxBytes: number,
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let total = 0;
    const stream = entry.internalStream('uint8array');
    stream.on('data', (chunk: Uint8Array) => {
      total += chunk.byteLength;
      if (total > maxBytes) {
        reject(new ZipSafetyError('uncompressed-too-large', `ZIP entry exceeds ${maxBytes} bytes during decompression (zip-bomb defense).`));
        return;
      }
      chunks.push(chunk);
    });
    stream.on('error', (err: Error) => reject(err));
    stream.on('end', () => {
      const merged = new Uint8Array(total);
      let off = 0;
      for (const c of chunks) { merged.set(c, off); off += c.byteLength; }
      resolve(merged);
    });
    stream.resume();
  });
}

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

export const zipExtract: ToolModule<ZipExtractParams> = {
  id: 'zip-extract',
  slug: 'zip-extract',
  name: 'Extract ZIP',
  description: 'Extract files from a ZIP archive. Optional glob filter to extract only matching files.',
  category: 'archive',
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

    if (Object.keys(zip.files).length > MAX_ZIP_ENTRIES) {
      throw new ZipSafetyError('too-many-entries', `ZIP has too-many-entries: ${Object.keys(zip.files).length} exceeds ${MAX_ZIP_ENTRIES} limit (zip-bomb defense).`);
    }

    const entries = Object.values(zip.files).filter(
      (f) => !f.dir && shouldInclude(f.name, params.filter),
    );

    if (entries.length === 0) {
      throw new Error('No files found in the archive matching the filter.');
    }

    // Pre-flight: sum declared uncompressed sizes from the ZIP directory before
    // decompressing anything. JSZip stores this on the private _data property
    // (documented in the type definitions' commented-out CompressedObject).
    assertDeclaredSizeBudget(entries.map((e) => ({
      uncompressedSize: (e as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0,
    })));

    let accumulated = 0;
    const blobs: Blob[] = [];
    for (let i = 0; i < entries.length; i++) {
      if (ctx.signal.aborted) throw new Error('Aborted');
      const entry = entries[i]!;
      const safeName = sanitizeZipEntryName(entry.name);
      ctx.onProgress({
        stage: 'processing',
        percent: 20 + Math.floor((i / entries.length) * 70),
        message: `Extracting ${safeName}`,
      });
      // Use streaming extraction so the per-entry budget check fires mid-stream
      // (belt-and-suspenders against archives that lie about declared sizes).
      const remainingBudget = MAX_ZIP_UNCOMPRESSED_BYTES - accumulated;
      const content = await streamingExtract(
        entry as unknown as { internalStream: (type: string) => JSZipStreamHelper },
        remainingBudget,
      );
      accumulated += content.byteLength;
      assertEntryBudget(i + 1, accumulated);
      blobs.push(new File([content.buffer as ArrayBuffer], safeName, { type: 'application/octet-stream' }));
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
