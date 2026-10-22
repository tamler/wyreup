export const FATAL_TEXT_IMPORT_IDS = [
  'word-counter',
  'json-formatter',
  'json-path',
  'markdown-to-html',
  'code-beautifier',
  'remove-duplicate-lines-online',
  'markdown-table-generator',
  'bulk-meta-description-generator',
  'javascript-minifier',
] as const;

const fatalIds = new Set<string>(FATAL_TEXT_IMPORT_IDS);
const MiB = 1024 * 1024;
const limits: Record<string, number> = {
  'word-counter': 50 * MiB,
  'json-formatter': 50 * MiB,
  'json-path': 100 * MiB,
  'markdown-to-html': 10 * MiB,
  'code-beautifier': 5 * MiB,
  'remove-duplicate-lines-online': 5 * MiB,
  'markdown-table-generator': 5 * MiB,
  'bulk-meta-description-generator': 5 * MiB,
  'javascript-minifier': 5 * MiB,
  'number-base-converter': MiB,
  'cron-from-text': 4096,
};

export function textAdmissionRequiresRun(id: string): boolean {
  return fatalIds.has(id) || id === 'number-base-converter' || id === 'cron-from-text';
}

export async function readImportedText(
  file: File,
  id: string,
  params: Record<string, unknown>,
  declaredLimit?: number,
): Promise<string> {
  const limit = limits[id] ?? declaredLimit;
  if (limit !== undefined && file.size > limit) {
    throw new Error(`Input file exceeds this tool's size limit (${limit.toLocaleString()} bytes).`);
  }
  const preserveBom = id === 'number-base-converter' && params.conversionKind === 'utf8-bytes';
  if (!fatalIds.has(id) && id !== 'cron-from-text' && !preserveBom) return file.text();
  // Known fatal readers have a concrete core-owned ceiling; slice also bounds
  // a File whose supplied size metadata understates its actual byte length.
  if (limit === undefined) throw new Error('Text import byte limit unavailable.');
  const bytes = await file.slice(0, limit + 1).arrayBuffer();
  if (bytes.byteLength > limit)
    throw new Error(`Input file exceeds this tool's size limit (${limit.toLocaleString()} bytes).`);
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: preserveBom }).decode(bytes);
  } catch {
    throw new Error('Input file must contain valid UTF-8 text.');
  }
  return id === 'cron-from-text' ? text.trim() : text;
}
