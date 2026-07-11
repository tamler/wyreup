import { createRegistry, type ToolRegistry } from './registry.js';
import { CURATED_CHAIN_SUGGESTIONS } from './chain/curated-suggestions.js';
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
import { transcribePro } from './tools/transcribe-pro/index.js';
import { textSentences } from './tools/text-sentences/index.js';
import { textKeywords } from './tools/text-keywords/index.js';
import { textDates } from './tools/text-dates/index.js';
import { docxToText } from './tools/docx-to-text/index.js';
import { extractArticleText } from './tools/extract-article-text/index.js';
import { pdfFlatten } from './tools/pdf-flatten/index.js';
import { pdfFormFields } from './tools/pdf-form-fields/index.js';
import { zipRemove } from './tools/zip-remove/index.js';
import { zipFlatten } from './tools/zip-flatten/index.js';
import { textSummarizePro } from './tools/text-summarize-pro/index.js';
import { textTranslatePro } from './tools/text-translate-pro/index.js';
import { textSentimentPro } from './tools/text-sentiment-pro/index.js';
import { textNerPro } from './tools/text-ner-pro/index.js';
import { textRedactPro } from './tools/text-redact-pro/index.js';
import { bgRemovePro } from './tools/bg-remove-pro/index.js';
import { upscale2xPro } from './tools/upscale-2x-pro/index.js';
import { ocrHq } from './tools/ocr-hq/index.js';
import { imageDescribe } from './tools/image-describe/index.js';
import { analyzeChart } from './tools/analyze-chart/index.js';
import { imageQandA } from './tools/image-q-and-a/index.js';
import { readHandwriting } from './tools/read-handwriting/index.js';
import { detectObjects } from './tools/detect-objects/index.js';
import { translateImage } from './tools/translate-image/index.js';
import { transcribeAndTranslate } from './tools/transcribe-and-translate/index.js';
import { regexFromTextPro } from './tools/regex-from-text-pro/index.js';
import { cronFromTextPro } from './tools/cron-from-text-pro/index.js';
import { pdfSummarize } from './tools/pdf-summarize/index.js';
import { pdfQandA } from './tools/pdf-q-and-a/index.js';
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
import { convertGeo } from './tools/convert-geo/index.js';
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
import { resizeVideo } from './tools/resize-video/index.js';
import { muteVideo } from './tools/mute-video/index.js';
import { rotateVideo } from './tools/rotate-video/index.js';
import { extractFrame } from './tools/extract-frame/index.js';
import { replaceAudio } from './tools/replace-audio/index.js';
import { normalizeLoudness } from './tools/normalize-loudness/index.js';
import { analyzeLoudness } from './tools/analyze-loudness/index.js';
import { videoQualityMetrics } from './tools/video-quality-metrics/index.js';
import { cropVideo } from './tools/crop-video/index.js';
import { reverseVideo } from './tools/reverse-video/index.js';
import { videoVolume } from './tools/video-volume/index.js';
import { loopVideo } from './tools/loop-video/index.js';
import { stripVideoMetadata } from './tools/strip-video-metadata/index.js';
import { fadeVideo } from './tools/fade-video/index.js';
import { vignetteVideo } from './tools/vignette-video/index.js';
import { letterboxVideo } from './tools/letterbox-video/index.js';
import { mixAudio } from './tools/mix-audio/index.js';
import { videoSideBySide } from './tools/video-side-by-side/index.js';
import { excelToCsv } from './tools/excel-to-csv/index.js';
import { excelToJson } from './tools/excel-to-json/index.js';
import { csvToExcel } from './tools/csv-to-excel/index.js';
import { jsonToExcel } from './tools/json-to-excel/index.js';
import { excelInfo } from './tools/excel-info/index.js';
import { mergeWorkbooks } from './tools/merge-workbooks/index.js';
import { splitSheets } from './tools/split-sheets/index.js';
import { htmlToPdf } from './tools/html-to-pdf/index.js';
import { barcode } from './tools/barcode/index.js';
import { unicodeInfo } from './tools/unicode-info/index.js';
import { hmac } from './tools/hmac/index.js';
import { markdownToc } from './tools/markdown-toc/index.js';
import { colorContrast } from './tools/color-contrast/index.js';
import { passwordStrength } from './tools/password-strength/index.js';
import { textFrequency } from './tools/text-frequency/index.js';
import { base32 } from './tools/base32/index.js';
import { jsonDiff } from './tools/json-diff/index.js';
import { morseCode } from './tools/morse-code/index.js';
import { romanNumeral } from './tools/roman-numeral/index.js';
import { mimeDetect } from './tools/mime-detect/index.js';
import { totpCode } from './tools/totp-code/index.js';
import { urlParse } from './tools/url-parse/index.js';
import { markdownFrontmatter } from './tools/markdown-frontmatter/index.js';
import { htmlClean } from './tools/html-clean/index.js';
import { hotpCode } from './tools/hotp-code/index.js';
import { jwtSign } from './tools/jwt-sign/index.js';
import { webhookVerify } from './tools/webhook-verify/index.js';
import { urlBuild } from './tools/url-build/index.js';
import { csvDeduplicate } from './tools/csv-deduplicate/index.js';
import { csvMerge } from './tools/csv-merge/index.js';
import { signedUrl } from './tools/signed-url/index.js';
import { backupCodes } from './tools/backup-codes/index.js';
import { csvDiff } from './tools/csv-diff/index.js';
import { csvSort } from './tools/csv-sort/index.js';
import { csvFilter } from './tools/csv-filter/index.js';
import { diffApply } from './tools/diff-apply/index.js';
import { ocrSuspicious } from './tools/ocr-suspicious/index.js';
import { htmlRedact } from './tools/html-redact/index.js';
import { openapiReport } from './tools/openapi-report/index.js';
import { jsonFlatten } from './tools/json-flatten/index.js';
import { jsonUnflatten } from './tools/json-unflatten/index.js';
import { otpauthUri } from './tools/otpauth-uri/index.js';
import { webhookReplay } from './tools/webhook-replay/index.js';
import { fileFingerprint } from './tools/file-fingerprint/index.js';
import { jsonSchemaValidate } from './tools/json-schema-validate/index.js';
import { textConfusable } from './tools/text-confusable/index.js';
import { frontmatterToCsv } from './tools/frontmatter-to-csv/index.js';
import { yamlValidate } from './tools/yaml-validate/index.js';
import { jsonSchemaInfer } from './tools/json-schema-infer/index.js';
import { textRedact } from './tools/text-redact/index.js';
import { htmlExtractLinks } from './tools/html-extract-links/index.js';
import { pdfExtractImages } from './tools/pdf-extract-images/index.js';
import { csvInfo } from './tools/csv-info/index.js';
import { csvToJsonSchema } from './tools/csv-to-json-schema/index.js';
import { jsonPath } from './tools/json-path/index.js';
import { urlShortenLocal } from './tools/url-shorten-local/index.js';
import { textStatsByParagraph } from './tools/text-stats-by-paragraph/index.js';
import { faviconFromUrl } from './tools/favicon-from-url/index.js';
import { colorBlindSimulator } from './tools/color-blind-simulator/index.js';
import { base58 } from './tools/base58/index.js';
import { xmlToJson } from './tools/xml-to-json/index.js';
import { jsonToXml } from './tools/json-to-xml/index.js';
import { cssMinify } from './tools/css-minify/index.js';
import { htmlMinify } from './tools/html-minify/index.js';
import { apiKeyFormat } from './tools/api-key-format/index.js';
import { licenseKey } from './tools/license-key/index.js';
import { textTemplate } from './tools/text-template/index.js';
import { pgpArmor } from './tools/pgp-armor/index.js';
import { signedCookieDecode } from './tools/signed-cookie-decode/index.js';
import { textSuspicious } from './tools/text-suspicious/index.js';
import { openapiValidate } from './tools/openapi-validate/index.js';
import { packageJsonValidate } from './tools/package-json-validate/index.js';
import { jsonMerge } from './tools/json-merge/index.js';
import { csvTemplate } from './tools/csv-template/index.js';
import { pdfSuspicious } from './tools/pdf-suspicious/index.js';
import { regexVisualize } from './tools/regex-visualize/index.js';
import { regexFromText } from './tools/regex-from-text/index.js';
import { cronFromText } from './tools/cron-from-text/index.js';
import { sqlFormatExplain } from './tools/sql-format-explain/index.js';
import { regexExplain } from './tools/regex-explain/index.js';
import { imageToAsciiArt } from './tools/image-to-ascii/index.js';
import { promptInjectionDemo } from './tools/prompt-injection-demo/index.js';
import { pdfExtractData } from './tools/pdf-extract-data/index.js';
// Wave 1 — Workers AI expansion (2026-05-22)
import { textToSpeechPro } from './tools/text-to-speech-pro/index.js';
import { contentSafetyPro } from './tools/content-safety-pro/index.js';
import { translateManyPro } from './tools/translate-many-pro/index.js';
import { deepAnalysisPro } from './tools/deep-analysis-pro/index.js';
import { fixGrammarPro } from './tools/fix-grammar-pro/index.js';
import { rewriteTonePro } from './tools/rewrite-tone-pro/index.js';
import { chatLongPdfPro } from './tools/chat-long-pdf-pro/index.js';
import { imageGeneratePro } from './tools/image-generate-pro/index.js';
import { jsonExtractPro } from './tools/json-extract-pro/index.js';
import { translateIndicPro } from './tools/translate-indic-pro/index.js';
import { csvSql } from './tools/csv-sql/index.js';
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
  transcribePro,
  textSentences,
  textKeywords,
  textDates,
  docxToText,
  extractArticleText,
  pdfFlatten,
  pdfFormFields,
  zipRemove,
  zipFlatten,
  textSummarizePro,
  textTranslatePro,
  textSentimentPro,
  textNerPro,
  textRedactPro,
  bgRemovePro,
  upscale2xPro,
  ocrHq,
  imageDescribe,
  analyzeChart,
  imageQandA,
  readHandwriting,
  detectObjects,
  translateImage,
  transcribeAndTranslate,
  regexFromTextPro,
  cronFromTextPro,
  pdfSummarize,
  pdfQandA,
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
  convertGeo,
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
  resizeVideo,
  muteVideo,
  rotateVideo,
  extractFrame,
  replaceAudio,
  normalizeLoudness,
  analyzeLoudness,
  videoQualityMetrics,
  cropVideo,
  reverseVideo,
  videoVolume,
  loopVideo,
  stripVideoMetadata,
  fadeVideo,
  vignetteVideo,
  letterboxVideo,
  mixAudio,
  videoSideBySide,
  excelToCsv,
  excelToJson,
  csvToExcel,
  jsonToExcel,
  excelInfo,
  mergeWorkbooks,
  splitSheets,
  htmlToPdf,
  barcode,
  unicodeInfo,
  hmac,
  markdownToc,
  colorContrast,
  passwordStrength,
  textFrequency,
  base32,
  jsonDiff,
  morseCode,
  romanNumeral,
  mimeDetect,
  totpCode,
  urlParse,
  markdownFrontmatter,
  htmlClean,
  hotpCode,
  jwtSign,
  webhookVerify,
  urlBuild,
  csvDeduplicate,
  csvMerge,
  signedUrl,
  backupCodes,
  csvDiff,
  csvSort,
  csvFilter,
  diffApply,
  ocrSuspicious,
  htmlRedact,
  openapiReport,
  jsonFlatten,
  jsonUnflatten,
  otpauthUri,
  webhookReplay,
  fileFingerprint,
  jsonSchemaValidate,
  textConfusable,
  frontmatterToCsv,
  yamlValidate,
  jsonSchemaInfer,
  textRedact,
  htmlExtractLinks,
  pdfExtractImages,
  csvInfo,
  csvToJsonSchema,
  jsonPath,
  urlShortenLocal,
  textStatsByParagraph,
  faviconFromUrl,
  colorBlindSimulator,
  base58,
  xmlToJson,
  jsonToXml,
  cssMinify,
  htmlMinify,
  apiKeyFormat,
  licenseKey,
  textTemplate,
  pgpArmor,
  signedCookieDecode,
  textSuspicious,
  openapiValidate,
  packageJsonValidate,
  jsonMerge,
  csvTemplate,
  pdfSuspicious,
  regexVisualize,
  regexFromText,
  cronFromText,
  sqlFormatExplain,
  regexExplain,
  imageToAsciiArt,
  promptInjectionDemo,
  pdfExtractData,
  // Wave 1 — Workers AI expansion (2026-05-22)
  textToSpeechPro,
  contentSafetyPro,
  translateManyPro,
  deepAnalysisPro,
  fixGrammarPro,
  rewriteTonePro,
  chatLongPdfPro,
  imageGeneratePro,
  jsonExtractPro,
  translateIndicPro,
  csvSql,
];

export function createDefaultRegistry(): ToolRegistry {
  // Fill in curated next-step suggestions (phase-1 tool review) for tools
  // that don't declare their own. Copies, not mutations, so the tool
  // module singletons stay pristine for direct importers.
  const tools = (defaultTools as ToolModule[]).map((t) => {
    if (t.chainSuggestions?.length) return t;
    const curated = CURATED_CHAIN_SUGGESTIONS[t.id];
    return curated?.length ? { ...t, chainSuggestions: [...curated] } : t;
  });
  return createRegistry(tools);
}
