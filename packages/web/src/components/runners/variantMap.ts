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
  | 'TextInputRunner'
  | 'TwoTextInputRunner'
  | 'GenerateRunner'
  | 'PreviewRunner'
  | 'CompoundInterestRunner'
  | 'InvestmentDcaRunner'
  | 'PercentageCalculatorRunner'
  | 'DateCalculatorRunner'
  | 'PdfRedactRunner';

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

  // JsonResultRunner — file in, JSON out
  hash: 'JsonResultRunner',
  'image-info': 'JsonResultRunner',
  'pdf-info': 'JsonResultRunner',
  'color-palette': 'JsonResultRunner',
  'pdf-metadata': 'JsonResultRunner',

  // TextResultRunner — file in, text/html out
  ocr: 'TextResultRunner',
  'pdf-to-text': 'TextResultRunner',
  base64: 'TextResultRunner',
  'pdf-extract-tables': 'TextResultRunner',
  transcribe: 'TextResultRunner',
  'image-caption': 'TextResultRunner',

  // TwoTextInputRunner — two side-by-side textareas, output anything
  'text-diff': 'TwoTextInputRunner',
  'text-diff-levenshtein': 'TwoTextInputRunner',

  // TextInputRunner — type text in, any output. The default for tools
  // where the user is going to TYPE/PASTE rather than upload a .txt file.
  'text-translate': 'TextInputRunner',
  'text-summarize': 'TextInputRunner',
  'text-sentiment': 'TextInputRunner',
  'text-ner': 'TextInputRunner',
  'text-readability': 'TextInputRunner',
  'text-stats': 'TextInputRunner',
  'text-escape': 'TextInputRunner',
  'text-embed': 'TextInputRunner',
  'token-count': 'TextInputRunner',
  'unicode-normalize': 'TextInputRunner',
  slug: 'TextInputRunner',
  'case-converter': 'TextInputRunner',
  'regex-tester': 'TextInputRunner',
  'url-encoder': 'TextInputRunner',
  'jwt-decoder': 'TextInputRunner',
  'cron-parser': 'TextInputRunner',
  'number-base-converter': 'TextInputRunner',
  'timestamp-converter': 'TextInputRunner',
  'color-converter': 'TextInputRunner',
  'json-formatter': 'TextInputRunner',
  'css-formatter': 'TextInputRunner',
  'html-formatter': 'TextInputRunner',
  'sql-formatter': 'TextInputRunner',
  'xml-formatter': 'TextInputRunner',
  'markdown-to-html': 'TextInputRunner',
  'html-to-markdown': 'TextInputRunner',
  'word-counter': 'TextInputRunner',
  'json-yaml': 'TextInputRunner',

  // GenerateRunner — no input needed, generates output
  'uuid-generator': 'GenerateRunner',
  qr: 'GenerateRunner',
  'lorem-ipsum': 'GenerateRunner',
  'password-generator': 'GenerateRunner',
  barcode: 'GenerateRunner',

  // No-input tools that emit JSON/text — JsonResultRunner skips the dropzone
  // when tool.input.min === 0.
  calculator: 'JsonResultRunner',
  'unit-converter': 'JsonResultRunner',

  // Finance runners — custom calculator UIs
  'compound-interest': 'CompoundInterestRunner',
  'investment-dca': 'InvestmentDcaRunner',
  'percentage-calculator': 'PercentageCalculatorRunner',
  'date-calculator': 'DateCalculatorRunner',

  // PdfRedactRunner — bespoke canvas-overlay UI for drawing redaction rectangles
  'pdf-redact': 'PdfRedactRunner',

  // PreviewRunner — single file in, single blob out, prominent preview
  'face-blur': 'PreviewRunner',
  'audio-enhance': 'PreviewRunner',
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
