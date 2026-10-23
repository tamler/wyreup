import type { BankPdfEnvironment } from './bank-statement.js';
import { createBankPdfWorker } from './bank-pdf-platform.js';

/** Document-supplied font, CMap and WASM references cannot resolve resources. */
export class RejectBankResources {
  fetch(): Promise<Uint8Array> {
    return Promise.reject(new Error('Bank statement extraction cannot fetch font, CMap or WASM resources.'));
  }
}

export async function createBankPdfEnvironment(): Promise<BankPdfEnvironment> {
  const { getDocument, PDFWorker, GlobalWorkerOptions, OPS } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const owned = createBankPdfWorker({ PDFWorker, GlobalWorkerOptions });
  const worker = owned.worker;
  try {
    await worker.promise;
  } catch (error) {
    try {
      owned.destroy();
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'PDF worker initialization and cleanup failed.');
    }
    throw error;
  }
  let destroyed = false;
  return {
    open(bytes) {
      if (destroyed) throw new Error('The owned PDF environment is closed.');
      return getDocument({
        data: new Uint8Array(bytes), worker,
        disableAutoFetch: true, disableStream: true, disableRange: true,
        useWorkerFetch: false, useSystemFonts: false, disableFontFace: true,
        enableXfa: false, useWasm: false, isImageDecoderSupported: false,
        isOffscreenCanvasSupported: false, stopAtErrors: true, maxImageSize: 1,
        BinaryDataFactory: RejectBankResources,
      });
    },
    paintOps: [OPS.stroke, OPS.closeStroke, OPS.fill, OPS.eoFill, OPS.fillStroke,
      OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke, OPS.shadingFill,
      OPS.constructPath, OPS.rawFillPath],
    imageOps: [OPS.paintXObject, OPS.paintImageMaskXObject, OPS.paintImageMaskXObjectGroup,
      OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintInlineImageXObjectGroup,
      OPS.paintImageXObjectRepeat, OPS.paintImageMaskXObjectRepeat, OPS.paintSolidColorImageMask],
    destroy() {
      if (destroyed) return;
      destroyed = true;
      owned.destroy();
    },
  };
}
