import { describe, it, expect } from 'vitest';
import { pdfRedact } from '../../../src/tools/pdf-redact/index.js';
import type { ToolRunContext } from '../../../src/types.js';
import { loadFixture } from '../../lib/load-fixture.js';
import { PDFDocument, StandardFonts, rgb, type PDFRawStream as RawStream } from 'pdf-lib';
import { pdfToText } from '../../../src/tools/pdf-to-text/index.js';
import { pdfCompress } from '../../../src/tools/pdf-compress/index.js';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Synthetic fixture: no customer data or third-party assets.
async function secretFixture() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([300, 300]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText('SECRET123 OUTSIDE456', { x: 20, y: 220, size: 12, font });
  page.drawText('KEEP789', { x: 20, y: 260, size: 12, font });
  page.drawText('CAFÉ', { x: 170, y: 260, size: 12, font });
  doc.setTitle('SECRET123');
  doc.setSubject('SECRET123');
  await doc.attach(new TextEncoder().encode('SECRET123'), 'private.txt', {
    description: 'SECRET123',
    mimeType: 'text/plain',
  });
  const { PDFName, PDFString } = await import('pdf-lib');
  const annotation = doc.context.register(
    doc.context.obj({
      Type: 'Annot',
      Subtype: 'Text',
      Rect: [20, 215, 90, 240],
      Contents: PDFString.of('SECRET123'),
    }),
  );
  page.node.set(PDFName.of('Annots'), doc.context.obj([annotation]));
  // An unused object must not be carried into the fresh document.
  doc.context.register(PDFString.of('SECRET123'));
  const { createCanvas, canvasToBlob } = await import('../../../src/lib/canvas.js');
  const canvas = await createCanvas(40, 40);
  const context = canvas.getContext('2d') as unknown as CanvasRenderingContext2D;
  context.fillStyle = '#ff0000';
  context.fillRect(0, 0, 40, 40);
  const png = await canvasToBlob(canvas, 'image/png');
  const image = await doc.embedPng(await png.arrayBuffer());
  page.drawImage(image, { x: 20, y: 100, width: 80, height: 80 });
  page.drawRectangle({ x: 200, y: 100, width: 40, height: 40, color: rgb(0, 0, 1) });
  return new File([(await doc.save()) as BlobPart], 'synthetic.pdf', { type: 'application/pdf' });
}

const secretBoxes = [
  { page: 1, x: 19, y: 215, width: 69, height: 20 },
  { page: 1, x: 19, y: 99, width: 42, height: 82 },
];

