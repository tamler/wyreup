// Wyreup core — type definitions
// Source of truth for the tool module contract.
// See /docs/superpowers/specs/2026-04-15-wyreup-tool-library-design.md §5.1

import type { ComponentType } from './ui-types.js';

// ──── Category and presence ────

export type ToolCategory =
  | 'optimize'
  | 'convert'
  | 'edit'
  | 'privacy'
  | 'pdf'
  | 'create'
  | 'inspect'
  | 'export';

export type ToolPresence = 'editor' | 'standalone' | 'both';

// ──── Memory estimate for worker pool scheduling ────

/**
 * Approximate working-set memory (in tiers) when run() is active.
 * Used by the worker pool to gate concurrent execution on low-memory devices.
 * Values are rough estimates, not hard guarantees.
 */
export type MemoryEstimate =
  | 'low'      // <50 MB: most pure-WASM tools (compress, convert, strip-exif)
  | 'medium'   // 50-200 MB: background removal, face detection, PDF rendering
  | 'high'     // 200-500 MB: video processing (v1.5), OCR (v1.5)
  | 'extreme'; // >500 MB: reserved; not used in v1 or v1.5

// ──── MIME pattern (e.g. 'image/*', 'application/pdf', 'image/heic') ────

export type MimePattern = string;

// ──── Input / output specifications ────

export interface ToolInputSpec {
  /** Allowed MIME patterns (supports wildcards like 'image/*'). */
  accept: MimePattern[];
  /** Minimum number of files required. */
  min: number;
  /** Maximum number of files (undefined = unlimited). */
  max?: number;
  /** Per-file byte cap for sanity; default 500 MB. */
  sizeLimit?: number;
}

export interface ToolOutputSpec {
  /** Output MIME type. */
  mime: MimePattern;
  /** True if run() can produce multiple files (e.g. pdf-to-image). */
  multiple?: boolean;
  /** Optional: suggested output filename generator. */
  filename?: (input: File, params: unknown) => string;
}

// ──── Progress reporting ────

export interface ToolProgress {
  stage: 'loading-deps' | 'processing' | 'encoding' | 'done';
  /** 0-100 if known, undefined if indeterminate. */
  percent?: number;
  /** Short human-readable message. */
  message?: string;
}

// ──── Run context passed into every tool invocation ────

export interface ToolRunContext {
  onProgress: (p: ToolProgress) => void;
  signal: AbortSignal;
  /** Per-session cache for expensive shared initialization (e.g. model handles). */
  cache: Map<string, unknown>;
  /**
   * Stable UUID for this invocation. Used as an idempotency key for v2 AI
   * backend calls so that retries don't double-charge credits.
   */
  executionId: string;
}

// ──── UI component contract ────

export interface ToolComponentProps<Params> {
  /** Where the component is being rendered. */
  surface: 'landing-page' | 'editor-chip' | 'editor-modal' | 'focused-mode';
  /** Partial params that pin the tool's config (used by SEO alias pages). */
  preset?: Partial<Params>;
  /** Files to operate on (from editor context or picked inline). */
  inputs: File[];
  /** Called when the user changes the input file set. */
  onInputsChange: (files: File[]) => void;
  /** Called when run() completes with the output blobs. */
  onComplete: (outputs: Blob[]) => void;
  /** Called when the user cancels. */
  onCancel: () => void;
}

// ──── The ToolModule interface ────

export interface ToolModule<Params = unknown> {
  // Metadata
  id: string;
  slug: string;
  name: string;
  description: string;
  category: ToolCategory;
  presence: ToolPresence;
  keywords: string[];

  // Capabilities
  input: ToolInputSpec;
  output: ToolOutputSpec;
  interactive: boolean;
  batchable: boolean;
  cost: 'free' | 'credit';
  memoryEstimate: MemoryEstimate;

  // Core operation (v1 tools use this)
  run(inputs: File[], params: Params, ctx: ToolRunContext): Promise<Blob[] | Blob>;

  // Streaming operation (v1.5+ forward-compat; undefined/false in v1)
  streaming?: boolean;
  runStream?: (
    inputs: ReadableStream<Uint8Array>[],
    params: Params,
    ctx: ToolRunContext,
  ) => Promise<ReadableStream<Uint8Array>[]>;

  // UI component (same component renders in all surfaces)
  Component: ComponentType<ToolComponentProps<Params>>;

  // Presets
  defaults: Params;
  applyPreset?: (preset: Partial<Params>, defaults: Params) => Params;

  // Testing contract (consumed by CI)
  __testFixtures: {
    valid: string[];
    weird: string[];
    expectedOutputMime: string[];
  };
}
