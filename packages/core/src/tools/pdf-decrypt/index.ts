import type { ToolModule, ToolRunContext } from '../../types.js';

export interface PdfDecryptParams {
  /** The password that unlocks the PDF. Required. */
  password: string;
}

const PdfDecryptComponentStub = (): unknown => null;

export const pdfDecrypt: ToolModule<PdfDecryptParams> = {
  id: 'pdf-decrypt',
  slug: 'pdf-decrypt',
  name: 'Decrypt PDF',
  description: 'Remove password protection from a PDF.',
  category: 'optimize',
  presence: 'both',
  keywords: ['pdf', 'decrypt', 'password', 'unlock', 'security'],

  input: {
    accept: ['application/pdf'],
    min: 1,
    max: 1,
    sizeLimit: 500 * 1024 * 1024,
  },
  output: {
    mime: 'application/pdf',
  },

  interactive: false,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'low',

  defaults: {
    password: '',
  },

  Component: PdfDecryptComponentStub,

  async run(
    inputs: File[],
    params: PdfDecryptParams,
    ctx: ToolRunContext,
  ): Promise<Blob> {
    if (ctx.signal.aborted) throw new Error('Aborted');

    const { password } = params;

    if (!password || password.trim() === '') {
      throw new Error('password is required and must not be empty.');
    }

    ctx.onProgress({ stage: 'processing', percent: 10, message: 'Loading PDF' });

    // Use @cantoo/pdf-lib which has decryption support
    const { PDFDocument } = await import('@cantoo/pdf-lib');

    const buffer = await inputs[0]!.arrayBuffer();

    let pdfDoc;
    try {
      pdfDoc = await PDFDocument.load(buffer, { password });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      // pdf-lib throws various messages for wrong passwords
      if (
        msg.includes('password') ||
        msg.includes('Password') ||
        msg.includes('encrypted') ||
        msg.includes('Encrypted') ||
        msg.includes('EncryptedPDFError') ||
        msg.includes('Failed')
      ) {
        throw new Error('Incorrect password');
      }
      throw err;
    }

    if (ctx.signal.aborted) throw new Error('Aborted');

    ctx.onProgress({ stage: 'encoding', percent: 90, message: 'Saving decrypted PDF' });
    const bytes = await pdfDoc.save();

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return new Blob([bytes.buffer as ArrayBuffer], { type: 'application/pdf' });
  },

  __testFixtures: {
    valid: ['doc-a.pdf'],
    weird: [],
    expectedOutputMime: ['application/pdf'],
  },
};
