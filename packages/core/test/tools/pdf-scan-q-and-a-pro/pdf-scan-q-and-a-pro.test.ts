import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { createDefaultRegistry } from '../../../src/default-registry.js';
import {
  defaultPdfScanQandAProParams,
  pdfScanQandAPro,
  scanNotes,
  selectScanPages,
  SCAN_PDF_MAX_PAGES,
} from '../../../src/tools/pdf-scan-q-and-a-pro/index.js';
import type * as ProRunner from '../../../src/lib/pro-runner.js';
import type { ToolRunContext } from '../../../src/types.js';

async function textOf(out: Blob | Blob[]): Promise<string> {
  if (Array.isArray(out)) throw new Error('expected a single Blob');
  return out.text();
}

function pdfFile(bytes: Uint8Array, name: string): File {
  return new File([new Uint8Array(bytes)], name, { type: 'application/pdf' });
}

const calls = vi.hoisted(() => [] as { toolId: string; input: Record<string, unknown> }[]);
vi.mock('../../../src/lib/pro-runner.js', async (orig) => ({
  ...(await orig<typeof ProRunner>()),
  runPro: (toolId: string, input: Record<string, unknown>) => {
    calls.push({ toolId, input });
    return Promise.resolve({ answer: 'Thirty days.' });
  },
}));

function makeCtx(): ToolRunContext {
  return {
    onProgress: () => {},
    signal: new AbortController().signal,
    cache: new Map(),
    executionId: 'pdf-scan-q-and-a-pro-test',
  };
}

async function blankPdf(pages: number): Promise<File> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([612, 792]);
  return pdfFile(await doc.save(), 'scan.pdf');
}

beforeEach(() => {
  calls.length = 0;
});

describe('pdf-scan-q-and-a-pro metadata', () => {
  it('is registered as a 1-credit PDF tool', () => {
    const tool = createDefaultRegistry().toolsById.get('pdf-scan-q-and-a-pro');
    expect(tool?.cost).toBe('credit');
    expect(tool?.creditCost).toBe(1);
    expect(tool?.input.accept).toEqual(['application/pdf']);
    expect(tool?.description).toMatch(/Uses 1 credit per run\.$/);
    expect(tool?.description).not.toMatch(/[—–]/);
  });
});

describe('selectScanPages', () => {
  it('takes the first pages up to the cap when no spec is given', () => {
    expect(selectScanPages('', 3)).toEqual([1, 2, 3]);
    expect(selectScanPages('  ', 40)).toHaveLength(SCAN_PDF_MAX_PAGES);
  });

  it('parses comma-separated pages and ranges', () => {
    expect(selectScanPages('3, 1-2, 7', 10)).toEqual([1, 2, 3, 7]);
    expect(selectScanPages('5 - 6', 10)).toEqual([5, 6]);
  });

  it('rejects specs over the cap or outside the document', () => {
    expect(() => selectScanPages('1-11', 20)).toThrow(/at most 10 pages/);
    expect(() => selectScanPages('9', 3)).toThrow(/out of range/);
  });
});

describe('scanNotes', () => {
  it('says when only the first pages were read', () => {
    const notes = scanNotes({ sent: [1, 2], numPages: 30, explicit: false, textCharsPerPage: 0 });
    expect(notes[0]).toMatch(/Only pages 1-2 of 30 were read/);
  });

  it('points a PDF with a text layer at Ask a PDF', () => {
    const notes = scanNotes({ sent: [1], numPages: 1, explicit: false, textCharsPerPage: 900 });
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatch(/pdf-q-and-a/);
  });

  it('adds nothing for a short scan read in full', () => {
    expect(scanNotes({ sent: [1], numPages: 1, explicit: false, textCharsPerPage: 0 })).toEqual([]);
  });
});

describe('pdf-scan-q-and-a-pro run()', () => {
  it('sends labelled JPEG page images and the question, not the PDF', async () => {
    const out = await pdfScanQandAPro.run(
      [await blankPdf(2)],
      { question: ' Notice period? ', pages: '' },
      makeCtx(),
    );
    expect(await textOf(out)).toBe('Thirty days.');
    expect(calls).toHaveLength(1);
    const { toolId, input } = calls[0]!;
    expect(toolId).toBe('pdf-scan-q-and-a-pro');
    expect(input.question).toBe('Notice period?');
    const pages = input.pages as { page: number; image: string }[];
    expect(pages.map((p) => p.page)).toEqual([1, 2]);
    for (const p of pages) {
      expect(p.image).toMatch(/^data:image\/jpeg;base64,\/9j\//);
      expect(p.image.length).toBeLessThan(Math.ceil((2 * 1024 * 1024) / 3) * 4);
    }
    expect(Object.keys(input).sort()).toEqual(['fileName', 'pages', 'question']);
  });

  it('caps a long PDF at 10 pages and says so', async () => {
    const out = await pdfScanQandAPro.run(
      [await blankPdf(12)],
      { question: 'q', pages: '' },
      makeCtx(),
    );
    const pages = calls[0]!.input.pages as unknown[];
    expect(pages).toHaveLength(SCAN_PDF_MAX_PAGES);
    expect(await textOf(out)).toMatch(/Note: Only pages 1-10 of 12 were read/);
  });

  it('sends only the pages picked', async () => {
    await pdfScanQandAPro.run([await blankPdf(12)], { question: 'q', pages: '11-12' }, makeCtx());
    const pages = calls[0]!.input.pages as { page: number }[];
    expect(pages.map((p) => p.page)).toEqual([11, 12]);
  });

  it('suggests Ask a PDF when the pages have selectable text', async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const p = doc.addPage([612, 792]);
    for (let line = 0; line < 8; line++) {
      p.drawText('The tenant gives thirty days written notice to end this lease.', {
        x: 40,
        y: 740 - line * 20,
        size: 11,
        font,
      });
    }
    const file = pdfFile(await doc.save(), 'text.pdf');
    const out = await pdfScanQandAPro.run([file], { question: 'q', pages: '' }, makeCtx());
    const text = await textOf(out);
    expect(text.startsWith('Thirty days.')).toBe(true);
    expect(text).toMatch(/Note: This PDF has selectable text/);
  });
  it('rejects an empty question before any network call', async () => {
    await expect(
      pdfScanQandAPro.run([await blankPdf(1)], defaultPdfScanQandAProParams, makeCtx()),
    ).rejects.toThrow('Enter a question');
    expect(calls).toHaveLength(0);
  });
});
