import type { ToolModule, ToolRunContext } from '../../types.js';
import { assertPdfPageBudget } from '../../lib/budget.js';
import { createCanvas, canvasToBlob } from '../../lib/canvas.js';
import type { CanvasLike } from '../../lib/canvas.js';
import type { TextItem, TextStyle } from 'pdfjs-dist/types/src/display/api.js';
import type { PDFName } from 'pdf-lib';

// Test glyph quadrilaterals in source PDF coordinates, before page rotation or
// crop-box translation. A small margin also removes glyphs touching a box edge.
function touches(item: TextItem, style: TextStyle, rect: PdfRedactRectangle): boolean {
  const [a, b, c, d, x, y] = item.transform as number[];
  const length = Math.hypot(a!, b!) || 1;
  const verticalLength = Math.hypot(c!, d!) || 1;
  const advance = style.vertical
    ? [(-c! / verticalLength) * item.height, (-d! / verticalLength) * item.height]
    : [(a! / length) * item.width, (b! / length) * item.width];
  const ascent = Math.max(1, style.ascent || 1);
  const descent = Math.min(-0.3, style.descent || -0.3);
  const points = [descent, ascent].flatMap((v) => [
    [x! + c! * v, y! + d! * v],
    [x! + c! * v + advance[0]!, y! + d! * v + advance[1]!],
  ]);
  const xs = points.map((p) => p[0]!);
  const ys = points.map((p) => p[1]!);
  return (
    Math.max(...xs) + 0.5 >= rect.x &&
    Math.min(...xs) - 0.5 <= rect.x + rect.width &&
    Math.max(...ys) + 0.5 >= rect.y &&
    Math.min(...ys) - 0.5 <= rect.y + rect.height
  );
}

