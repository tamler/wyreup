// Wyreup core — tool library public API

export const WYREUP_CORE_VERSION = '0.0.0';

export type {
  ToolModule,
  ToolCategory,
  ToolPresence,
  ToolInputSpec,
  ToolOutputSpec,
  ToolProgress,
  ToolRunContext,
  ToolComponentProps,
  MemoryEstimate,
  MimePattern,
} from './types.js';

export type { ComponentType } from './ui-types.js';

export {
  runChain,
  MAX_CHAIN_DEPTH,
  ChainError,
  type Chain,
  type ChainStep,
} from './chain/engine.js';

export type { SavedChain } from './chain/types.js';

export { detectCycle } from './chain/cycle.js';

export { createRegistry, mimeMatches, type ToolRegistry } from './registry.js';

export { getRuntimeAdapter, type RuntimeAdapter } from './runtime/types.js';

export { detectFormat, getCodec, type ImageFormat, type Codec } from './lib/codecs.js';

export {
  createCanvas,
  loadImage,
  canvasToBlob,
  type CanvasLike,
  type CanvasContext2DLike,
  type ImageLike,
} from './lib/canvas.js';

export { compress, type CompressParams, defaultCompressParams } from './tools/compress/index.js';
export { convert, type ConvertParams, defaultConvertParams } from './tools/convert/index.js';
export { stripExif, type StripExifParams, defaultStripExifParams } from './tools/strip-exif/index.js';
export { imageToPdf, type ImageToPdfParams, defaultImageToPdfParams } from './tools/image-to-pdf/index.js';
export { mergePdf, type MergePdfParams, defaultMergePdfParams } from './tools/merge-pdf/index.js';
export { splitPdf, type SplitPdfParams, defaultSplitPdfParams } from './tools/split-pdf/index.js';
export { rotatePdf, type RotatePdfParams, defaultRotatePdfParams } from './tools/rotate-pdf/index.js';
export { reorderPdf, type ReorderPdfParams, defaultReorderPdfParams } from './tools/reorder-pdf/index.js';
export { pageNumbersPdf, type PageNumbersPdfParams, defaultPageNumbersPdfParams } from './tools/page-numbers-pdf/index.js';
export { colorPalette, type ColorPaletteParams, defaultColorPaletteParams } from './tools/color-palette/index.js';
export { qr, type QrParams, defaultQrParams } from './tools/qr/index.js';
export { watermarkPdf, type WatermarkPdfParams, defaultWatermarkPdfParams } from './tools/watermark-pdf/index.js';
export { pdfToText, type PdfToTextParams, defaultPdfToTextParams } from './tools/pdf-to-text/index.js';
export { imageDiff, type ImageDiffParams, defaultImageDiffParams } from './tools/image-diff/index.js';
export { rotateImage, type RotateImageParams, defaultRotateImageParams } from './tools/rotate-image/index.js';
export { flipImage, type FlipImageParams, defaultFlipImageParams } from './tools/flip-image/index.js';
export { grayscale, type GrayscaleParams, defaultGrayscaleParams } from './tools/grayscale/index.js';
export { sepia, type SepiaParams, defaultSepiaParams } from './tools/sepia/index.js';
export { invert, type InvertParams, defaultInvertParams } from './tools/invert/index.js';
export { imageInfo, type ImageInfoParams, defaultImageInfoParams } from './tools/image-info/index.js';
export { pdfInfo, type PdfInfoParams, defaultPdfInfoParams } from './tools/pdf-info/index.js';
export { hash, type HashParams, defaultHashParams } from './tools/hash/index.js';
export { crop, type CropParams, defaultCropParams } from './tools/crop/index.js';
export { resize, type ResizeParams, defaultResizeParams } from './tools/resize/index.js';
export { imageWatermark, type ImageWatermarkParams, defaultImageWatermarkParams } from './tools/image-watermark/index.js';
export { favicon, type FaviconParams, defaultFaviconParams } from './tools/favicon/index.js';
export { pdfToImage, type PdfToImageParams, defaultPdfToImageParams } from './tools/pdf-to-image/index.js';
export { jsonFormatter, type JsonFormatterParams, defaultJsonFormatterParams } from './tools/json-formatter/index.js';
export { base64, type Base64Params, defaultBase64Params } from './tools/base64/index.js';
export { urlEncoder, type UrlEncoderParams, defaultUrlEncoderParams } from './tools/url-encoder/index.js';
export { colorConverter, type ColorConverterParams, defaultColorConverterParams } from './tools/color-converter/index.js';
export { markdownToHtml, type MarkdownToHtmlParams, defaultMarkdownToHtmlParams } from './tools/markdown-to-html/index.js';
export { htmlToMarkdown, type HtmlToMarkdownParams, defaultHtmlToMarkdownParams } from './tools/html-to-markdown/index.js';
export { textDiff, type TextDiffParams, defaultTextDiffParams } from './tools/text-diff/index.js';
export { wordCounter, type WordCounterParams, defaultWordCounterParams } from './tools/word-counter/index.js';
export { passwordGenerator, type PasswordGeneratorParams, defaultPasswordGeneratorParams } from './tools/password-generator/index.js';
export { uuidGenerator, type UuidGeneratorParams, defaultUuidGeneratorParams } from './tools/uuid-generator/index.js';

export { defaultTools, createDefaultRegistry } from './default-registry.js';

export { runDefaultChain } from './chain/run-default.js';
