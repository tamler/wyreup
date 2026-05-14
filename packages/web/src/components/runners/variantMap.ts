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
  | 'PdfRedactRunner'
  | 'RecordAudioRunner'
  | 'ColorPaletteRunner'
  | 'ColorHarmonyRunner'
  | 'HashRunner'
  | 'ColorConverterRunner'
  | 'ImageInfoRunner'
  | 'PdfInfoRunner'
  | 'PdfMetadataRunner'
  | 'QrReaderRunner'
  | 'ImageSimilarityRunner'
  | 'TrimMediaRunner'
  | 'ZipInfoRunner'
  | 'ExcelInfoRunner'
  | 'VideoConcatRunner';

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

  // Bespoke visual runners for inspect/metadata tools — thumbnails,
  // stat cards, and per-row copy beat raw JSON for these.
  'image-info': 'ImageInfoRunner',
  'pdf-info': 'PdfInfoRunner',
  'pdf-metadata': 'PdfMetadataRunner',
  'qr-reader': 'QrReaderRunner',
  'image-similarity': 'ImageSimilarityRunner',

  // HashRunner — visual hash list (per-algo copy buttons)
  hash: 'HashRunner',
  // hmac — single file in + secret key + algo → JSON digest
  hmac: 'JsonResultRunner',
  // mime-detect — magic-byte sniff on file head → JSON report
  'mime-detect': 'JsonResultRunner',
  // file-fingerprint — comprehensive file identity bundle
  'file-fingerprint': 'JsonResultRunner',
  // csv-info — per-column type / null / distinct profile
  'csv-info': 'JsonResultRunner',
  'csv-to-json-schema': 'JsonResultRunner',
  // webhook-verify — payload file + provided signature → valid/invalid JSON
  'webhook-verify': 'JsonResultRunner',
  // webhook-replay — verify under one secret, re-sign under another
  'webhook-replay': 'JsonResultRunner',

  // ColorPaletteRunner — bespoke visual chips for the extracted palette
  'color-palette': 'ColorPaletteRunner',

  // ColorHarmonyRunner — live color theory schemes (chip-driven)
  'color-harmony': 'ColorHarmonyRunner',

  // TextResultRunner — file in, text/html out
  ocr: 'TextResultRunner',
  'pdf-to-text': 'TextResultRunner',
  base64: 'TextResultRunner',
  base32: 'TextResultRunner',
  'pdf-extract-tables': 'TextResultRunner',
  transcribe: 'TextResultRunner',
  'image-caption': 'TextResultRunner',
  'image-caption-detailed': 'TextResultRunner',

  // TwoTextInputRunner — two side-by-side textareas, output anything
  'text-diff': 'TwoTextInputRunner',
  'text-diff-levenshtein': 'TwoTextInputRunner',
  'json-diff': 'TwoTextInputRunner',
  'json-schema-validate': 'TwoTextInputRunner',

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
  'unicode-info': 'TextInputRunner',
  'text-frequency': 'TextInputRunner',
  'morse-code': 'TextInputRunner',
  'text-confusable': 'TextInputRunner',
  // text-redact emits both the redacted text and a counts report
  'text-redact': 'MultiOutputRunner',
  slug: 'TextInputRunner',
  'case-converter': 'TextInputRunner',
  'regex-tester': 'TextInputRunner',
  'url-encoder': 'TextInputRunner',
  'jwt-decoder': 'TextInputRunner',
  'cron-parser': 'TextInputRunner',
  'number-base-converter': 'TextInputRunner',
  'timestamp-converter': 'TextInputRunner',
  // color-converter is bespoke: live swatch + every format with copies
  'color-converter': 'ColorConverterRunner',
  'json-formatter': 'TextInputRunner',
  'css-formatter': 'TextInputRunner',
  'html-formatter': 'TextInputRunner',
  'sql-formatter': 'TextInputRunner',
  'xml-formatter': 'TextInputRunner',
  'markdown-to-html': 'TextInputRunner',
  'markdown-toc': 'TextInputRunner',
  'markdown-frontmatter': 'TextInputRunner',
  'html-to-markdown': 'TextInputRunner',
  'html-clean': 'TextInputRunner',
  'html-extract-links': 'TextInputRunner',
  'word-counter': 'TextInputRunner',
  'json-yaml': 'TextInputRunner',
  'json-flatten': 'TextInputRunner',
  'json-unflatten': 'TextInputRunner',
  'json-path': 'TextInputRunner',
  'yaml-validate': 'TextInputRunner',
  'json-schema-infer': 'TextInputRunner',

  // GenerateRunner — no input needed, generates output
  'uuid-generator': 'GenerateRunner',
  qr: 'GenerateRunner',
  'lorem-ipsum': 'GenerateRunner',
  'password-generator': 'GenerateRunner',
  barcode: 'GenerateRunner',
  'backup-codes': 'GenerateRunner',
  // otpauth-uri produces both JSON metadata and an optional QR PNG;
  // MultiOutputRunner shows the URI text and the QR image side by side.
  'otpauth-uri': 'MultiOutputRunner',

  // No-input tools that emit JSON/text — JsonResultRunner skips the dropzone
  // when tool.input.min === 0.
  calculator: 'JsonResultRunner',
  'unit-converter': 'JsonResultRunner',
  'color-contrast': 'JsonResultRunner',
  'password-strength': 'JsonResultRunner',
  'roman-numeral': 'JsonResultRunner',
  'totp-code': 'JsonResultRunner',
  'hotp-code': 'JsonResultRunner',
  'url-parse': 'JsonResultRunner',
  'url-build': 'JsonResultRunner',
  'signed-url': 'JsonResultRunner',
  'jwt-sign': 'JsonResultRunner',

  // Finance runners — custom calculator UIs
  'compound-interest': 'CompoundInterestRunner',
  'investment-dca': 'InvestmentDcaRunner',
  'percentage-calculator': 'PercentageCalculatorRunner',
  'date-calculator': 'DateCalculatorRunner',

  // PdfRedactRunner — bespoke canvas-overlay UI for drawing redaction rectangles
  'pdf-redact': 'PdfRedactRunner',

  // Capture tools — interactive primitives that produce a fresh asset
  'record-audio': 'RecordAudioRunner',

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

  // ffmpeg — single video/audio in, media out (mime-aware preview)
  'compress-video': 'PreviewRunner',
  'convert-video': 'PreviewRunner',
  'convert-audio': 'PreviewRunner',
  'extract-audio': 'PreviewRunner',
  'trim-media': 'TrimMediaRunner',
  'video-add-text': 'PreviewRunner',
  'video-color-correct': 'PreviewRunner',
  'video-speed': 'PreviewRunner',
  'video-to-gif': 'PreviewRunner',
  'html-to-pdf': 'PreviewRunner',
  'pgp-decrypt': 'PreviewRunner',
  'json-to-excel': 'PreviewRunner',

  // ffmpeg multi-input
  'burn-subtitles': 'MultiInputRunner',
  'video-concat': 'VideoConcatRunner',
  'video-crossfade': 'MultiInputRunner',
  'video-overlay-image': 'MultiInputRunner',

  // ZIP / archive
  'zip-create': 'MultiInputRunner',
  'zip-extract': 'MultiOutputRunner',
  'zip-info': 'ZipInfoRunner',
  'pdf-extract-images': 'PreviewRunner',

  // PGP — text-out variants get the text result; verify gets JSON
  'pgp-encrypt': 'TextResultRunner',
  'pgp-sign': 'TextResultRunner',
  'pgp-verify': 'MultiInputRunner',

  // Spreadsheets / CSV
  'csv-json': 'TextResultRunner',
  'csv-deduplicate': 'MultiOutputRunner',
  'csv-merge': 'MultiInputRunner',
  'csv-diff': 'MultiInputRunner',
  'frontmatter-to-csv': 'MultiInputRunner',
  'csv-to-excel': 'MultiInputRunner',
  'excel-info': 'ExcelInfoRunner',
  'excel-to-csv': 'TextResultRunner',
  'excel-to-json': 'JsonResultRunner',
  'merge-workbooks': 'MultiInputRunner',
  'split-sheets': 'MultiOutputRunner',
  'convert-subtitles': 'TextResultRunner',

  // ML — single image in, single image/text out
  'bg-remove': 'SimpleImageRunner',
  'upscale-2x': 'SimpleImageRunner',
  'ocr-pro': 'TextResultRunner',
  'svg-optimizer': 'SimpleImageRunner',

  // Geospatial — text-formatted vector data (geojson, kml, gpx) renders
  // well as a TextResultRunner (preview + copy + download). The catch-all
  // and the zip-output shapefile go through PreviewRunner so binary
  // formats (gpkg, fgb, zip) get a proper download UX.
  'csv-to-geojson': 'TextResultRunner',
  'kml-to-geojson': 'TextResultRunner',
  'geojson-to-kml': 'TextResultRunner',
  'gpx-to-geojson': 'TextResultRunner',
  'gpx-to-kml': 'TextResultRunner',
  'shapefile-to-geojson': 'TextResultRunner',
  'convert-geo': 'PreviewRunner',
};
