// Output MIME handling shared by the tool worker and the in-process chain.

/** Single outputs returned inline as text when no output path is given. */
export function isInlineTextMime(mime: string): boolean {
  return mime.startsWith('text/') || mime === 'application/json' || mime === 'application/x-subrip';
}

const WORKER_MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/x-icon': '.ico',
  'image/bmp': '.bmp',
  'image/svg+xml': '.svg',
  'image/tiff': '.tiff',
  'image/vnd.adobe.photoshop': '.psd',
  'model/stl': '.stl',
  'application/pdf': '.pdf',
  'text/plain': '.txt',
  'text/html': '.html',
  'text/markdown': '.md',
  'application/json': '.json',
  'text/csv': '.csv',
  'text/tab-separated-values': '.tsv',
  'application/xml': '.xml',
  'text/css': '.css',
  'text/javascript': '.js',
  'application/javascript': '.js',
  'application/sql': '.sql',
  'audio/wav': '.wav',
  'audio/mpeg': '.mp3',
  'video/mp4': '.mp4',
  'text/vtt': '.vtt',
  'application/x-subrip': '.srt',
};

/** Extension for files the worker writes into output_dir. */
export function workerExtFromMime(mime: string): string {
  return WORKER_MIME_TO_EXT[mime] ?? '.bin';
}
