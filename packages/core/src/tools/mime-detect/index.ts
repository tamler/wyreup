import type { ToolModule, ToolRunContext } from '../../types.js';

export interface MimeDetectParams {
  /** Bytes to read from the start of the file. The signature table is short — 4 KB is plenty. */
  sniffBytes?: number;
}

export const defaultMimeDetectParams: MimeDetectParams = {
  sniffBytes: 4096,
};

export interface MimeDetectResult {
  name: string;
  size: number;
  /** What the browser/OS declared via `File.type`, if anything. */
  declaredMime: string;
  /** What the magic-bytes sniff actually says. */
  detectedMime: string;
  /** Suggested file extension based on the detection. */
  extension: string;
  /** Human-readable reasoning (the signature name that matched). */
  signature: string;
  /** True iff declaredMime is non-empty and disagrees with detectedMime. */
  mismatch: boolean;
}

interface Signature {
  /** Human label that surfaces in the result. */
  name: string;
  mime: string;
  ext: string;
  /** Match function — receives the head buffer and decides. */
  match: (head: Uint8Array) => boolean;
}

function startsWithBytes(head: Uint8Array, offset: number, bytes: number[]): boolean {
  if (head.length < offset + bytes.length) return false;
  for (let i = 0; i < bytes.length; i++) {
    if (head[offset + i] !== bytes[i]) return false;
  }
  return true;
}

function asciiAt(head: Uint8Array, offset: number, text: string): boolean {
  if (head.length < offset + text.length) return false;
  for (let i = 0; i < text.length; i++) {
    if (head[offset + i] !== text.charCodeAt(i)) return false;
  }
  return true;
}