export interface PdfRedactRectangle {
  /** Page number (1-indexed). */
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PdfRedactParams {
  /**
   * Rectangles to redact. Coordinates in PDF points (1pt = 1/72 inch).
   * Each rectangle specifies its target page (1-indexed).
   */
  rectangles: PdfRedactRectangle[];
  /**
   * Redaction fill color as RGB 0-1. Default black [0, 0, 0].
   */
  color?: [number, number, number];
}

export const pdfRedact: ToolModule<PdfRedactParams> = {
  id: 'pdf-redact',
  slug: 'pdf-redact',
  name: 'Redact PDF',
  description:
    'Remove covered text and image content from a new PDF. ' +
    'Rebuilds pages at 144 DPI with extractable text outside the boxes; strips annotations, attachments and source metadata. Runs locally.',
  category: 'edit',
  keywords: ['pdf', 'redact', 'cover', 'hide', 'privacy', 'black'],

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
  memoryEstimate: 'high',
  budget: { maxPages: 2_000 },

  chainSuggestions: ['pdf-compress', 'merge-pdf', 'reorder-pdf', 'pdf-encrypt'],
  defaults: {
    rectangles: [],
    color: [0, 0, 0],
  },

  async run(inputs: File[], params: PdfRedactParams, ctx: ToolRunContext): Promise<Blob> {
    if (ctx.signal.aborted) throw new Error('Aborted');

    const { rectangles, color = [0, 0, 0] } = params;

    if (!rectangles || rectangles.length === 0) {
      throw new Error('rectangles must not be empty.');
    }

    if (color.length !== 3 || color.some((v) => !Number.isFinite(v) || v < 0 || v > 1)) {
      throw new Error('color must contain three finite RGB values between 0 and 1.');
    }
    for (const rect of rectangles) {
      if (
        !Number.isInteger(rect.page) ||
        rect.page < 1 ||
        ![rect.x, rect.y, rect.width, rect.height, rect.x + rect.width, rect.y + rect.height].every(
          Number.isFinite,
        ) ||
        rect.width <= 0 ||
        rect.height <= 0
      ) {
        throw new Error(
          'Rectangles require a positive integer page, finite coordinates and positive dimensions.',
        );
      }
    }

    const lib = await import('pdf-lib');
    const {
      PDFDocument,
      PDFHexString,
      beginText,
      endText,
      setFontAndSize,
      setTextMatrix,
      setTextRenderingMode,
      showText,
      TextRenderingMode,
      pushGraphicsState,
      popGraphicsState,
      degrees,
    } = lib;
    const { getDocument, PDFWorker, AnnotationMode, Util } =
      await import('pdfjs-dist/legacy/build/pdf.mjs');
    const isNode = typeof process !== 'undefined' && !!process.versions?.node;
    const buffer = await inputs[0]!.arrayBuffer();
    // Use an owned channel with the bundled patched parser in every runtime.
    // This avoids shared/global worker configuration, stale fake-worker caches,
    // and consumer package managers that do not inherit our pnpm patches.
    const { WorkerMessageHandler } = await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
    const channel = new MessageChannel();
    WorkerMessageHandler.initializeFromPort(channel.port2);
    channel.port1.start();
    channel.port2.start();
    // Legacy declarations narrow port to null although PDFWorker accepts a
    // message port at runtime (the same interface used by its own fake worker).
    const worker = new PDFWorker({ port: channel.port1 } as unknown as ConstructorParameters<
      typeof PDFWorker
    >[0]);

    ctx.onProgress({ stage: 'processing', percent: 10, message: 'Loading PDF' });
    const task = getDocument({ data: new Uint8Array(buffer), stopAtErrors: true, worker });
    const abort = () => {
      void task.destroy();
    };
    ctx.signal.addEventListener('abort', abort, { once: true });
    try {
      const source = await task.promise;
      const pageCount = source.numPages;
      assertPdfPageBudget(pageCount, { maxPages: 2_000 });

      if (ctx.signal.aborted) throw new Error('Aborted');

      for (const rect of rectangles) {
        if (rect.page < 1 || rect.page > pageCount) {
          throw new Error(
            `Rectangle references page ${rect.page} but document has ${pageCount} page${pageCount === 1 ? '' : 's'}.`,
          );
        }
      }

      // Never copy source objects: even copying untouched pages can retain shared
      // images, font programs, form values or historical/unused confidential data.
      const pdfDoc = await PDFDocument.create();
      for (let number = 1; number <= pageCount; number++) {
        if (ctx.signal.aborted) throw new Error('Aborted');
        const sourcePage = await source.getPage(number);
        const boxes = rectangles.filter((rect) => rect.page === number);
        const viewport = sourcePage.getViewport({ scale: 2, rotation: 0 });
        const width = Math.ceil(viewport.width);
        const height = Math.ceil(viewport.height);
        if (
          !Number.isSafeInteger(width * height) ||
          width <= 0 ||
          height <= 0 ||
          width * height > 32_000_000
        ) {
          throw new Error('PDF page exceeds the 32 megapixel redaction rendering limit.');
        }
        // PDF.js's native Path2D objects and render surface must come from the
        // same canvas runtime; its optional Node dependency can differ from ours.
        const canvas = isNode
          ? (
              source.canvasFactory as { create(w: number, h: number): { canvas: CanvasLike } }
            ).create(width, height).canvas
          : await createCanvas(width, height);
        const context = canvas.getContext('2d') as unknown as CanvasRenderingContext2D;
        await sourcePage.render({
          canvas: canvas as unknown as HTMLCanvasElement,
          canvasContext: context,
          viewport,
          annotationMode: AnnotationMode.DISABLE,
        }).promise;
        context.resetTransform();
        context.globalAlpha = 1;
        context.globalCompositeOperation = 'source-over';
        context.fillStyle = `rgb(${color.map((v) => Math.round(v * 255)).join(',')})`;
        for (const box of boxes) {
          const [minX, minY, maxX, maxY] = sourcePage.view;
          const leftPoint = Math.max(box.x, minX!);
          const bottomPoint = Math.max(box.y, minY!);
          const rightPoint = Math.min(box.x + box.width, maxX!);
          const topPoint = Math.min(box.y + box.height, maxY!);
          if (rightPoint <= leftPoint || topPoint <= bottomPoint) continue;
          const [x1, y1] = viewport.convertToViewportPoint(leftPoint, bottomPoint) as number[];
          const [x2, y2] = viewport.convertToViewportPoint(rightPoint, topPoint) as number[];
          // Round outward to overwrite boundary samples rather than alpha-blending
          // a fill over the original confidential pixels.
          const left = Math.floor(Math.min(x1!, x2!));
          const top = Math.floor(Math.min(y1!, y2!));
          context.fillRect(
            left,
            top,
            Math.ceil(Math.max(x1!, x2!)) - left,
            Math.ceil(Math.max(y1!, y2!)) - top,
          );
        }
        const png = await canvasToBlob(canvas, 'image/png');
        const page = pdfDoc.addPage([viewport.width / 2, viewport.height / 2]);
        const [originX, originY] = sourcePage.view;
        page.setMediaBox(originX!, originY!, page.getWidth(), page.getHeight());
        const image = await pdfDoc.embedPng(await png.arrayBuffer());
        page.drawImage(image, {
          x: originX!,
          y: originY!,
          width: page.getWidth(),
          height: page.getHeight(),
        });
        page.setRotation(degrees(sourcePage.rotate));

        // Wyreup's opt-in PDF.js patch emits one item per source glyph. Without
        // it, dropping a partly covered item would remove an entire text run.
        const text = await sourcePage.getTextContent({
          disableNormalization: true,
          perGlyph: true,
        } as Parameters<typeof sourcePage.getTextContent>[0]);
        if (!(text as typeof text & { wyreupPerGlyph?: boolean }).wyreupPerGlyph) {
          throw new Error(
            'Redaction requires the Wyreup glyph extraction worker. Reload the application and try again.',
          );
        }
        const items = text.items
          .filter((item): item is TextItem => 'str' in item && !!item.str)
          .filter((item) => {
            const style = text.styles[item.fontName];
            if (
              !style ||
              item.transform.length !== 6 ||
              !item.transform.every(Number.isFinite) ||
              ![item.width, item.height].every(Number.isFinite) ||
              (style.ascent !== undefined && !Number.isFinite(style.ascent)) ||
              (style.descent !== undefined && !Number.isFinite(style.descent))
            ) {
              throw new Error('Cannot safely locate PDF text glyphs.');
            }
            return !boxes.some((box) => touches(item, style, box));
          });
        const glyphs = [...new Set(items.map((item) => item.str))];
        if (glyphs.length > 65_534) throw new Error('Too many unique text glyphs on one page.');
        const codes = new Map<string, { code: string; name: PDFName }>();
        // A fresh Unicode map preserves scripts and ligatures without embedding
        // source font programs (which can contain removed glyph outlines/data).
        // Embedded blank Type3 glyph programs are valid without source fonts
        // or renderer-dependent substitution of an unembedded identity font.
        const blank = pdfDoc.context.register(pdfDoc.context.flateStream('1000 0 d0\n'));
        for (let start = 0; start < glyphs.length; start += 255) {
          const batch = glyphs.slice(start, start + 255);
          const mappings = batch.map(
            (str, index) =>
              `<${(index + 1).toString(16).padStart(2, '0')}> <${PDFHexString.fromText(str).asString().slice(4)}>`,
          );
          const chunks: string[] = [];
          for (let i = 0; i < mappings.length; i += 100) {
            const chunk = mappings.slice(i, i + 100);
            chunks.push(`${chunk.length} beginbfchar\n${chunk.join('\n')}\nendbfchar`);
          }
          const cmap = pdfDoc.context.register(
            pdfDoc.context.flateStream(
              `/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /WyreupUnicode def\n/CMapType 2 def\n1 begincodespacerange\n<00> <FF>\nendcodespacerange\n${chunks.join('\n')}\nendcmap\nCMapName currentdict /CMap defineresource pop\nend\nend`,
            ),
          );
          const names = batch.map((_, index) => `g${index + 1}`);
          const font = pdfDoc.context.register(
            pdfDoc.context.obj({
              Type: 'Font',
              Subtype: 'Type3',
              FontBBox: [0, -300, 1000, 1000],
              FontMatrix: [0.001, 0, 0, 0.001, 0, 0],
              CharProcs: Object.fromEntries(names.map((name) => [name, blank])),
              Encoding: { Type: 'Encoding', Differences: [1, ...names] },
              FirstChar: 1,
              LastChar: batch.length,
              Widths: batch.map(() => 1000),
              Resources: {},
              ToUnicode: cmap,
            }),
          );
          const name = page.node.newFontDictionary('WyreupText', font);
          batch.forEach((str, index) =>
            codes.set(str, { name, code: (index + 1).toString(16).padStart(2, '0') }),
          );
        }
        page.pushOperators(
          pushGraphicsState(),
          beginText(),
          setTextRenderingMode(TextRenderingMode.Invisible),
        );
        let activeFont: PDFName | undefined;
        for (const item of items) {
          const glyph = codes.get(item.str)!;
          if (activeFont !== glyph.name) {
            page.pushOperators(setFontAndSize(glyph.name, 1));
            activeFont = glyph.name;
          }
          const transform = Util.transform(
            [0.5, 0, 0, -0.5, originX!, page.getHeight() + originY!],
            Util.transform(viewport.transform, item.transform),
          ) as number[];
          const vertical = text.styles[item.fontName]?.vertical;
          const baseline = vertical
            ? [-transform[2]!, -transform[3]!]
            : [transform[0]!, transform[1]!];
          const length = Math.hypot(...baseline) || 1;
          const advance =
            (text.styles[item.fontName]?.vertical ? item.height : item.width) * sourcePage.userUnit;
          page.pushOperators(
            setTextMatrix(
              (baseline[0]! / length) * advance,
              (baseline[1]! / length) * advance,
              transform[2]!,
              transform[3]!,
              transform[4]!,
              transform[5]!,
            ),
            showText(PDFHexString.of(glyph.code)),
          );
        }
        page.pushOperators(endText(), popGraphicsState());
        canvas.width = 0;
        canvas.height = 0;
        sourcePage.cleanup();
        ctx.onProgress({
          stage: 'processing',
          percent: 10 + Math.floor((number / pageCount) * 75),
          message: `Redacting page ${number}/${pageCount}`,
        });
      }

      ctx.onProgress({ stage: 'encoding', percent: 90, message: 'Saving PDF' });
      if (ctx.signal.aborted) throw new Error('Aborted');
      const bytes = await pdfDoc.save();
      if (ctx.signal.aborted) throw new Error('Aborted');

      ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
      return new Blob([bytes.buffer as ArrayBuffer], { type: 'application/pdf' });
    } finally {
      ctx.signal.removeEventListener('abort', abort);
      try {
        await task.destroy();
      } finally {
        worker.destroy();
        channel.port1.close();
        channel.port2.close();
      }
    }
  },

  __testFixtures: {
    valid: ['doc-a.pdf'],
    weird: [],
    expectedOutputMime: ['application/pdf'],
  },
};
