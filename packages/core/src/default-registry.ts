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
import { faceBlur } from './tools/face-blur/index.js';
import { audioEnhance } from './tools/audio-enhance/index.js';
import { transcribe } from './tools/transcribe/index.js';
import { imageCaption } from './tools/image-caption/index.js';
import { imageCaptionDetailed } from './tools/image-caption-detailed/index.js';
import { recordAudio } from './tools/record-audio/index.js';
import { colorHarmony } from './tools/color-harmony/index.js';
import { csvJson } from './tools/csv-json/index.js';
import { csvToGeojson } from './tools/csv-to-geojson/index.js';
import { kmlToGeojson } from './tools/kml-to-geojson/index.js';
import { geojsonToKml } from './tools/geojson-to-kml/index.js';
import { gpxToGeojson } from './tools/gpx-to-geojson/index.js';
import { gpxToKml } from './tools/gpx-to-kml/index.js';
import { shapefileToGeojson } from './tools/shapefile-to-geojson/index.js';
import { caseConverter } from './tools/case-converter/index.js';
import { slug } from './tools/slug/index.js';
import { jsonYaml } from './tools/json-yaml/index.js';
import { numberBaseConverter } from './tools/number-base-converter/index.js';
import { jwtDecoder } from './tools/jwt-decoder/index.js';
import { sqlFormatter } from './tools/sql-formatter/index.js';
import { xmlFormatter } from './tools/xml-formatter/index.js';
import { htmlFormatter } from './tools/html-formatter/index.js';
import { cssFormatter } from './tools/css-formatter/index.js';
import { cronParser } from './tools/cron-parser/index.js';
import { qrReader } from './tools/qr-reader/index.js';
import { svgOptimizer } from './tools/svg-optimizer/index.js';
import { calculator } from './tools/calculator/index.js';
import { unitConverter } from './tools/unit-converter/index.js';
import { percentageCalculator } from './tools/percentage-calculator/index.js';
import { dateCalculator } from './tools/date-calculator/index.js';
import { compoundInterest } from './tools/compound-interest/index.js';
import { investmentDca } from './tools/investment-dca/index.js';
import { convertAudio } from './tools/convert-audio/index.js';
import { convertVideo } from './tools/convert-video/index.js';
import { extractAudio } from './tools/extract-audio/index.js';
import { trimMedia } from './tools/trim-media/index.js';
import { compressVideo } from './tools/compress-video/index.js';
import { videoToGif } from './tools/video-to-gif/index.js';
import { convertSubtitles } from './tools/convert-subtitles/index.js';
import { burnSubtitles } from './tools/burn-subtitles/index.js';
import { pgpEncrypt } from './tools/pgp-encrypt/index.js';
import { pgpDecrypt } from './tools/pgp-decrypt/index.js';
import { pgpSign } from './tools/pgp-sign/index.js';
import { pgpVerify } from './tools/pgp-verify/index.js';
import { zipCreate } from './tools/zip-create/index.js';
import { zipExtract } from './tools/zip-extract/index.js';
import { zipInfo } from './tools/zip-info/index.js';
import { bgRemove } from './tools/bg-remove/index.js';
import { upscale2x } from './tools/upscale-2x/index.js';
import { ocrPro } from './tools/ocr-pro/index.js';
import { imageSimilarity } from './tools/image-similarity/index.js';
import { textSentiment } from './tools/text-sentiment/index.js';
import { textNer } from './tools/text-ner/index.js';
import { textSummarize } from './tools/text-summarize/index.js';
import { textTranslate } from './tools/text-translate/index.js';
import { textEmbed } from './tools/text-embed/index.js';
import { textReadability } from './tools/text-readability/index.js';
import { textStats } from './tools/text-stats/index.js';
import { tokenCount } from './tools/token-count/index.js';
import { textDiffLevenshtein } from './tools/text-diff-levenshtein/index.js';
import { unicodeNormalize } from './tools/unicode-normalize/index.js';
import { textEscape } from './tools/text-escape/index.js';
import { videoConcat } from './tools/video-concat/index.js';
import { videoAddText } from './tools/video-add-text/index.js';
import { videoSpeed } from './tools/video-speed/index.js';
import { videoOverlayImage } from './tools/video-overlay-image/index.js';
import { videoCrossfade } from './tools/video-crossfade/index.js';
import { videoColorCorrect } from './tools/video-color-correct/index.js';
import { excelToCsv } from './tools/excel-to-csv/index.js';
import { excelToJson } from './tools/excel-to-json/index.js';
import { csvToExcel } from './tools/csv-to-excel/index.js';
import { jsonToExcel } from './tools/json-to-excel/index.js';
import { excelInfo } from './tools/excel-info/index.js';
import { mergeWorkbooks } from './tools/merge-workbooks/index.js';
import { splitSheets } from './tools/split-sheets/index.js';
import { htmlToPdf } from './tools/html-to-pdf/index.js';
import { barcode } from './tools/barcode/index.js';
import type { ToolModule } from './types.js';

/**
 * All first-party Wyreup tools, in presentation order.
 * Typed as ToolModule<any> because TypeScript's function parameter
 * contravariance makes it hard to hold Params-parameterized tools in
 * a single heterogeneous array without losing type safety on each one.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  faceBlur,
  audioEnhance,
  transcribe,
  imageCaption,
  imageCaptionDetailed,
  recordAudio,
  colorHarmony,
  csvJson,
  csvToGeojson,
  kmlToGeojson,
  geojsonToKml,
  gpxToGeojson,
  gpxToKml,
  shapefileToGeojson,
  caseConverter,
  slug,
  jsonYaml,
  numberBaseConverter,
  jwtDecoder,
  sqlFormatter,
  xmlFormatter,
  htmlFormatter,
  cssFormatter,
  cronParser,
  qrReader,
  svgOptimizer,
  calculator,
  unitConverter,
  percentageCalculator,
  dateCalculator,
  compoundInterest,
  investmentDca,
  convertAudio,
  convertVideo,
  extractAudio,
  trimMedia,
  compressVideo,
  videoToGif,
  convertSubtitles,
  burnSubtitles,
  pgpEncrypt,
  pgpDecrypt,
  pgpSign,
  pgpVerify,
  zipCreate,
  zipExtract,
  zipInfo,
  bgRemove,
  upscale2x,
  ocrPro,
  imageSimilarity,
  textSentiment,
  textNer,
  textSummarize,
  textTranslate,
  textEmbed,
  textReadability,
  textStats,
  tokenCount,
  textDiffLevenshtein,
  unicodeNormalize,
  textEscape,
  videoConcat,
  videoAddText,
  videoSpeed,
  videoOverlayImage,
  videoCrossfade,
  videoColorCorrect,
  excelToCsv,
  excelToJson,
  csvToExcel,
  jsonToExcel,
  excelInfo,
  mergeWorkbooks,
  splitSheets,
  htmlToPdf,
  barcode,
];

export function createDefaultRegistry(): ToolRegistry {
  return createRegistry(defaultTools as ToolModule[]);
}
