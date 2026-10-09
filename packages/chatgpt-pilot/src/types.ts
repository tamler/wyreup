import type { ErrorCode } from './limits.js';

export type Operation = 'compress_image_to_size' | 'strip_image_metadata' | 'merge_pdfs';

export interface FileReference {
  download_url: string;
  file_id: string;
  mime_type?: string;
  file_name?: string;
}

export interface ImageArguments {
  file: FileReference;
  target_kb?: number;
  allow_downscale?: boolean;
}

export interface MergeArguments {
  files: FileReference[];
}

export interface WorkerRequest {
  operation: Operation;
  inputs: ArrayBuffer[];
  targetKb: number;
  allowDownscale: boolean;
}

export interface OutputArtifact {
  name: string;
  mimeType: string;
  bytes: number;
  base64: string;
  sha256: string;
}

export interface SuccessDetails {
  status: 'success';
  operation: Operation;
  output: { name: string; mimeType: string; bytes: number };
  inputBytes: number;
  targetReached?: true;
  targetBytes?: number;
  pageCount?: number;
  inputOrder?: number[];
}

export interface ErrorDetails {
  status: 'error';
  operation: Operation;
  code: ErrorCode;
  message: string;
  retryable: boolean;
  downloadHost?: string;
  targetReached?: false;
  targetBytes?: number;
  smallestBytes?: number;
}

export type WorkerResponse =
  | { ok: true; details: SuccessDetails; bytes: ArrayBuffer; sha256: string }
  | { ok: false; code: ErrorCode; target?: { targetBytes: number; smallestBytes: number } };

export interface JobResult {
  details: SuccessDetails;
  output: OutputArtifact;
}
