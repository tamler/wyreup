// Wyreup core — type definitions
// Source of truth for the tool module contract.
// See /docs/superpowers/specs/2026-04-15-wyreup-tool-library-design.md §5.1

// ──── Category ────

export type ToolCategory =
  | 'optimize'
  | 'convert'
  | 'edit'
  | 'privacy'
  | 'pdf'
  | 'create'
  | 'inspect'
  | 'export'
  | 'audio'
  | 'dev'
  | 'finance'
  | 'media'
  | 'archive'
  | 'text'
  | 'geo';

/**
 * Runtime surfaces a tool can run on. Use this to gate tools that need
 * a browser-only API (microphone, camera, screen-capture) so they don't
 * appear in CLI / MCP listings where they can't possibly work.
 *
 * Undefined = ['web', 'cli', 'mcp'] (the default — runs everywhere).
 */
export type Surface = 'web' | 'cli' | 'mcp';

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

// ──── Runtime capability requirements ────

/**
 * What a tool needs from the runtime environment. Omit when the tool has
 * no special requirements (universal — runs everywhere).
 * See /packages/core/docs/ai-models.md §5.4 for the tiering rules.
 */
export interface ToolRequires {
  /**
   * WebGPU requirement for this tool.
   * - 'preferred': runs on WASM too, faster on WebGPU. UI shows a "slower mode" badge when WebGPU is absent.
   * - 'required': only runs on WebGPU. UI hides/disables the run action on non-WebGPU browsers and offers the CLI as an escape hatch.
   */
  webgpu?: 'preferred' | 'required';
  /** Minimum device memory in GB (from navigator.deviceMemory). */
  minMemoryGB?: number;
}

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

// ──── Declarative param field metadata ────

/**
 * Declarative param field metadata. When a tool provides `paramSchema`,
 * the auto-generated form in the web surface uses these types to render
 * proper controls (enum -> select, range -> slider, etc.) instead of
 * falling back to typeof-inference on `defaults`.
 */
/**
 * `showWhen` lets a field hide unless another field matches a value. Used
 * for mode-driven forms (e.g. split-pdf's `ranges` only matters when
 * `mode === 'ranges'`). Supports a single `equals` value or any of a
 * list via `in`.
 */
export type ShowWhenCondition = {
  field: string;
  equals?: string | number | boolean;
  in?: ReadonlyArray<string | number | boolean>;
};

export type ParamFieldSchema =
  | {
      type: 'string';
      label?: string;
      help?: string;
      placeholder?: string;
      minLength?: number;
      maxLength?: number;
      multiline?: boolean;
      showWhen?: ShowWhenCondition;
    }
  | {
      type: 'number';
      label?: string;
      help?: string;
      min?: number;
      max?: number;
      step?: number;
      unit?: string;
      showWhen?: ShowWhenCondition;
    }
  | {
      type: 'range';
      label?: string;
      help?: string;
      min: number;
      max: number;
      step?: number;
      unit?: string;
      showWhen?: ShowWhenCondition;
    }
  | {
      type: 'boolean';
      label?: string;
      help?: string;
      showWhen?: ShowWhenCondition;
    }
  | {
      type: 'enum';
      label?: string;
      help?: string;
      options: Array<{ value: string | number; label: string; help?: string }>;
      /**
       * When set, the form swaps `options` for `optionsFrom.map[<value of
       * controlling field>]` and resets this field if the prior value is
       * no longer valid. Used for category-driven cascading enums (pick
       * "length", then see length units only).
       */
      optionsFrom?: {
        field: string;
        map: Record<
          string,
          Array<{ value: string | number; label: string; help?: string }>
        >;
      };
      showWhen?: ShowWhenCondition;
    }
  | {
      type: 'multi-enum';
      label?: string;
      help?: string;
      options: Array<{ value: string; label: string }>;
      showWhen?: ShowWhenCondition;
    }
  | {
      type: 'array';
      label?: string;
      help?: string;
      itemType: 'string' | 'number';
      placeholder?: string;
      showWhen?: ShowWhenCondition;
    }
  | {
      type: 'json';
      label?: string;
      help?: string;
      placeholder?: string;
      showWhen?: ShowWhenCondition;
    };

export type ParamSchema<P> = {
  [K in keyof P]?: ParamFieldSchema;
};

// ──── The ToolModule interface ────

/**
 * Hand-written content rendered on the public tool page in addition to
 * the runner. Optional — pages without this fall back to auto-generated
 * sections from existing metadata. When present, `faq` is also emitted
 * as FAQPage JSON-LD for SERP enhancement.
 */
export interface ToolSeoContent {
  /** One to three paragraphs explaining what the tool is for. Plain text. */
  intro?: string;
  /** Bullet list of common use cases. Rendered as a "Common uses" section. */
  useCases?: string[];
  /** Q&A pairs. Rendered as content AND as FAQPage JSON-LD. */
  faq?: { q: string; a: string }[];
  /** Curated cross-links — adjacent tools worth trying, with the reason. */
  alsoTry?: { id: string; why: string }[];
}

