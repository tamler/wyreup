import type { Env } from '../env';
import { withTimeout } from '../timeout';

export type MarkdownDocumentKind = 'pdf' | 'docx' | 'html';

const FORMATS: Record<MarkdownDocumentKind, { name: string; mime: string }> = {
  pdf: { name: 'document.pdf', mime: 'application/pdf' },
  docx: {
    name: 'document.docx',
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  },
  html: { name: 'document.html', mime: 'text/html' },
};

const MAX_RESULT_BYTES = 1024 * 1024;
const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

export class MarkdownConversionError extends Error {
  constructor(readonly code: 'unavailable' | 'conversion_failed' | 'no_extractable_text') {
    super(code);
    this.name = 'MarkdownConversionError';
  }
}

/** The caller must validate the bytes before admission and keep the cost gate closed until verified. */
export async function convertDocumentToMarkdown(
  env: Env,
  kind: MarkdownDocumentKind,
  bytes: Uint8Array,
): Promise<{ markdown: string }> {
  if (!Object.prototype.hasOwnProperty.call(FORMATS, kind) || !(bytes instanceof Uint8Array) ||
      bytes.length === 0 || bytes.length > MAX_DOCUMENT_BYTES) {
    throw new MarkdownConversionError('conversion_failed');
  }
  const convert = env.AI.toMarkdown?.bind(env.AI);
  if (!convert) throw new MarkdownConversionError('unavailable');
  const format = FORMATS[kind];
  // A fixed name avoids sending the original filename or letting an extension select a different converter.
  const blob = new Blob([Uint8Array.from(bytes).buffer], { type: format.mime });
  let result: unknown;
  try {
    result = await withTimeout(
      convert({ name: format.name, blob }, {
        conversionOptions: { output: { format: 'markdown' }, pdf: { metadata: false } },
      }),
      60_000,
      'markdown-conversion',
    );
  } catch {
    throw new MarkdownConversionError('conversion_failed');
  }
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new MarkdownConversionError('conversion_failed');
  }
  const item = result as Record<string, unknown>;
  if (item.format !== 'markdown' || typeof item.data !== 'string') {
    throw new MarkdownConversionError('conversion_failed');
  }
  if (!item.data.trim()) throw new MarkdownConversionError('no_extractable_text');
  if (new TextEncoder().encode(item.data).byteLength > MAX_RESULT_BYTES) {
    throw new MarkdownConversionError('conversion_failed');
  }
  return { markdown: item.data };
}
