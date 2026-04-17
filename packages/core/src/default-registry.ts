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
import { jsonFormatter } from './tools/json-formatter/index.js';
import { base64 } from './tools/base64/index.js';
import { urlEncoder } from './tools/url-encoder/index.js';
import { colorConverter } from './tools/color-converter/index.js';
import { markdownToHtml } from './tools/markdown-to-html/index.js';
import { htmlToMarkdown } from './tools/html-to-markdown/index.js';
import { textDiff } from './tools/text-diff/index.js';
import { wordCounter } from './tools/word-counter/index.js';
import { passwordGenerator } from './tools/password-generator/index.js';
import { uuidGenerator } from './tools/uuid-generator/index.js';
import { ocr } from './tools/ocr/index.js';
import { svgToPng } from './tools/svg-to-png/index.js';
import { timestampConverter } from './tools/timestamp-converter/index.js';
import { loremIpsum } from './tools/lorem-ipsum/index.js';
import { regexTester } from './tools/regex-tester/index.js';
import { pdfExtractPages } from './tools/pdf-extract-pages/index.js';
import { pdfDeletePages } from './tools/pdf-delete-pages/index.js';
import { pdfCompress } from './tools/pdf-compress/index.js';
import { pdfEncrypt } from './tools/pdf-encrypt/index.js';
import { pdfDecrypt } from './tools/pdf-decrypt/index.js';
import { pdfRedact } from './tools/pdf-redact/index.js';
import { pdfMetadata } from './tools/pdf-metadata/index.js';
import { pdfExtractTables } from './tools/pdf-extract-tables/index.js';
import { pdfCrop } from './tools/pdf-crop/index.js';
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
  jsonFormatter,
  base64,
  urlEncoder,
  colorConverter,
  markdownToHtml,
  htmlToMarkdown,
  textDiff,
  wordCounter,
  passwordGenerator,
  uuidGenerator,
  ocr,
  svgToPng,
  timestampConverter,
  loremIpsum,
  regexTester,
  pdfExtractPages,
  pdfDeletePages,
  pdfCompress,
  pdfEncrypt,
  pdfDecrypt,
  pdfRedact,
  pdfMetadata,
  pdfExtractTables,
  pdfCrop,
];

export function createDefaultRegistry(): ToolRegistry {
  return createRegistry(defaultTools as ToolModule[]);
}