export interface ToolModule<Params = unknown> {
  // Metadata
  id: string;
  slug: string;
  name: string;
  description: string;
  /** Primary category — where the tool lives by default. */
  category: ToolCategory;
  /**
   * Additional categories this tool belongs to. A tool surfaces under
   * any category in {category, ...categories}. Useful when a tool
   * legitimately spans buckets (e.g. record-audio is both a capture
   * primitive and an audio tool). Listings deduplicate by id, so the
   * tool appears once per category but only once total.
   */
  categories?: ToolCategory[];
  keywords: string[];
  /**
   * Optional override for the description exposed to MCP / LLM agents.
   * Use only when the canonical `description` (written for humans) leaves
   * out a hint that helps an agent pick the right tool — for example,
   * naming a chain-pair partner, calling out a critical parameter, or
   * surfacing a multi-output caveat. When undefined, agents see
   * `${name}: ${description}` (which is the right default for ~95% of
   * tools — most descriptions are already LLM-friendly).
   */
  llmDescription?: string;

  /**
   * Optional richer content for the public tool page — picked up by
   * `/tools/[slug].astro` to render an extended body (intro paragraphs,
   * common use cases, FAQ pairs, curated "also try" links). Only the
   * `faq` is wired into structured data (FAQPage JSON-LD for SERP
   * enhancement); the rest is plain content. Hand-written per tool;
   * pages without `seoContent` fall back to auto-generated sections
   * derived from `description` / `llmDescription` / `input` / `output`.
   */
  seoContent?: ToolSeoContent;

  // Capabilities
  input: ToolInputSpec;
  output: ToolOutputSpec;
  interactive: boolean;
  batchable: boolean;
  cost: 'free' | 'credit';
  memoryEstimate: MemoryEstimate;
  /** Runtime capability requirements. Undefined = universal (runs everywhere). */
  requires?: ToolRequires;

  // Core operation (v1 tools use this)
  run(inputs: File[], params: Params, ctx: ToolRunContext): Promise<Blob[] | Blob>;

  // Streaming operation (v1.5+ forward-compat; undefined/false in v1)
  streaming?: boolean;
  runStream?: (
    inputs: ReadableStream<Uint8Array>[],
    params: Params,
    ctx: ToolRunContext,
  ) => Promise<ReadableStream<Uint8Array>[]>;

  // Presets
  defaults: Params;
  applyPreset?: (preset: Partial<Params>, defaults: Params) => Params;

  /**
   * Optional declarative param schema. When provided, the auto-generated
   * form uses these types to render proper UI controls. Fields not in
   * the schema fall back to typeof-inference on `defaults`.
   */
  paramSchema?: ParamSchema<Params>;

  /**
   * Curated next-step tool ids for the "Use this result in…" chain
   * panel. When set, only these tools appear as suggestions instead
   * of the full mime-compatible set.
   *
   * Without this, a transcribe-prose result would suggest every tool
   * that accepts text/plain — including tools like `color-converter`
   * that expect a hex string, not prose. Output mime alone can't
   * disambiguate "transcript" vs "color string"; this field carries
   * that intent.
   */
  chainSuggestions?: string[];

  /**
   * Hint for how the tool's text output should be presented in the
   * web runner. `prose` = sans-serif, generous line height (transcripts,
   * captions, summaries). `mono` = monospace, code-like (default; JSON,
   * regex matches, formatted code).
   */
  outputDisplay?: 'mono' | 'prose';

  /**
   * Runtime surfaces this tool is exposed on. Undefined = everywhere
   * (the default). Set to a subset when the tool depends on a
   * surface-specific API that other surfaces can't provide:
   *
   *   record-audio       → ['web']        (getUserMedia is browser-only)
   *   take-photo         → ['web']        (same)
   *   screen-capture     → ['web']        (getDisplayMedia is browser-only)
   *
   * The CLI's `list` command, the MCP server's tool registration, and
   * the web's catalog all filter by this so a tool only appears where
   * it can actually run. No "use the web UI" runtime errors.
   */
  surfaces?: Surface[];

  /**
   * Approximate additional download size (bytes) this tool requires beyond
   * the base app bundle. Includes WASM modules and ML model files fetched
   * on first use. Undefined = negligible (pure JS, in-bundle). Used by the
   * PWA settings UI to inform opt-in decisions.
   */
  installSize?: number;

  /**
   * If set, tools with the same installGroup share a single download (e.g.
   * all ffmpeg tools share the ffmpeg.wasm bundle). The PWA settings UI
   * groups them under one toggle keyed by this value.
   */
  installGroup?: string;

  // Testing contract (consumed by CI)
  __testFixtures: {
    valid: string[];
    weird: string[];
    expectedOutputMime: string[];
  };
}
