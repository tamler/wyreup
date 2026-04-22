/**
 * Maps tool IDs to runner variant names.
 * Every tool in the registry must appear here exactly once.
 */
export type RunnerVariant =
  | 'SimpleImageRunner'
  | 'MultiInputRunner'
  | 'MultiOutputRunner'
  | 'JsonResultRunner'
  | 'TextResultRunner'
  | 'GenerateRunner'
  | 'PreviewRunner'
  | 'CompoundInterestRunner'
  | 'InvestmentDcaRunner'
  | 'PercentageCalculatorRunner'
  | 'DateCalculatorRunner';

export const VARIANT_MAP: Record<string, RunnerVariant> = {
  // SimpleImageRunner — single image in, single image out
  compress: 'SimpleImageRunner',
  convert: 'SimpleImageRunner',
  crop: 'SimpleImageRunner',
  resize: 'SimpleImageRunner',
  'rotate-image': 'SimpleImageRunner',
  'flip-image': 'SimpleImageRunner',
  grayscale: 'SimpleImageRunner',
  sepia: 'SimpleImageRunner',
  invert: 'SimpleImageRunner',
  'strip-exif': 'SimpleImageRunner',
  'image-watermark': 'SimpleImageRunner',
  'svg-to-png': 'SimpleImageRunner',
  favicon: 'SimpleImageRunner',

  // MultiInputRunner — multiple files in, single blob out
  'merge-pdf': 'MultiInputRunner',
  'image-to-pdf': 'MultiInputRunner',
  'image-diff': 'MultiInputRunner',

  // MultiOutputRunner — single file in, multiple blobs out
  'split-pdf': 'MultiOutputRunner',
  'pdf-to-image': 'MultiOutputRunner',

  // JsonResultRunner — any file in, JSON out
  hash: 'JsonResultRunner',
  'image-info': 'JsonResultRunner',
  'pdf-info': 'JsonResultRunner',
  'regex-tester': 'JsonResultRunner',
  'json-formatter': 'JsonResultRunner',
  'color-palette': 'JsonResultRunner',
  'word-counter': 'JsonResultRunner',
  'timestamp-converter': 'JsonResultRunner',
  'pdf-metadata': 'JsonResultRunner',
  'color-converter': 'JsonResultRunner',

  // TextResultRunner — any file in, text/html out
  ocr: 'TextResultRunner',
  'pdf-to-text': 'TextResultRunner',
  base64: 'TextResultRunner',
  'url-encoder': 'TextResultRunner',
  'markdown-to-html': 'TextResultRunner',
  'html-to-markdown': 'TextResultRunner',
  'text-diff': 'TextResultRunner',
  'pdf-extract-tables': 'TextResultRunner',

  // GenerateRunner — no input needed, generates output
  'uuid-generator': 'GenerateRunner',
  qr: 'GenerateRunner',
  'lorem-ipsum': 'GenerateRunner',
  'password-generator': 'GenerateRunner',

  // Finance runners — custom calculator UIs
  'compound-interest': 'CompoundInterestRunner',
  'investment-dca': 'InvestmentDcaRunner',
  'percentage-calculator': 'PercentageCalculatorRunner',
  'date-calculator': 'DateCalculatorRunner',

  // PreviewRunner — single file in, single blob out, prominent preview
  'face-blur': 'PreviewRunner',
  'audio-enhance': 'PreviewRunner',
  'pdf-redact': 'PreviewRunner',
  'pdf-crop': 'PreviewRunner',
  'pdf-extract-pages': 'PreviewRunner',
  'pdf-delete-pages': 'PreviewRunner',
  'pdf-compress': 'PreviewRunner',
  'pdf-encrypt': 'PreviewRunner',
  'pdf-decrypt': 'PreviewRunner',
  'rotate-pdf': 'PreviewRunner',
  'reorder-pdf': 'PreviewRunner',
  'page-numbers-pdf': 'PreviewRunner',
  'watermark-pdf': 'PreviewRunner',
};
