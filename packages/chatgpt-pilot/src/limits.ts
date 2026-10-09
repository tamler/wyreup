export const LIMITS = Object.freeze({
  inputJson: 64 * 1024,
  fileBytes: 8 * 1024 * 1024,
  requestBytes: 24 * 1024 * 1024,
  outputBytes: 7 * 1024 * 1024,
  envelopeBytes: 10 * 1024 * 1024,
  imagePixels: 16_000_000,
  pdfPages: 100,
  downloadMs: 20_000,
  workerMs: 60_000,
  workerHeapMb: 128,
});

export const UI_URI = 'ui://widget/wyreup-result.html';

export const ERROR_MESSAGES = {
  INVALID_ARGUMENTS: 'The file arguments or options are invalid.',
  FILE_HOST_NOT_ENABLED: 'This file host is not enabled. Ask the operator to enable the observed hostname.',
  FILE_URL_NOT_ALLOWED: 'The file download address is not allowed.',
  FILE_DOWNLOAD_FAILED: 'The file could not be downloaded securely.',
  FILE_TOO_LARGE: 'The files exceed the download byte limits.',
  DOWNLOAD_TIMEOUT: 'The file download exceeded its time limit.',
  BUSY: 'Another file job is running. Please retry after it finishes.',
  CANCELLED: 'The file job was cancelled.',
  WORKER_TIMEOUT: 'Processing exceeded its time limit.',
  INVALID_FILE: 'The file is malformed, encrypted, animated, or unsupported.',
  IMAGE_PIXEL_LIMIT: 'The image exceeds the 16 megapixel limit.',
  PDF_PAGE_LIMIT: 'The PDFs exceed the combined 100 page limit.',
  TARGET_UNREACHABLE: 'The requested size could not be reached within the quality and downscaling limits.',
  OUTPUT_TOO_LARGE: 'The processed result exceeds the output byte limit.',
  PROCESSING_FAILED: 'The file could not be processed.',
} as const;

export type ErrorCode = keyof typeof ERROR_MESSAGES;

export class PilotError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly downloadHost?: string,
    readonly target?: { targetBytes: number; smallestBytes: number },
  ) {
    super(ERROR_MESSAGES[code]);
  }
}

export function safeError(error: unknown): PilotError {
  return error instanceof PilotError ? error : new PilotError('PROCESSING_FAILED');
}