async function assertSecretRemoved(blob: Blob) {
  const file = new File([blob], 'redacted.pdf', { type: 'application/pdf' });
  const extracted = (await pdfToText.run([file], {}, makeCtx())) as Blob;
  const text = await extracted.text();
  expect(text).not.toContain('SECRET123');
  expect(text).toContain('OUTSIDE456');
  expect(text).toContain('KEEP789');
  expect(text).toContain('CAFÉ');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (process.env.WYREUP_REDACT_EVIDENCE_DIR) {
    writeFileSync(
      join(process.env.WYREUP_REDACT_EVIDENCE_DIR, `redacted-${bytes.length}.pdf`),
      bytes,
    );
  }
  expect(new TextDecoder().decode(bytes)).not.toContain('SECRET123');
  const doc = await PDFDocument.load(bytes);
  expect(doc.getTitle()).not.toBe('SECRET123');
  expect(doc.getSubject()).not.toBe('SECRET123');
  const { PDFName, PDFArray, PDFRawStream, decodePDFRawStream } = await import('pdf-lib');
  expect(doc.getPage(0).node.lookupMaybe(PDFName.of('Annots'), PDFArray)?.size() ?? 0).toBe(0);
  let images = 0;
  let lossless = true;
  for (const [, object] of doc.context.enumerateIndirectObjects()) {
    if (
      object instanceof PDFRawStream &&
      object.dict.get(PDFName.of('Subtype'))?.toString() === '/Image'
    ) {
      images++;
      const filter = object.dict.get(PDFName.of('Filter'))?.toString();
      if (filter === '/DCTDecode') lossless = false;
      const pixels =
        filter === '/DCTDecode'
          ? (await (await import('../../../src/lib/codecs.js')).getCodec('jpeg')).decode(
              object.contents.slice(),
            )
          : null;
      const decoded = pixels ? (await pixels).data : decodePDFRawStream(object).decode();
      const width = Number(object.dict.get(PDFName.of('Width'))?.toString());
      const height = Number(object.dict.get(PDFName.of('Height'))?.toString());
      expect(width).toBe(600);
      expect(height).toBe(600);
      const channels = pixels ? 4 : 3;
      if (!pixels) {
        for (const region of [
          [40, 55, 160, 82],
          [185, 140, 330, 168],
        ]) {
          let dark = 0;
          for (let y = region[1]!; y < region[3]!; y++) {
            for (let x = region[0]!; x < region[2]!; x++) {
              if (decoded[(y * width + x) * channels]! < 64) dark++;
            }
          }
          expect(dark, 'uncovered text must remain visibly rendered').toBeGreaterThan(30);
        }
      }
      // Covered half of the red image: every interior pixel is black.
      for (let y = 250; y < 390; y++) {
        for (let x = 45; x < 115; x++) {
          const offset = (y * width + x) * channels;
          // The original image was pure red throughout this region. Lossless
          // export is exactly black. JPEG may ring near edges, so also test
          // its central fill away from compression-block boundaries below.
          if (!pixels) expect([...decoded.slice(offset, offset + 3)]).toEqual([0, 0, 0]);
        }
      }
      const center = (300 * width + 80) * channels;
      const fill = [...decoded.slice(center, center + 3)];
      expect(Math.max(...fill)).toBeLessThan(pixels ? 64 : 1);
      expect(Math.max(...fill) - Math.min(...fill)).toBeLessThan(2);
      // The uncovered image half is still red.
      const outside = (300 * width + 160) * channels;
      expect(decoded[outside]).toBeGreaterThan(pixels ? 128 : 240);
      expect(decoded[outside + 1]).toBeLessThan(12);
      continue;
    }
    const data =
      object instanceof PDFRawStream
        ? decodePDFRawStream(object).decode()
        : new TextEncoder().encode(object.toString());
    expect(new TextDecoder().decode(data)).not.toContain('SECRET123');
  }
  expect(images).toBe(1);
  if (spawnSync('pdftotext', ['-v']).status === 0) {
    const directory = mkdtempSync(join(tmpdir(), 'wyreup-redact-'));
    try {
      const path = join(directory, 'output.pdf');
      writeFileSync(path, bytes);
      const extracted = execFileSync('pdftotext', [path, '-'], { encoding: 'utf8' });
      expect(extracted).not.toContain('SECRET123');
      expect(extracted).toContain('OUTSIDE456');
      expect(extracted).toContain('KEEP789');
      if (lossless && spawnSync('pdftoppm', ['-v']).status === 0) {
        const prefix = join(directory, 'page');
        if (spawnSync('pdftocairo', ['-v']).status === 0) {
          const cairo = spawnSync(
            'pdftocairo',
            ['-scale-to', '600', '-singlefile', '-png', path, `${prefix}-cairo`],
            { encoding: 'utf8' },
          );
          expect(cairo.status, cairo.stderr).toBe(0);
          expect(cairo.stderr).not.toMatch(/Syntax Error|Syntax Warning/);
        }
        execFileSync('pdftoppm', ['-scale-to', '600', '-singlefile', '-png', path, prefix]);
        const codec = await (await import('../../../src/lib/codecs.js')).getCodec('png');
        const rendered = await codec.decode(readFileSync(`${prefix}.png`));
        for (const region of [
          [40, 55, 160, 82],
          [185, 140, 330, 168],
        ]) {
          let dark = 0;
          for (let y = region[1]!; y < region[3]!; y++) {
            for (let x = region[0]!; x < region[2]!; x++) {
              if (rendered.data[(y * rendered.width + x) * 4]! < 64) dark++;
            }
          }
          expect(dark, 'exported PDF must visibly retain uncovered text').toBeGreaterThan(30);
        }
        const appended = await PDFDocument.load(bytes);
        appended.getPage(0).drawText('AFTER', { x: 20, y: 20, size: 12 });
        const appendedPath = join(directory, 'appended.pdf');
        writeFileSync(appendedPath, await appended.save());
        execFileSync('pdftoppm', [
          '-scale-to',
          '600',
          '-singlefile',
          '-png',
          appendedPath,
          `${prefix}-appended`,
        ]);
        const appendedImage = await codec.decode(readFileSync(`${prefix}-appended.png`));
        let appendedInk = 0;
        for (let y = 540; y < 565; y++) {
          for (let x = 40; x < 130; x++) {
            if (appendedImage.data[(y * appendedImage.width + x) * 4]! < 64) appendedInk++;
          }
        }
        expect(appendedInk, 'later tools must be able to add visible text').toBeGreaterThan(30);
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }
}

function makeCtx(): ToolRunContext {
  return {
    onProgress: () => {},
    signal: new AbortController().signal,
    cache: new Map(),
    executionId: 'test',
  };
}

describe('pdf-redact — metadata', () => {
  it('has correct id and category', () => {
    expect(pdfRedact.id).toBe('pdf-redact');
    expect(pdfRedact.category).toBe('edit');
  });

  it('output mime is application/pdf', () => {
    expect(pdfRedact.output.mime).toBe('application/pdf');
  });

  it('description promises content removal', () => {
    expect(pdfRedact.description).toContain('Remove');
  });
});

describe('pdf-redact — run()', () => {
  it('clips enormous finite boxes before converting to bitmap coordinates', async () => {
    const result = (await pdfRedact.run(
      [await secretFixture()],
      {
        rectangles: [{ page: 1, x: -1e308, y: 0, width: 1.5e308, height: 300 }],
      },
      makeCtx(),
    )) as Blob;
    const doc = await PDFDocument.load(await result.arrayBuffer());
    const { PDFRawStream, PDFName, decodePDFRawStream } = await import('pdf-lib');
    const images = doc.context
      .enumerateIndirectObjects()
      .map(([, object]) => object)
      .filter(
        (object): object is RawStream =>
          object instanceof PDFRawStream &&
          object.dict.get(PDFName.of('Subtype'))?.toString() === '/Image',
      );
    expect(images).toHaveLength(1);
    expect(
      decodePDFRawStream(images[0]!)
        .decode()
        .some((value) => value !== 0),
    ).toBe(false);
  });
  it('redacts nested Form XObjects on a cropped, rotated page using source PDF points', async () => {
    const doc = await PDFDocument.create();
    const embedded = await doc.embedPdf(await (await secretFixture()).arrayBuffer());
    const page = doc.addPage([400, 400]);
    page.drawPage(embedded[0]!, { x: 40, y: 40 });
    const { degrees } = await import('pdf-lib');
    page.setCropBox(10, 20, 330, 340);
    page.setRotation(degrees(90));
    const input = new File([(await doc.save()) as BlobPart], 'nested.pdf');
    const result = (await pdfRedact.run(
      [input],
      {
        rectangles: secretBoxes.map((box) => ({ ...box, x: box.x + 40, y: box.y + 40 })),
      },
      makeCtx(),
    )) as Blob;
    const text = (await pdfToText.run([new File([result], 'output.pdf')], {}, makeCtx())) as Blob;
    expect(await text.text()).not.toContain('SECRET123');
    expect(await text.text()).toContain('OUTSIDE456');
    expect(await text.text()).toContain('KEEP789');
    const output = await PDFDocument.load(await result.arrayBuffer());
    expect(output.getPage(0).getRotation().angle).toBe(90);
    expect(output.getPage(0).getSize()).toEqual({ width: 330, height: 340 });
  });

  it('preserves multi-codepoint Unicode glyph mappings outside redactions', async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const { PDFDict, PDFName } = await import('pdf-lib');
    const cmap = doc.context.register(
      doc.context.flateStream(
        '/CIDInit /ProcSet findresource begin 12 dict begin begincmap ' +
          '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def ' +
          '/CMapName /TestUnicode def /CMapType 2 def ' +
          '1 begincodespacerange <00> <FF> endcodespacerange ' +
          '1 beginbfchar <4B> <4E2D6587> endbfchar endcmap ' +
          'CMapName currentdict /CMap defineresource pop end end',
      ),
    );
    const page = doc.addPage([300, 300]);
    page.drawText('KEEP', { font, x: 20, y: 250, size: 12 });
    page.drawText('SECRET123', { font, x: 20, y: 200, size: 12 });
    await doc.flush();
    doc.context.lookup(font.ref, PDFDict).set(PDFName.of('ToUnicode'), cmap);
    const result = (await pdfRedact.run(
      [new File([(await doc.save()) as BlobPart], 'unicode.pdf')],
      {
        rectangles: [{ page: 1, x: 19, y: 195, width: 100, height: 20 }],
      },
      makeCtx(),
    )) as Blob;
    const extracted = (await pdfToText.run(
      [new File([result], 'output.pdf')],
      {},
      makeCtx(),
    )) as Blob;
    expect(await extracted.text()).toContain('中文EEP');
    expect(await extracted.text()).not.toContain('SECRET123');
  });

  it('retains more than 255 distinct Unicode glyphs across output fonts', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([300, 300]);
    const { PDFDict, PDFName } = await import('pdf-lib');
    const lines: string[] = [];
    for (let row = 0; row < 3; row++) {
      const font = await doc.embedFont(StandardFonts.Helvetica);
      const characters = Array.from({ length: 95 }, (_, i) => 0x4e00 + row * 95 + i);
      lines.push(String.fromCharCode(...characters));
      page.drawText(Array.from({ length: 95 }, (_, i) => String.fromCharCode(i + 32)).join(''), {
        font,
        x: 5,
        y: 280 - row * 10,
        size: 2,
      });
      await doc.flush();
      const mappings = characters
        .map((code, i) => `<${(i + 32).toString(16)}> <${code.toString(16)}>`)
        .join('\n');
      const cmap = doc.context.register(
        doc.context.flateStream(
          '/CIDInit /ProcSet findresource begin 12 dict begin begincmap ' +
            '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def ' +
            '/CMapName /ManyGlyphs def /CMapType 2 def ' +
            `1 begincodespacerange <00> <FF> endcodespacerange 95 beginbfchar\n${mappings}\nendbfchar ` +
            'endcmap CMapName currentdict /CMap defineresource pop end end',
        ),
      );
      doc.context.lookup(font.ref, PDFDict).set(PDFName.of('ToUnicode'), cmap);
    }
    const result = (await pdfRedact.run(
      [new File([(await doc.save()) as BlobPart], 'many-glyphs.pdf')],
      {
        rectangles: [{ page: 1, x: 0, y: 0, width: 1, height: 1 }],
      },
      makeCtx(),
    )) as Blob;
    const extracted = (await pdfToText.run(
      [new File([result], 'output.pdf')],
      {},
      makeCtx(),
    )) as Blob;
    for (const line of lines) expect(await extracted.text()).toContain(line);
  });

  it.each([
    { page: 1.5, x: 0, y: 0, width: 10, height: 10 },
    { page: 1, x: NaN, y: 0, width: 10, height: 10 },
    { page: 1, x: 0, y: 0, width: -1, height: 10 },
    { page: 1, x: 0, y: 0, width: 10, height: Infinity },
  ])('rejects invalid rectangle %j', async (rectangle) => {
    await expect(
      pdfRedact.run(
        [loadFixture('doc-a.pdf', 'application/pdf')],
        {
          rectangles: [rectangle],
        },
        makeCtx(),
      ),
    ).rejects.toThrow('Rectangles require');
  });

  it('rejects invalid fill colors', async () => {
    await expect(
      pdfRedact.run(
        [loadFixture('doc-a.pdf', 'application/pdf')],
        {
          rectangles: secretBoxes,
          color: [0, NaN, 1],
        },
        makeCtx(),
      ),
    ).rejects.toThrow('color must');
  });

  it('honors cancellation before parsing', async () => {
    const ctx = makeCtx();
    const controller = new AbortController();
    controller.abort();
    await expect(
      pdfRedact.run(
        [loadFixture('doc-a.pdf', 'application/pdf')],
        {
          rectangles: secretBoxes,
        },
        { ...ctx, signal: controller.signal },
      ),
    ).rejects.toThrow('Aborted');
  });
  it('removes covered content and metadata while keeping adjacent text, including after compression', async () => {
    const result = (await pdfRedact.run(
      [await secretFixture()],
      { rectangles: secretBoxes },
      makeCtx(),
    )) as Blob;
    await assertSecretRemoved(result);
    const compressed = (await pdfCompress.run(
      [new File([result], 'redacted.pdf')],
      {},
      makeCtx(),
    )) as Blob;
    await assertSecretRemoved(compressed);
  });
  it('draws a black rectangle on a PDF', async () => {
    const input = loadFixture('doc-a.pdf', 'application/pdf');
    const result = await pdfRedact.run(
      [input],
      { rectangles: [{ page: 1, x: 50, y: 50, width: 100, height: 50 }] },
      makeCtx(),
    );
    const blob = Array.isArray(result) ? result[0]! : result;
    expect(blob.type).toBe('application/pdf');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(bytes[0]).toBe(0x25); // %PDF
  });

  it('handles multi-page redactions', async () => {
    const input = loadFixture('doc-multipage.pdf', 'application/pdf');
    const result = await pdfRedact.run(
      [input],
      {
        rectangles: [
          { page: 1, x: 10, y: 10, width: 50, height: 30 },
          { page: 3, x: 20, y: 20, width: 80, height: 40 },
        ],
      },
      makeCtx(),
    );
    const blob = Array.isArray(result) ? result[0]! : result;
    expect(blob.type).toBe('application/pdf');
  });

  it('respects custom color', async () => {
    const input = loadFixture('doc-a.pdf', 'application/pdf');
    const result = await pdfRedact.run(
      [input],
      {
        rectangles: [{ page: 1, x: 0, y: 0, width: 100, height: 100 }],
        color: [1, 1, 1],
      },
      makeCtx(),
    );
    const blob = Array.isArray(result) ? result[0]! : result;
    expect(blob.type).toBe('application/pdf');
  });

  it('throws when rectangles is empty', async () => {
    const input = loadFixture('doc-a.pdf', 'application/pdf');
    await expect(pdfRedact.run([input], { rectangles: [] }, makeCtx())).rejects.toThrow(
      'rectangles must not be empty',
    );
  });

  it('throws for out-of-bounds page reference', async () => {
    const input = loadFixture('doc-a.pdf', 'application/pdf');
    await expect(
      pdfRedact.run(
        [input],
        { rectangles: [{ page: 99, x: 0, y: 0, width: 10, height: 10 }] },
        makeCtx(),
      ),
    ).rejects.toThrow();
  });
});
