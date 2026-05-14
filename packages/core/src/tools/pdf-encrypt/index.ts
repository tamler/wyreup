import type { ToolModule, ToolRunContext } from '../../types.js';

export interface PdfEncryptPermissions {
  printing?: 'none' | 'lowResolution' | 'highResolution';
  modifying?: boolean;
  copying?: boolean;
  annotating?: boolean;
  fillingForms?: boolean;
  contentAccessibility?: boolean;
  documentAssembly?: boolean;
}

export interface PdfEncryptParams {
  /** User password (required to open the PDF). */
  userPassword: string;
  /** Owner password (required to change permissions). Defaults to userPassword. */
  ownerPassword?: string;
  /** Permission flags. */
  permissions?: PdfEncryptPermissions;
}

export const pdfEncrypt: ToolModule<PdfEncryptParams> = {
  id: 'pdf-encrypt',
  slug: 'pdf-encrypt',
  name: 'Encrypt PDF',
  description: 'Password-protect a PDF with optional permission restrictions.',
  category: 'optimize',
  keywords: ['pdf', 'encrypt', 'password', 'protect', 'security'],

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
    userPassword: '',
  },

  async run(
    inputs: File[],
    params: PdfEncryptParams,
    ctx: ToolRunContext,
  ): Promise<Blob> {
    if (ctx.signal.aborted) throw new Error('Aborted');

    const { userPassword, ownerPassword, permissions } = params;

    if (!userPassword || userPassword.trim() === '') {
      throw new Error('userPassword is required and must not be empty.');
    }

    ctx.onProgress({ stage: 'processing', percent: 10, message: 'Loading PDF' });

    // Use @cantoo/pdf-lib for encryption support
    const { PDFDocument } = await import('@cantoo/pdf-lib');

    const buffer = await inputs[0]!.arrayBuffer();
    const pdfDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });

    if (ctx.signal.aborted) throw new Error('Aborted');

    ctx.onProgress({ stage: 'processing', percent: 50, message: 'Encrypting PDF' });

    // Map our permission spec to @cantoo/pdf-lib's SecurityOptions
    let cantooPermissions: Record<string, unknown> | undefined;
    if (permissions) {
      cantooPermissions = {};
      if (permissions.printing !== undefined) {
        if (permissions.printing === 'none') {
          cantooPermissions.printing = false;
        } else {
          cantooPermissions.printing = permissions.printing;
        }
      }
      if (permissions.modifying !== undefined) cantooPermissions.modifying = permissions.modifying;
      if (permissions.copying !== undefined) cantooPermissions.copying = permissions.copying;
      if (permissions.annotating !== undefined) cantooPermissions.annotating = permissions.annotating;
      if (permissions.fillingForms !== undefined) cantooPermissions.fillingForms = permissions.fillingForms;
      if (permissions.contentAccessibility !== undefined) cantooPermissions.contentAccessibility = permissions.contentAccessibility;
      if (permissions.documentAssembly !== undefined) cantooPermissions.documentAssembly = permissions.documentAssembly;
    }

    pdfDoc.encrypt({
      userPassword,
      ownerPassword: ownerPassword ?? userPassword,
      permissions: cantooPermissions as Parameters<typeof pdfDoc.encrypt>[0]['permissions'],
    });

    ctx.onProgress({ stage: 'encoding', percent: 90, message: 'Saving encrypted PDF' });
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
