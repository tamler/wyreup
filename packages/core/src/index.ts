// Wyreup core — tool library public API

export const WYREUP_CORE_VERSION = '0.0.0';

export type {
  ToolModule,
  ToolCategory,
  ToolInputSpec,
  ToolOutputSpec,
  ToolProgress,
  ToolRunContext,
  MemoryEstimate,
  MimePattern,
  ToolRequires,
  ParamFieldSchema,
  ParamSchema,
  Surface,
  ToolSeoContent,
} from './types.js';

export {
  runChain,
  MAX_CHAIN_DEPTH,
  ChainError,
  type Chain,
  type ChainStep,
} from './chain/engine.js';

export type { SavedChain } from './chain/types.js';

export { detectCycle } from './chain/cycle.js';

export {
  validateChain,
  type ChainValidationResult,
} from './chain/validate.js';

// Trigger rules — declarative MIME → saved-chain bindings. Every
// consumer must implement preview-before-run per docs/triggers-security.md.
export type {
  TriggerRule,
  TriggerKit,
  FireRecord,
  MatchOutcome,
  PreflightVerdict,
  PreflightFinding,
  PreflightResult,
  FileHeader,
} from './triggers/index.js';
export {
  TRIGGER_KIT_VERSION,
  DEFAULT_RATE_LIMIT,
  MAX_RATE_LIMIT,
  parseTriggerKit,
  serializeTriggerKit,
  updateTriggerRule,
  strippedForImport,
  matchRule,
  pruneFires,
  runPreflight,
  readFileHeader,
} from './triggers/index.js';

export { createRegistry, mimeMatches, couldFlowTo, toolRunsOnSurface, type ToolRegistry } from './registry.js';

export { getRuntimeAdapter, type RuntimeAdapter } from './runtime/types.js';

