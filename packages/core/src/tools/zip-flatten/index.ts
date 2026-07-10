import type { ToolModule, ToolRunContext } from '../../types.js';
import type JSZipType from 'jszip';
import type { JSZipObject } from 'jszip';
import {
  sanitizeZipEntryName,
  assertEntryBudget,
  assertDeclaredSizeBudget,
  MAX_ZIP_ENTRIES,
  MAX_ZIP_UNCOMPRESSED_BYTES,
  ZipSafetyError,
} from '../../lib/zip-safety.js';

// JSZip's internalStream is a runtime method not exposed in the public TypeScript
// types. We cast through unknown to access it; the JSZipStreamHelper shape is
// public and documented in JSZip's type definitions.
type JSZipStreamHelper = JSZipType.JSZipStreamHelper<Uint8Array>;

/** Decompress a JSZip entry via the streaming API so we can enforce a
 *  per-entry byte budget mid-flight rather than loading the entire
 *  decompressed content into memory first (belt-and-suspenders vs the
 *  pre-flight declared-size check). */
async function streamingExtractFlatten(
  entry: { internalStream: (type: string) => JSZipStreamHelper },
  maxBytes: number,
): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let total = 0;
    const stream = entry.internalStream('uint8array');
    stream.on('data', (chunk: Uint8Array) => {
      total += chunk.byteLength;
      if (total > maxBytes) {
        reject(
          new ZipSafetyError(
            'uncompressed-too-large',
            `ZIP entry exceeds ${maxBytes} bytes during decompression (zip-bomb defense).`,
          ),
        );
        return;
      }
      chunks.push(chunk);
    });
    stream.on('error', (err: Error) => reject(err));
    stream.on('end', () => {
      const merged = new Uint8Array(total);
      let off = 0;
      for (const c of chunks) {
        merged.set(c, off);
        off += c.byteLength;
      }
      resolve(merged.buffer);
    });
    stream.resume();
  });
}

export interface ZipFlattenParams {
  /** How to handle name collisions when two files in different folders share a basename. */
  onCollision?: 'rename' | 'skip' | 'overwrite';
}

export const defaultZipFlattenParams: ZipFlattenParams = {
  onCollision: 'rename',
};

export const zipFlatten: ToolModule<ZipFlattenParams> = {
  id: 'zip-flatten',
  slug: 'zip-flatten',
  name: 'Flatten ZIP',
  description:
    'Collapse all files in a ZIP archive to the top level — strips every directory layer. Useful when an export gave you `vendor/long/path/file.txt` and you just want `file.txt`. Configurable collision handling. Runs in your browser.',
  category: 'archive',
  keywords: ['zip', 'flatten', 'directories', 'folders', 'collapse', 'rename', 'archive'],

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

  chainSuggestions: ['zip-info', 'zip-extract', 'zip-remove'],

  defaults: defaultZipFlattenParams,
  paramSchema: {
    onCollision: {
      type: 'enum',
      label: 'when names collide',
      help: 'Two files might share a basename across folders. Choose what happens then.',
      options: [
        { value: 'rename', label: 'rename (file.txt, file-2.txt, …)' },
        { value: 'skip', label: 'skip subsequent collisions (keep first)' },
        { value: 'overwrite', label: 'overwrite (keep last)' },
      ],
    },
  },

  async run(inputs: File[], params: ZipFlattenParams, ctx: ToolRunContext): Promise<Blob> {
    if (inputs.length !== 1) throw new Error('zip-flatten accepts exactly one ZIP file.');
    if (ctx.signal.aborted) throw new Error('Aborted');

    const onCollision = params.onCollision ?? 'rename';

    ctx.onProgress({ stage: 'loading-deps', percent: 0, message: 'Loading JSZip' });
    const JSZip = (await import('jszip')).default;
    if (ctx.signal.aborted) throw new Error('Aborted');

    const bytes = await inputs[0]!.arrayBuffer();
    ctx.onProgress({ stage: 'processing', percent: 30, message: 'Reading archive' });
    const src = await JSZip.loadAsync(bytes);
    const dst = new JSZip();

    if (Object.keys(src.files).length > MAX_ZIP_ENTRIES) {
      throw new ZipSafetyError(
        'too-many-entries',
        `ZIP has too-many-entries: ${Object.keys(src.files).length} exceeds ${MAX_ZIP_ENTRIES} limit (zip-bomb defense).`,
      );
    }

    if (ctx.signal.aborted) throw new Error('Aborted');
    ctx.onProgress({ stage: 'processing', percent: 50, message: 'Flattening entries' });

    // Pull all non-directory entries out, in path order, and rewrite to root.
    const entries: Array<{ path: string; file: JSZipObject }> = [];
    src.forEach((path, file) => {
      if (!file.dir) entries.push({ path, file });
    });

    // Pre-flight: sum declared uncompressed sizes from the ZIP directory before
    // decompressing anything. JSZip stores this on the private _data property
    // (documented in the type definitions' commented-out CompressedObject).
    assertDeclaredSizeBudget(
      entries.map(({ file }) => ({
        uncompressedSize:
          (file as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ??
          0,
      })),
    );

    let accumulated = 0;
    const used = new Set<string>();
    for (let idx = 0; idx < entries.length; idx++) {
      const { path, file } = entries[idx]!;
      if (ctx.signal.aborted) throw new Error('Aborted');
      // Sanitize the entry path before extracting.
      let safePath: string;
      try {
        safePath = sanitizeZipEntryName(path);
      } catch {
        continue; // skip unrecoverable entries
      }
      const base = safePath.split('/').pop() || safePath;
      let target = base;

      if (used.has(target)) {
        if (onCollision === 'skip') continue;
        if (onCollision === 'overwrite') {
          // fall through; JSZip.file() overwrites existing entries
        } else {
          target = uniqueName(base, used);
        }
      }
      used.add(target);

      // Use streaming extraction so the per-entry budget check fires mid-stream
      // (belt-and-suspenders against archives that lie about declared sizes).
      const remainingBudget = MAX_ZIP_UNCOMPRESSED_BYTES - accumulated;
      const content = await streamingExtractFlatten(
        file as unknown as { internalStream: (type: string) => JSZipStreamHelper },
        remainingBudget,
      );
      accumulated += content.byteLength;
      assertEntryBudget(idx + 1, accumulated);
      dst.file(target, content);
    }

    if (ctx.signal.aborted) throw new Error('Aborted');
    ctx.onProgress({ stage: 'encoding', percent: 80, message: 'Writing archive' });

    const out = await dst.generateAsync(
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

function uniqueName(base: string, used: Set<string>): string {
  const dot = base.lastIndexOf('.');
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const ext = dot > 0 ? base.slice(dot) : '';
  for (let n = 2; n < 10_000; n++) {
    const candidate = `${stem}-${n}${ext}`;
    if (!used.has(candidate)) return candidate;
  }
  // Practically unreachable; fall back to a timestamped name.
  return `${stem}-${Date.now()}${ext}`;
}
