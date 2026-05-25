// packages/core/src/lib/zip-safety.ts
//
// Zip-bomb + filename-traversal defenses shared across the archive tools.
// Production-ready posture: parsers must enforce limits before allocating
// memory or returning untrusted strings to callers.

/** Max number of entries we'll process from a single archive. */
export const MAX_ZIP_ENTRIES = 50_000;

/** Max total uncompressed bytes across all extracted entries.
 *  Set to 4 GB — well above any realistic legitimate use, well below
 *  what a zip bomb produces. */
export const MAX_ZIP_UNCOMPRESSED_BYTES = 4 * 1024 * 1024 * 1024;

export class ZipSafetyError extends Error {
  constructor(public readonly reason: 'too-many-entries' | 'uncompressed-too-large' | 'unsafe-filename', message: string) {
    super(message);
    this.name = 'ZipSafetyError';
  }
}

/** Sanitize a ZIP entry name so it can be used safely as a relative
 *  filename. Strips leading slashes, drops `..` components, normalizes
 *  separators. Returns the sanitized name OR throws if the entry name
 *  is unrecoverable (e.g. only path traversal components).
 *
 *  Callers that want to preserve the directory structure can pass the
 *  sanitized result to `path.join(outputDir, sanitized)`. */
export function sanitizeZipEntryName(rawName: string): string {
  // Normalize separators, then split.
  const normalized = rawName.replace(/\\/g, '/');
  const parts = normalized.split('/').filter((p) => p !== '' && p !== '.');
  const safe: string[] = [];
  for (const part of parts) {
    if (part === '..') {
      safe.pop();                           // resolve traversal against accumulated path
      continue;
    }
    if (part.includes('\0')) continue;      // drop null-byte tricks
    safe.push(part);
  }
  if (safe.length === 0) {
    throw new ZipSafetyError('unsafe-filename', `ZIP entry name is unsafe and has no usable component: "${rawName}"`);
  }
  return safe.join('/');
}

/** Pre-decompress check: walks the zip's directory and sums declared
 *  uncompressed sizes. Fails the entire archive BEFORE any decompression
 *  if the declared total exceeds MAX_ZIP_UNCOMPRESSED_BYTES.
 *
 *  Note: declared sizes are attacker-controlled — a malicious archive
 *  could declare 1 MB and actually emit 5 GB on decompress. So this is
 *  the FAST path. Per-entry streaming budget check (streamingExtract)
 *  is the BELT-AND-SUSPENDERS verification. */
export function assertDeclaredSizeBudget(entries: Array<{ uncompressedSize?: number }>): void {
  let declaredTotal = 0;
  for (const e of entries) {
    declaredTotal += e.uncompressedSize ?? 0;
    if (declaredTotal > MAX_ZIP_UNCOMPRESSED_BYTES) {
      throw new ZipSafetyError(
        'uncompressed-too-large',
        `ZIP declares > ${MAX_ZIP_UNCOMPRESSED_BYTES} bytes total uncompressed (zip-bomb defense).`,
      );
    }
  }
}

/** Enforce zip-level limits before/while extracting. Use as the gate
 *  that drives the extract loop. */
export function assertEntryBudget(processedCount: number, accumulatedBytes: number): void {
  if (processedCount > MAX_ZIP_ENTRIES) {
    throw new ZipSafetyError('too-many-entries', `ZIP has too-many-entries: more than ${MAX_ZIP_ENTRIES} (zip-bomb defense).`);
  }
  if (accumulatedBytes > MAX_ZIP_UNCOMPRESSED_BYTES) {
    throw new ZipSafetyError('uncompressed-too-large', `ZIP uncompressed-too-large: exceeds ${MAX_ZIP_UNCOMPRESSED_BYTES} bytes (zip-bomb defense).`);
  }
}