export { detectFormat, getCodec, type ImageFormat, type Codec } from './lib/codecs.js';
export { clearPipelineCache } from './lib/transformers.js';
export { parseRangeSpec } from './lib/pdf-ranges.js';
export {
  detectCapabilities,
  checkToolCapabilities,
  type Capabilities,
  type CapabilityCheck,
} from './lib/capabilities.js';

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
export { pdfToImage, type PdfToImageParams } from './tools/pdf-to-image/index.js';
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
export { ocr, type OcrParams, defaultOcrParams } from './tools/ocr/index.js';
export { svgToPng, type SvgToPngParams, defaultSvgToPngParams } from './tools/svg-to-png/index.js';
export { timestampConverter, type TimestampConverterParams, defaultTimestampConverterParams } from './tools/timestamp-converter/index.js';
export { loremIpsum, type LoremIpsumParams, defaultLoremIpsumParams } from './tools/lorem-ipsum/index.js';
export { regexTester, type RegexTesterParams, defaultRegexTesterParams } from './tools/regex-tester/index.js';
export { pdfExtractPages, type PdfExtractPagesParams } from './tools/pdf-extract-pages/index.js';
export { pdfDeletePages, type PdfDeletePagesParams } from './tools/pdf-delete-pages/index.js';
export { pdfCompress, type PdfCompressParams } from './tools/pdf-compress/index.js';
export { pdfEncrypt, type PdfEncryptParams, type PdfEncryptPermissions } from './tools/pdf-encrypt/index.js';
export { pdfDecrypt, type PdfDecryptParams } from './tools/pdf-decrypt/index.js';
export { pdfRedact, type PdfRedactParams, type PdfRedactRectangle } from './tools/pdf-redact/index.js';
export { pdfMetadata, type PdfMetadataParams, type PdfMetadataWriteFields } from './tools/pdf-metadata/index.js';
export { pdfExtractTables, type PdfExtractTablesParams, type TableRow } from './tools/pdf-extract-tables/index.js';
export { pdfCrop, type PdfCropParams, type PdfCropBox, type PdfCropBoxPerPage } from './tools/pdf-crop/index.js';
export { faceBlur, type FaceBlurParams, defaultFaceBlurParams } from './tools/face-blur/index.js';
export { audioEnhance, type AudioEnhanceParams, defaultAudioEnhanceParams } from './tools/audio-enhance/index.js';
export { transcribe, type TranscribeParams, defaultTranscribeParams } from './tools/transcribe/index.js';
export { imageCaption, type ImageCaptionParams, defaultImageCaptionParams } from './tools/image-caption/index.js';
export { imageCaptionDetailed, type ImageCaptionDetailedParams, defaultImageCaptionDetailedParams } from './tools/image-caption-detailed/index.js';
export { recordAudio, type RecordAudioParams, defaultRecordAudioParams } from './tools/record-audio/index.js';
export { colorHarmony, type ColorHarmonyParams, defaultColorHarmonyParams, type HarmonyScheme, type ColorHarmonyResult } from './tools/color-harmony/index.js';
export { csvJson, type CsvJsonParams, defaultCsvJsonParams } from './tools/csv-json/index.js';
export { caseConverter, type CaseConverterParams, defaultCaseConverterParams } from './tools/case-converter/index.js';
export { slug, type SlugParams, defaultSlugParams } from './tools/slug/index.js';
export { jsonYaml, type JsonYamlParams, defaultJsonYamlParams } from './tools/json-yaml/index.js';
export { numberBaseConverter, type NumberBaseConverterParams, type NumberBaseResult, defaultNumberBaseConverterParams } from './tools/number-base-converter/index.js';
export { jwtDecoder, type JwtDecoderParams, type JwtDecoderResult, defaultJwtDecoderParams } from './tools/jwt-decoder/index.js';
export { sqlFormatter, type SqlFormatterParams, defaultSqlFormatterParams } from './tools/sql-formatter/index.js';
export { xmlFormatter, type XmlFormatterParams, defaultXmlFormatterParams } from './tools/xml-formatter/index.js';
export { htmlFormatter, type HtmlFormatterParams, defaultHtmlFormatterParams } from './tools/html-formatter/index.js';
export { cssFormatter, type CssFormatterParams, defaultCssFormatterParams } from './tools/css-formatter/index.js';
export { cronParser, type CronParserParams, type CronParserResult, defaultCronParserParams } from './tools/cron-parser/index.js';
export { qrReader, type QrReaderParams, type QrReaderResult, defaultQrReaderParams } from './tools/qr-reader/index.js';
export { svgOptimizer, type SvgOptimizerParams, defaultSvgOptimizerParams } from './tools/svg-optimizer/index.js';
export { calculator, type CalculatorParams, defaultCalculatorParams } from './tools/calculator/index.js';
export { unitConverter, type UnitConverterParams, defaultUnitConverterParams } from './tools/unit-converter/index.js';
export { percentageCalculator, type PercentageCalculatorParams, defaultPercentageCalculatorParams } from './tools/percentage-calculator/index.js';
export { dateCalculator, type DateCalculatorParams, defaultDateCalculatorParams } from './tools/date-calculator/index.js';
export { compoundInterest, type CompoundInterestParams, defaultCompoundInterestParams } from './tools/compound-interest/index.js';
export { investmentDca, type InvestmentDcaParams, defaultInvestmentDcaParams } from './tools/investment-dca/index.js';
export { convertAudio, type ConvertAudioParams, defaultConvertAudioParams, type AudioFormat, getAudioCodec, getAudioMime } from './tools/convert-audio/index.js';
export { convertVideo, type ConvertVideoParams, defaultConvertVideoParams, type VideoFormat, type VideoPreset, getVideoMime } from './tools/convert-video/index.js';
export { extractAudio, type ExtractAudioParams, defaultExtractAudioParams, type ExtractAudioFormat, getExtractCodec, getExtractMime } from './tools/extract-audio/index.js';
export { trimMedia, type TrimMediaParams, defaultTrimMediaParams } from './tools/trim-media/index.js';
export { compressVideo, type CompressVideoParams, defaultCompressVideoParams } from './tools/compress-video/index.js';
export { videoToGif, type VideoToGifParams, defaultVideoToGifParams, buildGifArgs } from './tools/video-to-gif/index.js';
export { convertSubtitles, type ConvertSubtitlesParams, defaultConvertSubtitlesParams, type SubtitleFormat, detectSubtitleFormat, convertSrtToVtt, convertVttToSrt } from './tools/convert-subtitles/index.js';
export { burnSubtitles, type BurnSubtitlesParams, defaultBurnSubtitlesParams } from './tools/burn-subtitles/index.js';
export { pgpEncrypt, type PgpEncryptParams, defaultPgpEncryptParams } from './tools/pgp-encrypt/index.js';
export { pgpDecrypt, type PgpDecryptParams, defaultPgpDecryptParams } from './tools/pgp-decrypt/index.js';
export { pgpSign, type PgpSignParams, defaultPgpSignParams } from './tools/pgp-sign/index.js';
export { pgpVerify, type PgpVerifyParams, type PgpVerifyResult, defaultPgpVerifyParams } from './tools/pgp-verify/index.js';
export { zipCreate, type ZipCreateParams, defaultZipCreateParams, type ZipCompression } from './tools/zip-create/index.js';
export { zipExtract, type ZipExtractParams, defaultZipExtractParams, shouldInclude } from './tools/zip-extract/index.js';
export { zipInfo, type ZipInfoParams, type ZipInfoResult, type ZipEntryInfo, defaultZipInfoParams } from './tools/zip-info/index.js';
export { bgRemove, type BgRemoveParams, defaultBgRemoveParams } from './tools/bg-remove/index.js';
export { upscale2x, type Upscale2xParams, defaultUpscale2xParams } from './tools/upscale-2x/index.js';
export { ocrPro, type OcrProParams, defaultOcrProParams } from './tools/ocr-pro/index.js';
export { imageSimilarity, type ImageSimilarityParams, type ImageSimilarityResult, defaultImageSimilarityParams, cosineSimilarity as imageSimilarityCosineSimilarity, clusterByThreshold } from './tools/image-similarity/index.js';
export { textSentiment, type TextSentimentParams, type TextSentimentResult, defaultTextSentimentParams } from './tools/text-sentiment/index.js';
export { textNer, type TextNerParams, type TextNerResult, type NerEntity, defaultTextNerParams } from './tools/text-ner/index.js';
export { textSummarize, type TextSummarizeParams, defaultTextSummarizeParams } from './tools/text-summarize/index.js';
export { textTranslate, type TextTranslateParams, defaultTextTranslateParams } from './tools/text-translate/index.js';
export { textEmbed, type TextEmbedParams, type TextEmbedResult, defaultTextEmbedParams, cosineSimilarity as textEmbedCosineSimilarity } from './tools/text-embed/index.js';
export { textReadability, type TextReadabilityParams, type TextReadabilityResult, defaultTextReadabilityParams } from './tools/text-readability/index.js';
export { textStats, type TextStatsParams, type TextStatsResult, defaultTextStatsParams, computeTextStats, countSyllables } from './tools/text-stats/index.js';
export { tokenCount, type TokenCountParams, type TokenCountResult, type TokenModel, defaultTokenCountParams } from './tools/token-count/index.js';
export { textDiffLevenshtein, type TextDiffLevenshteinParams, type TextDiffLevenshteinResult, defaultTextDiffLevenshteinParams } from './tools/text-diff-levenshtein/index.js';
export { unicodeNormalize, type UnicodeNormalizeParams, type UnicodeNormalForm, defaultUnicodeNormalizeParams, normalizeUnicode } from './tools/unicode-normalize/index.js';
export { textEscape, type TextEscapeParams, type TextEscapeMode, defaultTextEscapeParams, encodeHtml, decodeHtml, encodeUnicode, decodeUnicode } from './tools/text-escape/index.js';
export { videoConcat, type VideoConcatParams, defaultVideoConcatParams, type VideoConcatPreset, buildConcatArgs } from './tools/video-concat/index.js';
export { videoAddText, type VideoAddTextParams, defaultVideoAddTextParams, type TextPosition, positionToXY, escapeDrawtext, hexToFfmpegColor, buildDrawtextFilter } from './tools/video-add-text/index.js';
export { videoSpeed, type VideoSpeedParams, defaultVideoSpeedParams, buildAtempoChain, buildSpeedArgs } from './tools/video-speed/index.js';
export { videoOverlayImage, type VideoOverlayImageParams, defaultVideoOverlayImageParams, type OverlayPosition, overlayPositionToXY, buildOverlayFilter } from './tools/video-overlay-image/index.js';
export { videoCrossfade, type VideoCrossfadeParams, defaultVideoCrossfadeParams, type CrossfadeTransition, parseDurationFromStderr, buildCrossfadeArgs } from './tools/video-crossfade/index.js';
export { videoColorCorrect, type VideoColorCorrectParams, defaultVideoColorCorrectParams, buildColorCorrectFilter } from './tools/video-color-correct/index.js';
export { excelToCsv, type ExcelToCsvParams } from './tools/excel-to-csv/index.js';
export { excelToJson, type ExcelToJsonParams } from './tools/excel-to-json/index.js';
export { csvToExcel, type CsvToExcelParams } from './tools/csv-to-excel/index.js';
export { jsonToExcel, type JsonToExcelParams } from './tools/json-to-excel/index.js';
export { excelInfo, type ExcelInfoParams } from './tools/excel-info/index.js';
export { mergeWorkbooks, type MergeWorkbooksParams } from './tools/merge-workbooks/index.js';
export { splitSheets, type SplitSheetsParams } from './tools/split-sheets/index.js';
export { htmlToPdf, type HtmlToPdfParams } from './tools/html-to-pdf/index.js';
export { barcode, type BarcodeParams } from './tools/barcode/index.js';
export {
  unicodeInfo,
  type UnicodeInfoParams,
  type UnicodeInfoReport,
  type UnicodeCharInfo,
  defaultUnicodeInfoParams,
  analyzeUnicode,
} from './tools/unicode-info/index.js';
export {
  hmac,
  type HmacParams,
  type HmacResult,
  type HmacAlgorithm,
  type HmacEncoding,
  defaultHmacParams,
  computeHmac,
} from './tools/hmac/index.js';
export {
  markdownToc,
  type MarkdownTocParams,
  defaultMarkdownTocParams,
  buildToc,
  slugify,
} from './tools/markdown-toc/index.js';
export {
  colorContrast,
  type ColorContrastParams,
  type ColorContrastResult,
  defaultColorContrastParams,
} from './tools/color-contrast/index.js';
export {
  passwordStrength,
  type PasswordStrengthParams,
  type PasswordStrengthResult,
  type StrengthTier,
  defaultPasswordStrengthParams,
  evaluatePassword,
} from './tools/password-strength/index.js';
export {
  textFrequency,
  type TextFrequencyParams,
  type TextFrequencyResult,
  type FrequencyEntry,
  defaultTextFrequencyParams,
  analyzeFrequency,
} from './tools/text-frequency/index.js';
export {
  base32,
  type Base32Params,
  defaultBase32Params,
  encodeBase32,
  decodeBase32,
} from './tools/base32/index.js';
export {
  jsonDiff,
  type JsonDiffParams,
  type JsonDiffStats,
  defaultJsonDiffParams,
} from './tools/json-diff/index.js';
export {
  morseCode,
  type MorseCodeParams,
  defaultMorseCodeParams,
  encodeMorse,
  decodeMorse,
} from './tools/morse-code/index.js';
export {
  romanNumeral,
  type RomanNumeralParams,
  type RomanNumeralResult,
  type RomanNumeralEntry,
  defaultRomanNumeralParams,
  encodeRoman,
  decodeRoman,
} from './tools/roman-numeral/index.js';
export {
  mimeDetect,
  type MimeDetectParams,
  type MimeDetectResult,
  defaultMimeDetectParams,
  detectMime,
} from './tools/mime-detect/index.js';
export {
  totpCode,
  type TotpCodeParams,
  type TotpCodeResult,
  type TotpAlgorithm,
  defaultTotpCodeParams,
  generateTotp,
} from './tools/totp-code/index.js';
export {
  urlParse,
  type UrlParseParams,
  type UrlParseResult,
  defaultUrlParseParams,
  parseUrl,
} from './tools/url-parse/index.js';
export {
  markdownFrontmatter,
  type MarkdownFrontmatterParams,
  type MarkdownFrontmatterResult,
  defaultMarkdownFrontmatterParams,
  extractFrontmatter,
} from './tools/markdown-frontmatter/index.js';
export {
  htmlClean,
  type HtmlCleanParams,
  defaultHtmlCleanParams,
  cleanHtml,
} from './tools/html-clean/index.js';
export {
  hotpCode,
  type HotpCodeParams,
  type HotpCodeResult,
  type HotpAlgorithm,
  defaultHotpCodeParams,
  generateHotp,
} from './tools/hotp-code/index.js';
export {
  jwtSign,
  type JwtSignParams,
  type JwtSignResult,
  type JwtSignAlgorithm,
  defaultJwtSignParams,
  signJwt,
} from './tools/jwt-sign/index.js';
export {
  webhookVerify,
  type WebhookVerifyParams,
  type WebhookVerifyResult,
  type WebhookAlgorithm,
  type WebhookEncoding,
  defaultWebhookVerifyParams,
} from './tools/webhook-verify/index.js';
export {
  urlBuild,
  type UrlBuildParams,
  type UrlBuildResult,
  type UrlBuildSpec,
  defaultUrlBuildParams,
  buildUrl,
} from './tools/url-build/index.js';
export {
  csvDeduplicate,
  type CsvDeduplicateParams,
  type CsvDeduplicateResult,
  defaultCsvDeduplicateParams,
} from './tools/csv-deduplicate/index.js';
export {
  csvMerge,
  type CsvMergeParams,
  type CsvMergeResult,
  type CsvMergeJoin,
  defaultCsvMergeParams,
} from './tools/csv-merge/index.js';
export {
  signedUrl,
  type SignedUrlParams,
  type SignedUrlResult,
  type SignedUrlAlgorithm,
  defaultSignedUrlParams,
} from './tools/signed-url/index.js';
export {
  backupCodes,
  type BackupCodesParams,
  type BackupCodesResult,
  defaultBackupCodesParams,
  generateBackupCodes,
} from './tools/backup-codes/index.js';
export {
  csvDiff,
  type CsvDiffParams,
  type CsvDiffResult,
  type CsvRowDiff,
  defaultCsvDiffParams,
} from './tools/csv-diff/index.js';
export {
  jsonFlatten,
  type JsonFlattenParams,
  defaultJsonFlattenParams,
  flattenJson,
} from './tools/json-flatten/index.js';
export {
  jsonUnflatten,
  type JsonUnflattenParams,
  defaultJsonUnflattenParams,
  unflattenJson,
} from './tools/json-unflatten/index.js';
export {
  otpauthUri,
  type OtpauthUriParams,
  type OtpauthUriResult,
  type OtpType,
  type OtpAlgorithm,
  defaultOtpauthUriParams,
  buildOtpauthUri,
} from './tools/otpauth-uri/index.js';
export {
  webhookReplay,
  type WebhookReplayParams,
  type WebhookReplayResult,
  type WebhookReplayAlgorithm,
  type WebhookReplayEncoding,
  defaultWebhookReplayParams,
} from './tools/webhook-replay/index.js';
export {
  fileFingerprint,
  type FileFingerprintParams,
  type FileFingerprintResult,
  type FingerprintHashAlgo,
  type FingerprintHmacAlgo,
  defaultFileFingerprintParams,
} from './tools/file-fingerprint/index.js';
export {
  jsonSchemaValidate,
  type JsonSchemaValidateParams,
  type JsonSchemaValidateResult,
  type JsonSchemaError,
  defaultJsonSchemaValidateParams,
} from './tools/json-schema-validate/index.js';
export {
  textConfusable,
  type TextConfusableParams,
  type TextConfusableResult,
  type ConfusableHit,
  type MixedScriptToken,
  defaultTextConfusableParams,
  analyzeConfusable,
} from './tools/text-confusable/index.js';
export {
  frontmatterToCsv,
  type FrontmatterToCsvParams,
  type FrontmatterToCsvResult,
  defaultFrontmatterToCsvParams,
} from './tools/frontmatter-to-csv/index.js';
export {
  yamlValidate,
  type YamlValidateParams,
  type YamlValidateResult,
  defaultYamlValidateParams,
} from './tools/yaml-validate/index.js';
export {
  jsonSchemaInfer,
  type JsonSchemaInferParams,
  defaultJsonSchemaInferParams,
  inferSchema,
} from './tools/json-schema-infer/index.js';
export {
  textRedact,
  type TextRedactParams,
  type TextRedactResult,
  type RedactPreset,
  defaultTextRedactParams,
  redactText,
} from './tools/text-redact/index.js';
export {
  htmlExtractLinks,
  type HtmlExtractLinksParams,
  type HtmlExtractLinksResult,
  type ExtractedLink,
  type LinkKind,
  defaultHtmlExtractLinksParams,
  extractLinks,
} from './tools/html-extract-links/index.js';
export {
  pdfExtractImages,
  type PdfExtractImagesParams,
  type PdfExtractImagesReport,
  defaultPdfExtractImagesParams,
} from './tools/pdf-extract-images/index.js';
export {
  csvInfo,
  type CsvInfoParams,
  type CsvInfoResult,
  type CsvColumnInfo,
  type CsvType,
  defaultCsvInfoParams,
} from './tools/csv-info/index.js';
export {
  csvToJsonSchema,
  type CsvToJsonSchemaParams,
  defaultCsvToJsonSchemaParams,
} from './tools/csv-to-json-schema/index.js';
export {
  jsonPath,
  type JsonPathParams,
  type JsonPathResult,
  type JsonPathMatch,
  defaultJsonPathParams,
  queryJsonPath,
} from './tools/json-path/index.js';
export {
  urlShortenLocal,
  type UrlShortenLocalParams,
  type UrlShortenLocalResult,
  defaultUrlShortenLocalParams,
  shortenUrl,
} from './tools/url-shorten-local/index.js';
export {
  textStatsByParagraph,
  type TextStatsByParagraphParams,
  type TextStatsByParagraphResult,
  type ParagraphStats,
  defaultTextStatsByParagraphParams,
} from './tools/text-stats-by-paragraph/index.js';
export {
  faviconFromUrl,
  type FaviconFromUrlParams,
  type FaviconFromUrlResult,
  type FaviconLink,
  type FaviconRel,
  defaultFaviconFromUrlParams,
  extractFavicons,
} from './tools/favicon-from-url/index.js';
export {
  colorBlindSimulator,
  type ColorBlindSimulatorParams,
  type ColorBlindType,
  defaultColorBlindSimulatorParams,
} from './tools/color-blind-simulator/index.js';
export {
  base58,
  type Base58Params,
  defaultBase58Params,
  encodeBase58,
  decodeBase58,
} from './tools/base58/index.js';
export {
  xmlToJson,
  type XmlToJsonParams,
  defaultXmlToJsonParams,
} from './tools/xml-to-json/index.js';
export {
  jsonToXml,
  type JsonToXmlParams,
  defaultJsonToXmlParams,
} from './tools/json-to-xml/index.js';
export {
  cssMinify,
  type CssMinifyParams,
  type CssMinifyResult,
  defaultCssMinifyParams,
} from './tools/css-minify/index.js';
export {
  htmlMinify,
  type HtmlMinifyParams,
  type HtmlMinifyResult,
  defaultHtmlMinifyParams,
} from './tools/html-minify/index.js';
export {
  apiKeyFormat,
  type ApiKeyFormatParams,
  type ApiKeyFormatResult,
  defaultApiKeyFormatParams,
} from './tools/api-key-format/index.js';
export {
  licenseKey,
  type LicenseKeyParams,
  type LicenseKeyResult,
  defaultLicenseKeyParams,
} from './tools/license-key/index.js';
export {
  textTemplate,
  type TextTemplateParams,
  type TextTemplateResult,
  defaultTextTemplateParams,
  renderTemplate,
} from './tools/text-template/index.js';
export {
  pgpArmor,
  type PgpArmorParams,
  type PgpArmorBlockType,
  type ArmorDecode,
  defaultPgpArmorParams,
  encodeArmor,
  decodeArmor,
} from './tools/pgp-armor/index.js';
export {
  signedCookieDecode,
  type SignedCookieDecodeParams,
  type SignedCookieDecodeResult,
  type CookieAlgorithm,
  type CookieStyle,
  defaultSignedCookieDecodeParams,
} from './tools/signed-cookie-decode/index.js';
export {
  textSuspicious,
  type TextSuspiciousParams,
  type TextSuspiciousResult,
  type SuspiciousFinding,
  defaultTextSuspiciousParams,
  analyzeSuspicious,
} from './tools/text-suspicious/index.js';
export {
  openapiValidate,
  type OpenapiValidateParams,
  type OpenapiValidateResult,
  type OpenapiIssue,
  type OpenapiIssueSeverity,
  defaultOpenapiValidateParams,
  validateOpenapi,
} from './tools/openapi-validate/index.js';
export {
  packageJsonValidate,
  type PackageJsonValidateParams,
  type PackageJsonValidateResult,
  type PackageJsonIssue,
  defaultPackageJsonValidateParams,
  validatePackageJson,
} from './tools/package-json-validate/index.js';
export {
  jsonMerge,
  type JsonMergeParams,
  type JsonMergeResult,
  type JsonMergeConflict,
  type JsonMergeStrategy,
  type JsonMergeArrayMode,
  defaultJsonMergeParams,
  mergeJson,
} from './tools/json-merge/index.js';
export {
  csvTemplate,
  type CsvTemplateParams,
  type CsvTemplateOnMissing,
  defaultCsvTemplateParams,
} from './tools/csv-template/index.js';
export {
  pdfSuspicious,
  type PdfSuspiciousParams,
  type PdfSuspiciousResult,
  defaultPdfSuspiciousParams,
} from './tools/pdf-suspicious/index.js';
export {
  regexVisualize,
  type RegexVisualizeParams,
  type VisualizeResult,
  defaultRegexVisualizeParams,
  visualizeRegex,
} from './tools/regex-visualize/index.js';
export {
  regexFromText,
  type RegexFromTextParams,
  type RegexFromTextResult,
  defaultRegexFromTextParams,
  generateRegexFromText,
} from './tools/regex-from-text/index.js';
export {
  cronFromText,
  type CronFromTextParams,
  type CronFromTextResult,
  defaultCronFromTextParams,
  generateCronFromText,
} from './tools/cron-from-text/index.js';
export {
  sqlFormatExplain,
  type SqlFormatExplainParams,
  type SqlFormatExplainResult,
  type SqlAnnotation,
  defaultSqlFormatExplainParams,
  explainSql,
} from './tools/sql-format-explain/index.js';
export {
  regexExplain,
  type RegexExplainParams,
  type RegexExplainResult,
  type RegexExplainNode,
  defaultRegexExplainParams,
  explainRegex,
} from './tools/regex-explain/index.js';
export {
  imageToAsciiArt,
  type ImageToAsciiParams,
  defaultImageToAsciiParams,
  imageToAscii,
} from './tools/image-to-ascii/index.js';
export {
  promptInjectionDemo,
  type PromptInjectionDemoParams,
  type PromptInjectionDemoResult,
  type InjectionHighlight,
  defaultPromptInjectionDemoParams,
  analyzePromptInjection,
} from './tools/prompt-injection-demo/index.js';
export {
  pdfExtractData,
  type PdfExtractDataParams,
  type PdfExtractDataResult,
  type PdfLineItem,
  type MoneyValue,
  defaultPdfExtractDataParams,
  extractFieldsFromText,
  extractPdfData,
} from './tools/pdf-extract-data/index.js';
export { getPipeline } from './lib/transformers.js';
export { setModelCdn, getModelCdn, modelUrl } from './lib/model-cdn.js';

export { defaultTools, createDefaultRegistry } from './default-registry.js';

export { runDefaultChain } from './chain/run-default.js';

export { parseChainString, serializeChain } from './chain/parse-chain-string.js';
