import { createRegistry, type ToolRegistry } from './registry.js';
import { compress } from './tools/compress/index.js';
import { convert } from './tools/convert/index.js';
import { stripExif } from './tools/strip-exif/index.js';
import { imageToPdf } from './tools/image-to-pdf/index.js';
import { mergePdf } from './tools/merge-pdf/index.js';
import { splitPdf } from './tools/split-pdf/index.js';
import { rotatePdf } from './tools/rotate-pdf/index.js';
import { reorderPdf } from './tools/reorder-pdf/index.js';
import { pageNumbersPdf } from './tools/page-numbers-pdf/index.js';
import { colorPalette } from './tools/color-palette/index.js';
import { qr } from './tools/qr/index.js';
import { watermarkPdf } from './tools/watermark-pdf/index.js';
import { pdfToText } from './tools/pdf-to-text/index.js';
import { imageDiff } from './tools/image-diff/index.js';
import { rotateImage } from './tools/rotate-image/index.js';
import { flipImage } from './tools/flip-image/index.js';
import { grayscale } from './tools/grayscale/index.js';
import { sepia } from './tools/sepia/index.js';
import { invert } from './tools/invert/index.js';
import { imageInfo } from './tools/image-info/index.js';
import { pdfInfo } from './tools/pdf-info/index.js';
import { hash } from './tools/hash/index.js';
import { crop } from './tools/crop/index.js';
import { resize } from './tools/resize/index.js';
import { imageWatermark } from './tools/image-watermark/index.js';
import { favicon } from './tools/favicon/index.js';
import { pdfToImage } from './tools/pdf-to-image/index.js';
import type { ToolModule } from './types.js';

/**
 * All first-party Wyreup tools, in presentation order.
 * Typed as ToolModule<any> because TypeScript's function parameter
 * contravariance makes it hard to hold Params-parameterized tools in
 * a single heterogeneous array without losing type safety on each one.
 */
export const defaultTools: ToolModule<any>[] = [
  compress,
  convert,
  stripExif,
  imageToPdf,
  mergePdf,
  splitPdf,
  rotatePdf,
  reorderPdf,
  pageNumbersPdf,
  colorPalette,
  qr,
  watermarkPdf,
  pdfToText,
  imageDiff,
  rotateImage,
  flipImage,
  grayscale,
  sepia,
  invert,
  imageInfo,
  pdfInfo,
  hash,
  crop,
  resize,
  imageWatermark,
  favicon,
  pdfToImage,
];

export function createDefaultRegistry(): ToolRegistry {
  return createRegistry(defaultTools as ToolModule[]);
}
