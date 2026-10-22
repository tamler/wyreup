import type { MimePattern, ToolInputSpec } from '../types.js';

const EXTENSION_MIME: Readonly<Record<string, string>> = {
  aac: 'audio/aac',
  asc: 'text/plain',
  avif: 'image/avif',
  avi: 'video/x-msvideo',
  bin: 'application/octet-stream',
  bmp: 'image/bmp',
  css: 'text/css',
  csv: 'text/csv',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  epub: 'application/epub+zip',
  flac: 'audio/flac',
  geojson: 'application/geo+json',
  gif: 'image/gif',
  gpx: 'application/gpx+xml',
  heic: 'image/heic',
  heif: 'image/heif',
  htm: 'text/html',
  html: 'text/html',
  ico: 'image/x-icon',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  js: 'text/javascript',
  json: 'application/json',
  kml: 'application/vnd.google-earth.kml+xml',
  m4a: 'audio/mp4',
  m4v: 'video/mp4',
  md: 'text/markdown',
  mkv: 'video/x-matroska',
  mov: 'video/quicktime',
  mp3: 'audio/mpeg',
  mp4: 'video/mp4',
  mpeg: 'video/mpeg',
  mpg: 'video/mpeg',
  oga: 'audio/ogg',
  ogg: 'audio/ogg',
  ogv: 'video/ogg',
  opus: 'audio/ogg',
  pdf: 'application/pdf',
  pgp: 'application/pgp-encrypted',
  png: 'image/png',
  shp: 'application/x-shapefile',
  sql: 'application/sql',
  srt: 'text/plain',
  svg: 'image/svg+xml',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  ts: 'text/typescript',
  txt: 'text/plain',
  vcf: 'text/vcard',
  vtt: 'text/vtt',
  wav: 'audio/wav',
  weba: 'audio/webm',
  webm: 'video/webm',
  webp: 'image/webp',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xml: 'application/xml',
  yaml: 'application/yaml',
  yml: 'application/yaml',
  zip: 'application/zip',
};

export function inferMimeFromFilename(filename: string): string {
  const extension = filename.split('.').pop()?.toLowerCase() ?? '';
  return EXTENSION_MIME[extension] ?? 'application/octet-stream';
}

export function effectiveFileMime(file: Pick<File, 'name' | 'type'>): string {
  return file.type.trim() || inferMimeFromFilename(file.name);
}

export function mimeMatches(mime: string, pattern: MimePattern): boolean {
  if (pattern === '*' || pattern === '*/*') return true;
  const baseMime = (mime.split(';')[0] ?? '').trim().toLowerCase();
  const basePattern = (pattern.split(';')[0] ?? '').trim().toLowerCase();
  if (basePattern.endsWith('/*')) return baseMime.startsWith(basePattern.slice(0, -1));
  return baseMime === basePattern;
}

export function fileMatchesMime(
  file: Pick<File, 'name' | 'type'>,
  accepted: readonly string[],
): boolean {
  const mime = effectiveFileMime(file);
  return accepted.some((pattern) => {
    const normalized = pattern.trim().toLowerCase();
    if (normalized.startsWith('.')) return file.name.toLowerCase().endsWith(normalized);
    return mimeMatches(mime, normalized);
  });
}

export function validateToolInputs(files: readonly File[], input: ToolInputSpec): string | null {
  if (files.length < input.min) {
    return `Expected at least ${input.min} file${input.min === 1 ? '' : 's'}, but got ${files.length}.`;
  }
  if (input.max !== undefined && files.length > input.max) {
    return `Expected at most ${input.max} file${input.max === 1 ? '' : 's'}, but got ${files.length}.`;
  }
  for (const file of files) {
    if (!fileMatchesMime(file, input.accept)) {
      return `File type not accepted for "${file.name}". Expected: ${input.accept.join(', ')}.`;
    }
    if (input.sizeLimit !== undefined && file.size > input.sizeLimit) {
      return `File "${file.name}" is too large (${file.size} bytes). Maximum: ${input.sizeLimit} bytes.`;
    }
  }
  return null;
}

export function assertToolInputs(files: readonly File[], input: ToolInputSpec): void {
  const error = validateToolInputs(files, input);
  if (error) throw new Error(error);
}