// Ordered: more specific signatures first. The first match wins.
const SIGNATURES: ReadonlyArray<Signature> = [
  // Images
  { name: 'PNG', mime: 'image/png', ext: 'png', match: (h) => startsWithBytes(h, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
  { name: 'JPEG', mime: 'image/jpeg', ext: 'jpg', match: (h) => startsWithBytes(h, 0, [0xff, 0xd8, 0xff]) },
  { name: 'GIF87a', mime: 'image/gif', ext: 'gif', match: (h) => asciiAt(h, 0, 'GIF87a') },
  { name: 'GIF89a', mime: 'image/gif', ext: 'gif', match: (h) => asciiAt(h, 0, 'GIF89a') },
  { name: 'BMP', mime: 'image/bmp', ext: 'bmp', match: (h) => startsWithBytes(h, 0, [0x42, 0x4d]) },
  { name: 'TIFF (little-endian)', mime: 'image/tiff', ext: 'tif', match: (h) => startsWithBytes(h, 0, [0x49, 0x49, 0x2a, 0x00]) },
  { name: 'TIFF (big-endian)', mime: 'image/tiff', ext: 'tif', match: (h) => startsWithBytes(h, 0, [0x4d, 0x4d, 0x00, 0x2a]) },
  { name: 'WebP', mime: 'image/webp', ext: 'webp', match: (h) => asciiAt(h, 0, 'RIFF') && asciiAt(h, 8, 'WEBP') },
  { name: 'AVIF', mime: 'image/avif', ext: 'avif', match: (h) => asciiAt(h, 4, 'ftypavif') || asciiAt(h, 4, 'ftypavis') },
  { name: 'HEIC', mime: 'image/heic', ext: 'heic', match: (h) => asciiAt(h, 4, 'ftypheic') || asciiAt(h, 4, 'ftypheix') || asciiAt(h, 4, 'ftyphevc') || asciiAt(h, 4, 'ftypmif1') },
  { name: 'ICO', mime: 'image/x-icon', ext: 'ico', match: (h) => startsWithBytes(h, 0, [0x00, 0x00, 0x01, 0x00]) },

  // Documents
  { name: 'PDF', mime: 'application/pdf', ext: 'pdf', match: (h) => asciiAt(h, 0, '%PDF-') },
  { name: 'RTF', mime: 'application/rtf', ext: 'rtf', match: (h) => asciiAt(h, 0, '{\\rtf') },
  { name: 'PostScript', mime: 'application/postscript', ext: 'ps', match: (h) => asciiAt(h, 0, '%!PS') },
  { name: 'EPUB', mime: 'application/epub+zip', ext: 'epub', match: (h) => asciiAt(h, 0, 'PK') && asciiAt(h, 30, 'mimetypeapplication/epub+zip') },

  // Archives / containers
  { name: 'ZIP', mime: 'application/zip', ext: 'zip', match: (h) => asciiAt(h, 0, 'PK') || asciiAt(h, 0, 'PK') || asciiAt(h, 0, 'PK') },
  { name: 'GZIP', mime: 'application/gzip', ext: 'gz', match: (h) => startsWithBytes(h, 0, [0x1f, 0x8b]) },
  { name: 'TAR', mime: 'application/x-tar', ext: 'tar', match: (h) => asciiAt(h, 257, 'ustar') },
  { name: '7z', mime: 'application/x-7z-compressed', ext: '7z', match: (h) => startsWithBytes(h, 0, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]) },
  { name: 'RAR (v1.5+)', mime: 'application/vnd.rar', ext: 'rar', match: (h) => startsWithBytes(h, 0, [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07]) },
  { name: 'XZ', mime: 'application/x-xz', ext: 'xz', match: (h) => startsWithBytes(h, 0, [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00]) },
  { name: 'BZIP2', mime: 'application/x-bzip2', ext: 'bz2', match: (h) => asciiAt(h, 0, 'BZh') },

  // Audio
  { name: 'MP3 (ID3)', mime: 'audio/mpeg', ext: 'mp3', match: (h) => asciiAt(h, 0, 'ID3') },
  { name: 'MP3 (frame sync)', mime: 'audio/mpeg', ext: 'mp3', match: (h) => h[0] === 0xff && (h[1]! & 0xe0) === 0xe0 },
  { name: 'FLAC', mime: 'audio/flac', ext: 'flac', match: (h) => asciiAt(h, 0, 'fLaC') },
  { name: 'OGG', mime: 'audio/ogg', ext: 'ogg', match: (h) => asciiAt(h, 0, 'OggS') },
  { name: 'WAV', mime: 'audio/wav', ext: 'wav', match: (h) => asciiAt(h, 0, 'RIFF') && asciiAt(h, 8, 'WAVE') },
  { name: 'AIFF', mime: 'audio/aiff', ext: 'aiff', match: (h) => asciiAt(h, 0, 'FORM') && asciiAt(h, 8, 'AIFF') },
  { name: 'M4A', mime: 'audio/mp4', ext: 'm4a', match: (h) => asciiAt(h, 4, 'ftypM4A ') },

  // Video
  { name: 'MP4', mime: 'video/mp4', ext: 'mp4', match: (h) => asciiAt(h, 4, 'ftypmp4') || asciiAt(h, 4, 'ftypisom') || asciiAt(h, 4, 'ftypiso2') || asciiAt(h, 4, 'ftypdash') },
  { name: 'QuickTime', mime: 'video/quicktime', ext: 'mov', match: (h) => asciiAt(h, 4, 'ftypqt') || asciiAt(h, 4, 'moov') },
  { name: 'WebM/Matroska', mime: 'video/webm', ext: 'webm', match: (h) => startsWithBytes(h, 0, [0x1a, 0x45, 0xdf, 0xa3]) },
  { name: 'AVI', mime: 'video/x-msvideo', ext: 'avi', match: (h) => asciiAt(h, 0, 'RIFF') && asciiAt(h, 8, 'AVI ') },

  // Fonts
  { name: 'WOFF', mime: 'font/woff', ext: 'woff', match: (h) => asciiAt(h, 0, 'wOFF') },
  { name: 'WOFF2', mime: 'font/woff2', ext: 'woff2', match: (h) => asciiAt(h, 0, 'wOF2') },
  { name: 'TTF', mime: 'font/ttf', ext: 'ttf', match: (h) => startsWithBytes(h, 0, [0x00, 0x01, 0x00, 0x00]) },
  { name: 'OTF', mime: 'font/otf', ext: 'otf', match: (h) => asciiAt(h, 0, 'OTTO') },

  // Text-y formats (sniffed enough to be useful — JSON is the only one
  // that's reliable from the head)
  { name: 'XML', mime: 'application/xml', ext: 'xml', match: (h) => asciiAt(h, 0, '<?xml') },
  { name: 'HTML', mime: 'text/html', ext: 'html', match: (h) => /^\s*<(!doctype html|html|head|body)/i.test(new TextDecoder().decode(h.slice(0, 64))) },
  { name: 'SVG', mime: 'image/svg+xml', ext: 'svg', match: (h) => /^\s*(<\?xml[^>]*\?>\s*)?<svg\b/i.test(new TextDecoder().decode(h.slice(0, 256))) },

  // Executables
  { name: 'Java class', mime: 'application/java-vm', ext: 'class', match: (h) => startsWithBytes(h, 0, [0xca, 0xfe, 0xba, 0xbe]) },
  { name: 'ELF', mime: 'application/x-elf', ext: '', match: (h) => startsWithBytes(h, 0, [0x7f, 0x45, 0x4c, 0x46]) },
  { name: 'Mach-O (64-bit)', mime: 'application/x-mach-binary', ext: '', match: (h) => startsWithBytes(h, 0, [0xcf, 0xfa, 0xed, 0xfe]) || startsWithBytes(h, 0, [0xfe, 0xed, 0xfa, 0xcf]) },
  { name: 'PE/COFF (Windows)', mime: 'application/vnd.microsoft.portable-executable', ext: 'exe', match: (h) => asciiAt(h, 0, 'MZ') },
  { name: 'WebAssembly', mime: 'application/wasm', ext: 'wasm', match: (h) => startsWithBytes(h, 0, [0x00, 0x61, 0x73, 0x6d]) },
];

export function detectMime(head: Uint8Array): { mime: string; ext: string; signature: string } {
  for (const sig of SIGNATURES) {
    if (sig.match(head)) return { mime: sig.mime, ext: sig.ext, signature: sig.name };
  }
  // Last-resort JSON probe — JSON has no magic bytes, so this is the only
  // text format we'll try parsing.
  if (head.length > 0) {
    const ch = head[0];
    if (ch === 0x7b /* { */ || ch === 0x5b /* [ */) {
      try {
        // Parse only the head — if it's well-formed JSON in the head, call it.
        // The head may be truncated; we don't require the entire file to parse.
        // A short, valid JSON object will succeed; anything bigger throws.
        JSON.parse(new TextDecoder().decode(head));
        return { mime: 'application/json', ext: 'json', signature: 'JSON (full head parsed)' };
      } catch {
        // Not full-head parseable — could still be JSON, but we can't say for sure.
      }
    }
  }
  return { mime: 'application/octet-stream', ext: '', signature: 'unrecognized' };
}

export const mimeDetect: ToolModule<MimeDetectParams> = {
  id: 'mime-detect',
  slug: 'mime-detect',
  name: 'MIME Detect',
  description:
    'Identify a file by its magic bytes — independent of file extension or the browser-reported type. Useful for verifying uploads and spotting mislabeled files.',
  category: 'inspect',
  keywords: ['mime', 'detect', 'magic', 'signature', 'file-type', 'sniff', 'identify', 'verify'],

  input: {
    accept: ['*/*'],
    min: 1,
    max: 1,
    sizeLimit: 500 * 1024 * 1024,
  },
  output: { mime: 'application/json' },

  interactive: false,
  batchable: true,
  cost: 'free',
  memoryEstimate: 'low',

  defaults: defaultMimeDetectParams,

  paramSchema: {
    sniffBytes: {
      type: 'number',
      label: 'sniff bytes',
      help: 'How many bytes from the file head to inspect. The signature table needs at most ~512.',
      min: 64,
      max: 65536,
      step: 64,
    },
  },

  async run(inputs: File[], params: MimeDetectParams, ctx: ToolRunContext): Promise<Blob[]> {
    if (inputs.length !== 1) throw new Error('mime-detect accepts exactly one file.');
    const file = inputs[0]!;
    const sniffBytes = Math.max(64, Math.min(65536, params.sniffBytes ?? 4096));

    ctx.onProgress({ stage: 'processing', percent: 30, message: 'Reading file head' });
    const head = new Uint8Array(await file.slice(0, sniffBytes).arrayBuffer());
    if (ctx.signal.aborted) throw new Error('Aborted');

    ctx.onProgress({ stage: 'processing', percent: 70, message: 'Matching signature' });
    const { mime, ext, signature } = detectMime(head);

    const declared = file.type || '';
    const result: MimeDetectResult = {
      name: file.name,
      size: file.size,
      declaredMime: declared,
      detectedMime: mime,
      extension: ext,
      signature,
      mismatch: declared !== '' && declared !== mime,
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
