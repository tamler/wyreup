import type { ToolModule, ToolRunContext } from '../../types.js';

export interface PdfMetadataWriteFields {
  title?: string;
  author?: string;
  subject?: string;
  keywords?: string[];
  creator?: string;
  producer?: string;
}

export interface PdfMetadataParams {
  /** 'read' returns JSON metadata, 'write' updates metadata, 'strip' removes all metadata. */
  mode: 'read' | 'write' | 'strip';
  /** For 'write' mode: metadata fields to set. */
  metadata?: PdfMetadataWriteFields;
}

const PdfMetadataComponentStub = (): unknown => null;

export const pdfMetadata: ToolModule<PdfMetadataParams> = {
  id: 'pdf-metadata',
  slug: 'pdf-metadata',
  name: 'PDF Metadata',
  description: 'Read, write, or strip metadata (title, author, keywords, etc.) from a PDF.',
  category: 'edit',
  presence: 'both',
  keywords: ['pdf', 'metadata', 'title', 'author', 'keywords', 'strip'],

  input: {
    accept: ['application/pdf'],
    min: 1,
    max: 1,
    sizeLimit: 500 * 1024 * 1024,
  },
  output: {
    // Primary output is application/pdf for write/strip modes.
    // In read mode the tool returns application/json.
    mime: 'application/pdf',
  },

  interactive: false,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'low',

  defaults: {
    mode: 'read',
  },

  paramSchema: {
    mode: {
      type: 'enum',
      label: 'mode',
      options: [
        { value: 'read', label: 'read (extract metadata as JSON)' },
        { value: 'write', label: 'write (set title/author/etc.)' },
        { value: 'strip', label: 'strip (remove all metadata)' },
      ],
    },
  },

  Component: PdfMetadataComponentStub,

  async run(
    inputs: File[],
    params: PdfMetadataParams,
    ctx: ToolRunContext,
  ): Promise<Blob> {
    if (ctx.signal.aborted) throw new Error('Aborted');

    const { mode, metadata } = params;

    if (!mode) {
      throw new Error('mode is required (read | write | strip).');
    }

    const { PDFDocument } = await import('pdf-lib');

    ctx.onProgress({ stage: 'processing', percent: 10, message: 'Loading PDF' });
    const buffer = await inputs[0]!.arrayBuffer();
    const pdfDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });

    if (ctx.signal.aborted) throw new Error('Aborted');

    if (mode === 'read') {
      const keywords = pdfDoc.getKeywords();
      const result = {
        title: pdfDoc.getTitle() ?? null,
        author: pdfDoc.getAuthor() ?? null,
        subject: pdfDoc.getSubject() ?? null,
        keywords: keywords ? keywords.split(',').map((k) => k.trim()).filter(Boolean) : [],
        creator: pdfDoc.getCreator() ?? null,
        producer: pdfDoc.getProducer() ?? null,
      };
      ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
      return new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
    }

    if (mode === 'write') {
      if (!metadata) {
        throw new Error('metadata is required when mode is "write".');
      }
      if (metadata.title !== undefined) pdfDoc.setTitle(metadata.title);
      if (metadata.author !== undefined) pdfDoc.setAuthor(metadata.author);
      if (metadata.subject !== undefined) pdfDoc.setSubject(metadata.subject);
      if (metadata.keywords !== undefined) pdfDoc.setKeywords(metadata.keywords);
      if (metadata.creator !== undefined) pdfDoc.setCreator(metadata.creator);
      if (metadata.producer !== undefined) pdfDoc.setProducer(metadata.producer);
    } else if (mode === 'strip') {
      pdfDoc.setTitle('');
      pdfDoc.setAuthor('');
      pdfDoc.setSubject('');
      pdfDoc.setKeywords([]);
      pdfDoc.setCreator('');
      pdfDoc.setProducer('');
    } else {
      throw new Error(`Unknown mode "${mode as string}". Expected read, write, or strip.`);
    }

    ctx.onProgress({ stage: 'encoding', percent: 90, message: 'Saving PDF' });
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
