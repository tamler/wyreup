import type { AllowedRoots } from './paths.js';

export type WorkerJob = {
  toolId: string;
  inputPaths: string[];
  params: Record<string, unknown>;
  outputPath?: string;
  outputDir?: string;
  timeoutMs: number;
  proApiKey?: string;
  proOrigin: string;
  allowedRoots: AllowedRoots;
  allowOverwrite: boolean;
  maxBytes: number;
};

export type WorkerStage = 'validate' | 'read' | 'run' | 'write';

export type WorkerResult =
  | { ok: true; writtenPaths: string[]; textOutput?: string }
  | { ok: false; error: string; stage: WorkerStage };
