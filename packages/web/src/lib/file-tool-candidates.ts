import { fileMatchesMime, type Surface } from '@wyreup/core/execution';

// Positive owning-input contracts from the reviewed catalog authority.
// This only selects destinations; a runner must still parse/admit the actual file.
const FILE_IMPORT_IDS = new Set(`
stopwatch countdown-timer wedding-seating-chart-builder remove-duplicate-lines-online
markdown-table-generator bulk-meta-description-generator javascript-minifier code-beautifier
psd-to-png csv-viewer bank-statement-to-csv stl-to-gcode mp3-to-midi camera-shutter-count-checker
word-counter markdown-to-html case-converter text-readability text-diff slug json-formatter
base64 regex-tester number-base-converter url-encoder sql-formatter timestamp-converter hash
jwt-decoder xml-formatter cron-from-text text-escape css-formatter html-formatter csv-json
html-minify css-minify yaml-validate json-yaml json-path color-converter favicon resize compress
convert merge-pdf split-pdf crop svg-to-png analyze-loudness audio-enhance audio-speed base32
base58 bg-remove bg-remove-pro burn-subtitles color-blind-simulator color-palette
compress-image-to-size compress-video convert-audio convert-subtitles convert-video cron-parser
crop-video csv-deduplicate csv-diff csv-info csv-merge csv-template csv-to-excel csv-to-json-schema
strip-exif image-to-pdf rotate-pdf reorder-pdf page-numbers-pdf watermark-pdf pdf-to-text
image-diff rotate-image flip-image grayscale sepia invert image-info pdf-info image-watermark
pdf-to-image html-to-markdown ocr pdf-extract-pages pdf-delete-pages pdf-compress pdf-encrypt
pdf-decrypt pdf-redact pdf-metadata pdf-extract-tables pdf-crop face-blur transcribe transcribe-pro
text-sentences text-keywords text-dates docx-to-text extract-article-text pdf-flatten
pdf-form-fields zip-remove zip-flatten text-summarize-pro text-translate-pro text-sentiment-pro
text-ner-pro text-redact-pro upscale-2x-pro ocr-hq image-describe analyze-chart image-q-and-a
read-handwriting detect-objects translate-image transcribe-and-translate regex-from-text-pro
cron-from-text-pro pdf-summarize pdf-q-and-a image-caption image-caption-detailed image-collage
pixelate-region ics-to-csv x509-decode heic-to-jpg merge-audio images-to-gif epub-to-text
har-sanitize vcf-to-csv toml-convert csv-to-geojson kml-to-geojson geojson-to-kml gpx-to-geojson
gpx-to-kml shapefile-to-geojson convert-geo qr-reader svg-optimizer extract-audio trim-media
video-to-gif pgp-encrypt pgp-decrypt pgp-sign pgp-verify zip-create zip-extract zip-info upscale-2x
ocr-pro image-similarity text-sentiment text-ner text-summarize text-translate text-embed
text-stats token-count text-diff-levenshtein unicode-normalize video-concat video-add-text
video-speed video-overlay-image video-crossfade video-color-correct resize-video mute-video
rotate-video extract-frame replace-audio normalize-loudness video-quality-metrics reverse-video
video-volume loop-video strip-video-metadata fade-video vignette-video letterbox-video mix-audio
video-side-by-side excel-to-csv excel-to-json json-to-excel excel-info merge-workbooks
split-sheets html-to-pdf unicode-info hmac markdown-toc text-frequency json-diff morse-code
mime-detect markdown-frontmatter html-clean webhook-verify csv-sort csv-filter diff-apply
ocr-suspicious html-redact openapi-report json-flatten json-unflatten webhook-replay
file-fingerprint json-schema-validate text-confusable frontmatter-to-csv json-schema-infer
text-redact html-extract-links pdf-extract-images text-stats-by-paragraph favicon-from-url
xml-to-json json-to-xml text-template pgp-armor text-suspicious openapi-validate
package-json-validate json-merge pdf-suspicious regex-from-text sql-format-explain regex-explain
image-to-ascii prompt-injection-demo pdf-extract-data text-to-speech-pro content-safety-pro
translate-many-pro translate-document-pro deep-analysis-pro fix-grammar-pro rewrite-tone-pro
chat-long-pdf-pro image-generate-pro json-extract-pro translate-indic-pro csv-sql
`.trim().split(/\s+/));

export interface FileCandidateTool {
  id: string;
  surfaces?: readonly Surface[];
  input?: { accept: readonly string[] };
  accept?: readonly string[];
}

export function hasBrowserFileImport(tool: FileCandidateTool): boolean {
  return FILE_IMPORT_IDS.has(tool.id) && (tool.surfaces === undefined || tool.surfaces.includes('web'));
}

export function acceptsBrowserFile(tool: FileCandidateTool, file: Pick<File, 'name' | 'type'>): boolean {
  if (!hasBrowserFileImport(tool)) return false;
  return fileMatchesMime(file, tool.input?.accept ?? tool.accept ?? []);
}

export function fileToolCandidates<T extends FileCandidateTool>(tools: readonly T[], file: Pick<File, 'name' | 'type'>): T[] {
  return tools.filter((tool) => acceptsBrowserFile(tool, file));
}
