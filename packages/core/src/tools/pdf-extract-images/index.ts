import type { ToolModule, ToolRunContext } from '../../types.js';
import { createCanvas, canvasToBlob } from '../../lib/canvas.js';

export interface PdfExtractImagesParams {
  /** Output image format. PNG preserves the source bitmap exactly; JPEG / WebP are smaller. */
  format?: 'png' | 'jpeg' | 'webp';
  /** JPEG / WebP quality (1-100). Ignored for PNG. */
  quality?: number;
  /** Minimum image side in pixels — filter out tiny icons / line art. */
  minSize?: number;
  /** Page range (1-indexed). Empty = all pages. */
  pages?: (number | string)[];
}

export const defaultPdfExtractImagesParams: PdfExtractImagesParams = {
  format: 'png',
  quality: 90,
  minSize: 32,
};

export interface PdfExtractImagesReport {
  pagesScanned: number;
  imagesFound: number;
  imagesExtracted: number;
  imagesSkipped: { page: number; reason: string }[];
  files: { name: string; bytes: number; width: number; height: number; page: number }[];
}

const PdfExtractImagesComponentStub = (): unknown => null;

const FORMAT_MIME: Record<string, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

// pdfjs OPS constant values (stable since v2). paintImageXObject is the
// canonical "draw a raster image" operator; the inline variant is rare
// enough in real-world PDFs that we don't handle it in v1 of this tool.
const OPS_PAINT_IMAGE_X_OBJECT = 85;

interface RawImage {
  data?: Uint8ClampedArray;
  bitmap?: { width: number; height: number };
  width?: number;
  height?: number;
  kind?: number; // 1=grayscale, 2=RGB, 3=RGBA in pdfjs internals
}

async function encodeImage(
  raw: RawImage,
  format: 'png' | 'jpeg' | 'webp',
  quality: number,
): Promise<{ blob: Blob; width: number; height: number } | null> {
  // Prefer the ImageBitmap if pdfjs already gave us one — drawImage handles it.
  if (raw.bitmap) {
    const { width, height } = raw.bitmap;
    const canvas = await createCanvas(width, height);
    const ctx = canvas.getContext('2d') as unknown as {
      drawImage: (img: unknown, x: number, y: number) => void;
    };
    ctx.drawImage(raw.bitmap, 0, 0);
    const mime = FORMAT_MIME[format] ?? 'image/png';
    const blob = await canvasToBlob(canvas, mime, format === 'png' ? undefined : quality / 100);
    return { blob, width, height };
  }
  // Fallback: raw RGBA / RGB / grayscale buffer.
  if (raw.data && raw.width && raw.height) {
    const { width, height } = raw;
    const canvas = await createCanvas(width, height);
    const ctx = canvas.getContext('2d') as unknown as {
      createImageData: (w: number, h: number) => { data: Uint8ClampedArray };
      putImageData: (data: { data: Uint8ClampedArray }, x: number, y: number) => void;
    };
    const imageData = ctx.createImageData(width, height);
    // pdfjs `kind` values: 1 = grayscale (1B/px), 2 = RGB (3B/px), 3 = RGBA (4B/px).
    const target = imageData.data;
    const src = raw.data;
    if (raw.kind === 3 || src.length === width * height * 4) {
      target.set(src);
    } else if (raw.kind === 2 || src.length === width * height * 3) {
      // Expand RGB → RGBA.
      let di = 0;
      for (let si = 0; si < src.length; si += 3) {
        target[di++] = src[si]!;
        target[di++] = src[si + 1]!;
        target[di++] = src[si + 2]!;
        target[di++] = 255;
      }
    } else if (raw.kind === 1 || src.length === width * height) {
      // Expand grayscale → RGBA.
      let di = 0;
      for (let si = 0; si < src.length; si++) {
        const v = src[si]!;
        target[di++] = v;
        target[di++] = v;
        target[di++] = v;
        target[di++] = 255;
      }
    } else {
      return null;
    }
    ctx.putImageData(imageData, 0, 0);
    const mime = FORMAT_MIME[format] ?? 'image/png';
    const blob = await canvasToBlob(canvas, mime, format === 'png' ? undefined : quality / 100);
    return { blob, width, height };
  }
  return null;
}

