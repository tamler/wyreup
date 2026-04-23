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
  ToolRequires,
  ParamFieldSchema,
  ParamSchema,
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
export { getPipeline } from './lib/transformers.js';

export { defaultTools, createDefaultRegistry } from './default-registry.js';

export { runDefaultChain } from './chain/run-default.js';
