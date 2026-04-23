/**
 * MIME helpers shared between run.ts, chain.ts, and the MCP server.
 * Kept minimal — only the extensions Wyreup tools actually care about.
 */

const EXT_TO_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  heic: 'image/heic',
  avif: 'image/avif',
  pdf: 'application/pdf',
  txt: 'text/plain',
  html: 'text/html',
  htm: 'text/html',
  md: 'text/markdown',
  json: 'application/json',
  yaml: 'application/yaml',
  yml: 'application/yaml',
  csv: 'text/csv',
  xml: 'application/xml',
  css: 'text/css',
  js: 'text/javascript',
  ts: 'text/typescript',
  sql: 'application/sql',
  wav: 'audio/wav',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  flac: 'audio/flac',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  mov: 'video/quicktime',
  avi: 'video/x-msvideo',
  zip: 'application/zip',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
  srt: 'text/plain',
  vtt: 'text/vtt',
  pgp: 'application/pgp-encrypted',
  asc: 'text/plain',
  bin: 'application/octet-stream',
};

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/bmp': '.bmp',
  'image/svg+xml': '.svg',
  'image/x-icon': '.ico',
  'image/heic': '.heic',
  'image/avif': '.avif',
  'application/pdf': '.pdf',
  'text/plain': '.txt',
  'text/html': '.html',
  'text/markdown': '.md',
  'application/json': '.json',
  'application/yaml': '.yaml',
  'text/csv': '.csv',
  'application/xml': '.xml',
  'text/css': '.css',
  'audio/wav': '.wav',
  'audio/mpeg': '.mp3',
  'audio/ogg': '.ogg',
  'audio/flac': '.flac',
  'audio/mp4': '.m4a',
  'audio/aac': '.aac',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/x-matroska': '.mkv',
  'video/quicktime': '.mov',
  'application/zip': '.zip',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'text/vtt': '.vtt',
  'application/pgp-encrypted': '.pgp',
  'application/octet-stream': '.bin',
};

export function inferMimeFromPath(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  return EXT_TO_MIME[ext] ?? 'application/octet-stream';
}

export function extFromMime(mime: string): string {
  return MIME_TO_EXT[mime] ?? '.bin';
}