export const pdfExtractImages: ToolModule<PdfExtractImagesParams> = {
  id: 'pdf-extract-images',
  slug: 'pdf-extract-images',
  name: 'PDF Extract Images',
  description:
    'Pull embedded raster images out of a PDF and pack them into a ZIP. Different from pdf-to-image — that one renders whole pages; this one extracts the original photos and figures. Coverage varies by PDF: pdfjs preserves some image objects after rendering and not others. The ZIP always contains a _report.json listing what was found vs. extracted vs. skipped, so you can see which pages need a follow-up pass.',
  category: 'pdf',
  presence: 'both',
  keywords: ['pdf', 'extract', 'images', 'photos', 'figures', 'embedded', 'zip'],

  input: {
    accept: ['application/pdf'],
    min: 1,
    max: 1,
    sizeLimit: 500 * 1024 * 1024,
  },
  output: {
    mime: 'application/zip',
    multiple: false,
  },

  interactive: false,
  batchable: true,
  cost: 'free',
  memoryEstimate: 'high',

  defaults: defaultPdfExtractImagesParams,

  paramSchema: {
    format: {
      type: 'enum',
      label: 'image format',
      options: [
        { value: 'png', label: 'PNG (lossless, preserves source)' },
        { value: 'jpeg', label: 'JPEG (smaller, lossy)' },
        { value: 'webp', label: 'WebP (modern, balanced)' },
      ],
    },
    quality: {
      type: 'range',
      label: 'quality',
      help: 'JPEG / WebP only. Ignored for PNG.',
      min: 1,
      max: 100,
      step: 1,
      unit: '%',
      showWhen: { field: 'format', in: ['jpeg', 'webp'] },
    },
    minSize: {
      type: 'number',
      label: 'min side (px)',
      help: 'Skip images smaller than this on either axis — filters out tiny icons and line-art fragments.',
      min: 0,
      max: 2000,
      step: 8,
      unit: 'px',
    },
  },

  Component: PdfExtractImagesComponentStub,

  async run(inputs: File[], params: PdfExtractImagesParams, ctx: ToolRunContext): Promise<Blob[]> {
    if (inputs.length !== 1) throw new Error('pdf-extract-images accepts exactly one PDF file.');
    const format = params.format ?? 'png';
    const quality = params.quality ?? 90;
    const minSize = params.minSize ?? 32;
    if (!FORMAT_MIME[format]) throw new Error(`Unknown format "${format}".`);

    ctx.onProgress({ stage: 'loading-deps', percent: 5, message: 'Loading PDF + ZIP libraries' });
    const [{ getDocument, GlobalWorkerOptions }, { default: JSZip }] = await Promise.all([
      import('pdfjs-dist/legacy/build/pdf.mjs'),
      import('jszip'),
    ]);

    if (typeof window === 'undefined') {
      const { createRequire } = await import('node:module');
      const require = createRequire(import.meta.url);
      try {
        GlobalWorkerOptions.workerSrc = require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');
      } catch {
        GlobalWorkerOptions.workerSrc = 'pdf.worker.mjs';
      }
    }

    const buffer = await inputs[0]!.arrayBuffer();
    const pdf = await getDocument({ data: new Uint8Array(buffer) }).promise;
    const pageCount: number = pdf.numPages;

    let pageNumbers: number[];
    if (params.pages && params.pages.length > 0) {
      const { parseRangeSpec } = await import('../../lib/pdf-ranges.js');
      pageNumbers = parseRangeSpec(params.pages, pageCount);
    } else {
      pageNumbers = Array.from({ length: pageCount }, (_, i) => i + 1);
    }

    const zip = new JSZip();
    const report: PdfExtractImagesReport = {
      pagesScanned: 0,
      imagesFound: 0,
      imagesExtracted: 0,
      imagesSkipped: [],
      files: [],
    };
    // De-dupe by image-object id so the same XObject referenced from multiple
    // pages isn't extracted N times.
    const seenIds = new Set<string>();

    const ext = format === 'jpeg' ? 'jpg' : format;

    for (let idx = 0; idx < pageNumbers.length; idx++) {
      if (ctx.signal.aborted) throw new Error('Aborted');
      const pageNum = pageNumbers[idx]!;
      ctx.onProgress({
        stage: 'processing',
        percent: 10 + Math.floor((idx / pageNumbers.length) * 80),
        message: `Scanning page ${pageNum}/${pageCount}`,
      });
      const page = await pdf.getPage(pageNum);

      // Render the page first so pdfjs loads every image dependency into
      // page.objs. Without this, objs.get(name) throws "isn't resolved yet"
      // because pdfjs only fetches the bitmap during paint. Rendering is the
      // cost we pay to extract — but we render at scale 1 to a throwaway
      // canvas so the buffer never leaves this function.
      const viewport = page.getViewport({ scale: 1 });
      const sinkCanvas = await createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const sinkCtx = sinkCanvas.getContext('2d');
      try {
        await page.render({
          canvasContext: sinkCtx as unknown as CanvasRenderingContext2D,
          canvas: sinkCanvas as unknown as HTMLCanvasElement,
          viewport,
        }).promise;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        report.imagesSkipped.push({ page: pageNum, reason: `render failed: ${msg}` });
        continue;
      }

      const ops = await page.getOperatorList();
      report.pagesScanned++;

      for (let i = 0; i < ops.fnArray.length; i++) {
        if (ops.fnArray[i] !== OPS_PAINT_IMAGE_X_OBJECT) continue;
        const argsArray = ops.argsArray as unknown[][];
        const imgName: unknown = argsArray[i]?.[0];
        if (typeof imgName !== 'string') continue;
        if (seenIds.has(imgName)) continue;
        seenIds.add(imgName);
        report.imagesFound++;

        // After render() above, the image is resolved in page.objs (or in
        // commonObjs for resources shared across pages). pdfjs's PDFObjects.has
        // is unreliable across versions, so we just try get() and catch.
        let raw: RawImage | null = null;
        const tryGet = (bag: { get: (id: string) => unknown }): RawImage | null => {
          try {
            const obj = bag.get(imgName) as RawImage;
            return obj ?? null;
          } catch {
            return null;
          }
        };
        raw = tryGet(page.objs) ?? tryGet(page.commonObjs);
        if (!raw) {
          report.imagesSkipped.push({ page: pageNum, reason: `${imgName}: object unresolved` });
          continue;
        }
        const w = raw.bitmap?.width ?? raw.width ?? 0;
        const h = raw.bitmap?.height ?? raw.height ?? 0;
        if (w < minSize || h < minSize) {
          report.imagesSkipped.push({ page: pageNum, reason: `${imgName}: ${w}x${h} below min` });
          continue;
        }

        let encoded;
        try {
          encoded = await encodeImage(raw, format, quality);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          report.imagesSkipped.push({ page: pageNum, reason: `${imgName}: encode failed (${msg})` });
          continue;
        }
        if (!encoded) {
          report.imagesSkipped.push({ page: pageNum, reason: `${imgName}: unsupported image shape` });
          continue;
        }

        const name = `page-${String(pageNum).padStart(3, '0')}-${imgName}.${ext}`;
        zip.file(name, new Uint8Array(await encoded.blob.arrayBuffer()));
        report.imagesExtracted++;
        report.files.push({
          name,
          bytes: encoded.blob.size,
          width: encoded.width,
          height: encoded.height,
          page: pageNum,
        });
      }
    }

    // Always include a JSON report so the ZIP self-describes — useful even
    // when zero images were extracted (tells the user the PDF was scanned
    // but had no raster XObjects).
    zip.file('_report.json', JSON.stringify(report, null, 2));

    ctx.onProgress({ stage: 'processing', percent: 95, message: 'Packing ZIP' });
    const zipBlob = await zip.generateAsync({ type: 'blob' });
    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [zipBlob];
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['application/zip'],
  },
};
