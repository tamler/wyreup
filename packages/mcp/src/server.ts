import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import {
  createDefaultRegistry,
  toolRunsOnSurface,
  runChain,
  parseChainString,
  setModelCdn,
} from '@wyreup/core';
import { basename, delimiter, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { atomicPublish } from './atomic-publish.js';
import { resolveAllowedRoots, assertPathAllowed } from './paths.js';
import { Auditor, type AuditRecord } from './audit.js';
import { isIdempotent } from './idempotency.js';
import { tmpdir } from 'node:os';
import { runInWorker } from './supervisor.js';
import { sanitize } from './sanitize.js';
import { admitToolParams, projectToolParamsSchema } from './param-schema.js';
import type { ToolModule } from '@wyreup/core';
import { setEgressAllowedOrigins } from './egress.js';
import { resolveModelCdn } from './runtime-config.js';
import { MCP_VERSION } from './version.js';
import { readCanonicalFileBounded } from './bounded-file-read.js';

// ──── Pro auth from environment ───────────────────────────────────────────────
//
// Pro tools (cost: 'credit') route through /api/tools/pro/run with a
// Bearer header. We read the key from WYREUP_API_KEY and the origin from
// WYREUP_ORIGIN at server startup. If the key is missing we degrade
// gracefully — free tools still work, Pro tools are hidden from the
// listing, and the operator gets a stderr nudge to set the env var.

const DEFAULT_PRO_ORIGIN = 'https://wyreup.com';

function resolveProApiKey(): string | undefined {
  const raw = process.env['WYREUP_API_KEY'];
  return raw && raw.trim() ? raw.trim() : undefined;
}

function resolveProOrigin(): string {
  const raw = process.env['WYREUP_ORIGIN'];
  if (raw && raw.trim()) return raw.trim().replace(/\/+$/, '');
  return DEFAULT_PRO_ORIGIN;
}

// ──── Size cap ────────────────────────────────────────────────────────────────

function resolveMaxBytes(): number {
  const raw = process.env['WYREUP_MAX_INPUT_BYTES'];
  if (!raw) return 500 * 1024 * 1024;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 500 * 1024 * 1024;
  return Math.floor(n);
}

// ──── Chain intermediate size cap [spec §#5] ──────────────────────────────────
//
// Chains run in-process (no per-step fork), so an intermediate Blob that
// balloons between steps lives entirely in this process's heap and can OOM the
// MCP server. Cap each step's output, and the running total across steps, so an
// unbounded intermediate aborts the chain rather than feeding the next step.
// Defaults match the 500 MB input ceiling (resolveMaxBytes) so chain limits are
// not looser than the single-tool limit; the cumulative cap is 2x that. Both
// derive from the per-step value so a single WYREUP_MAX_INPUT_BYTES override
// scales them together.
const DEFAULT_CHAIN_STEP_OUTPUT_BYTES = 500 * 1024 * 1024;

function resolveChainStepCap(): number {
  const raw = process.env['WYREUP_MAX_INPUT_BYTES'];
  if (!raw) return DEFAULT_CHAIN_STEP_OUTPUT_BYTES;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_CHAIN_STEP_OUTPUT_BYTES;
  return Math.floor(n);
}

export function totalBlobBytes(blobs: Blob[]): number {
  return blobs.reduce((sum, b) => sum + b.size, 0);
}

// ──── MIME helpers ────────────────────────────────────────────────────────────

const EXT_TO_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  nef: 'image/tiff',
  psd: 'image/vnd.adobe.photoshop',
  stl: 'model/stl',
  pdf: 'application/pdf',
  txt: 'text/plain',
  html: 'text/html',
  htm: 'text/html',
  md: 'text/markdown',
  json: 'application/json',
  csv: 'text/csv',
  tsv: 'text/tab-separated-values',
  xml: 'application/xml',
  css: 'text/css',
  js: 'text/javascript',
  sql: 'application/sql',
  wav: 'audio/wav',
  mp3: 'audio/mpeg',
  mp4: 'video/mp4',
};

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/bmp': '.bmp',
  'image/svg+xml': '.svg',
  'image/x-icon': '.ico',
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
};

function inferMimeFromPath(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  return EXT_TO_MIME[ext] ?? 'application/octet-stream';
}

function extFromMime(mime: string): string {
  return MIME_TO_EXT[mime] ?? '.bin';
}

// ──── Schema builder ──────────────────────────────────────────────────────────

function buildMcpInputSchema(tool: ToolModule): Record<string, unknown> {
  const isMultiOutput = tool.output.multiple === true;
  const properties: Record<string, unknown> = {
    input_paths: {
      type: 'array',
      items: { type: 'string' },
      description: 'Absolute paths to input files on disk.',
    },
    params: {
      ...projectToolParamsSchema(tool),
    },
    timeout_ms: {
      type: 'number',
      description:
        'Max runtime in ms. Default 300000 (5 min). Range [1, 3600000]. 0 disables (requires WYREUP_ALLOW_DISABLE_TIMEOUT=1).',
    },
    allow_overwrite: {
      type: 'boolean',
      description: 'Overwrite existing output files. Default false.',
    },
  };

  if (isMultiOutput) {
    properties['output_dir'] = {
      type: 'string',
      description: 'Absolute path to directory where output files will be written.',
    };
  } else {
    properties['output_path'] = {
      type: 'string',
      description: 'Absolute path where the output file will be written.',
    };
  }

  return {
    type: 'object',
    properties,
  };
}

// ──── Server factory ──────────────────────────────────────────────────────────

export async function createWyreupMcpServer(): Promise<Server> {
  const proApiKey = resolveProApiKey();
  const proOrigin = resolveProOrigin();
  const modelCdn = resolveModelCdn();
  setModelCdn(modelCdn.base);
  setEgressAllowedOrigins([proOrigin, ...modelCdn.allowedOrigins]);
  const registry = createDefaultRegistry();

  const maxBytes = resolveMaxBytes();

  const allowedRoots = await resolveAllowedRoots(
    process.env['WYREUP_ALLOW_PATHS']
      ? process.env['WYREUP_ALLOW_PATHS'] === '*'
        ? '*'
        : process.env['WYREUP_ALLOW_PATHS'].split(delimiter).filter(Boolean)
      : [process.cwd(), tmpdir()],
  );

  if (allowedRoots === '*') {
    process.stderr.write('wyreup MCP: WYREUP_ALLOW_PATHS=* — path allowlist DISABLED\n');
  } else {
    process.stderr.write(`wyreup MCP: allowed paths: ${allowedRoots.join(', ')}\n`);
  }

  const auditor = new Auditor({
    path: process.env['WYREUP_AUDIT_LOG'],
    strict: process.env['WYREUP_AUDIT_REQUIRED'] === '1',
    apiKey: proApiKey,
  });

  // Without a Pro API key, hide credit-gated tools so the agent never
  // sees an option it can't actually invoke. Print a one-shot stderr
  // hint so the operator knows what to set; don't hard-fail the
  // server — free tools still work and that's the whole point of the
  // graceful-degrade path.
  if (!proApiKey) {
    process.stderr.write(
      'wyreup MCP: WYREUP_API_KEY not set — Pro tools are hidden. ' +
        'Set the env var (or run `wyreup login` and pipe ~/.wyreup/config.json) to enable them.\n',
    );
  }

  const tools = Array.from(registry.toolsById.values())
    .filter((t) => toolRunsOnSurface(t, 'mcp'))
    .filter((t) => proApiKey || t.cost !== 'credit');

  const server = new Server(
    { name: 'wyreup', version: MCP_VERSION },
    { capabilities: { tools: {} } },
  );

  // The `wyreup_chain` meta-tool lets agents run a multi-step chain
  // in a single call instead of orchestrating each tool individually.
  // Same pipeline the web's /chain/run uses; same chain string syntax
  // the CLI's `wyreup chain --steps "..."` accepts.
  const CHAIN_TOOL = {
    name: 'wyreup_chain',
    description:
      "Run a chain of Wyreup tools in sequence. Each step's output becomes the next step's input. " +
      'Chain syntax: "tool1|tool2[key=val,key2=val2]|tool3". ' +
      'Use this when the agent task naturally pipelines (e.g. transcribe an audio file then summarize the text).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        steps: {
          type: 'string',
          description:
            'Chain string. Pipe-delimited tool IDs with optional [key=value,...] params: ' +
            '"transcribe|text-summarize[maxLength=200]" or "strip-exif|compress[quality=80]".',
        },
        input_paths: {
          type: 'array',
          items: { type: 'string' },
          description: 'Input file paths for the first step.',
        },
        output_path: {
          type: 'string',
          description: 'Where to write the final result. Required for binary outputs.',
        },
        output_dir: {
          type: 'string',
          description:
            'Directory for multi-output chains (each output written with a tool-derived name).',
        },
        timeout_ms: {
          type: 'number',
          description:
            'Optional max runtime in milliseconds before the chain is aborted. Default 1800000 (30 min). Override upward for chains that include slow models — transcribe (~5–10 min/hour of audio), audio-enhance, ocr-pro — or downward for known-fast chains. Pass 0 to disable.',
        },
        allow_overwrite: {
          type: 'boolean',
          description: 'Overwrite existing output files. Default false.',
        },
      },
      required: ['steps', 'input_paths'],
    },
  };

  // ── Result shape helpers ──────────────────────────────────────────────────
  // Centralize the "tool error vs transport error" decision: anything caused
  // by the LLM's input or by the tool's own runtime failure is a TOOL result
  // with isError:true so the agent sees something it can recover from. Only
  // genuine transport / programming bugs get rethrown.

  type CallResult = {
    content: Array<{ type: 'text'; text: string }>;
    isError?: boolean;
  };

  function errorResult(text: string): CallResult {
    return { content: [{ type: 'text', text }], isError: true };
  }

  async function withAudit<T extends CallResult>(
    toolName: string,
    inputPaths: string[],
    outputPath: string | undefined,
    body: () => Promise<T>,
  ): Promise<T> {
    const start = performance.now();
    const result = await body();
    const record: AuditRecord = {
      ts: new Date().toISOString(),
      tool: toolName,
      input_paths: inputPaths,
      output_path: outputPath,
      status: result.isError ? 'error' : 'ok',
      duration_ms: Math.round(performance.now() - start),
      error: result.isError ? result.content[0]?.text : undefined,
    };
    await auditor.append(record);
    return result;
  }

  function resolveTimeout(raw: unknown): { ok: true; ms: number } | { ok: false; error: string } {
    if (raw === undefined) return { ok: true, ms: 300_000 };
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0 || !Number.isInteger(raw)) {
      return {
        ok: false,
        error: `timeout_ms must be a non-negative integer (got ${JSON.stringify(raw)})`,
      };
    }
    if (raw === 0) {
      if (process.env['WYREUP_ALLOW_DISABLE_TIMEOUT'] !== '1') {
        return {
          ok: false,
          error:
            'timeout_ms: 0 (disable) requires WYREUP_ALLOW_DISABLE_TIMEOUT=1 on the MCP server process.',
        };
      }
      return { ok: true, ms: 0 };
    }
    return { ok: true, ms: Math.min(raw, 3_600_000) };
  }

  async function validatePaths(
    inputs: string[],
    outputPath: string | undefined,
    outputDir: string | undefined,
  ): Promise<
    | { ok: true; inputPaths: string[]; outputPath?: string; outputDir?: string }
    | { ok: false; error: string }
  > {
    const resolvedInputs: string[] = [];
    for (const p of inputs) {
      const r = await assertPathAllowed(p, 'read', allowedRoots);
      if (!r.ok) return r;
      resolvedInputs.push(r.resolved);
    }
    let resolvedOutputPath: string | undefined;
    if (outputPath) {
      const r = await assertPathAllowed(outputPath, 'write', allowedRoots);
      if (!r.ok) return r;
      resolvedOutputPath = r.resolved;
    }
    let resolvedOutputDir: string | undefined;
    if (outputDir) {
      const r = await assertPathAllowed(outputDir, 'write-directory', allowedRoots);
      if (!r.ok) return r;
      resolvedOutputDir = r.resolved;
    }
    return {
      ok: true,
      inputPaths: resolvedInputs,
      outputPath: resolvedOutputPath,
      outputDir: resolvedOutputDir,
    };
  }

  // Read an absolute path into a File. On any I/O error (missing file,
  // permission denied, EISDIR, etc.) returns a structured error message
  // instead of throwing — the LLM sees a clear path to retry.
  async function safeReadAllInputs(
    paths: string[],
  ): Promise<{ ok: true; files: File[] } | { ok: false; error: string }> {
    const files: File[] = [];
    let totalBytes = 0;
    for (const p of paths) {
      try {
        const data = await readCanonicalFileBounded(p, maxBytes - totalBytes);
        totalBytes += data.byteLength;
        files.push(
          new File([data], basename(p), {
            type: inferMimeFromPath(p),
          }),
        );
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        const msg = err instanceof Error ? err.message : String(err);
        if (code === 'ENOENT') return { ok: false, error: `File not found: ${p}` };
        if (code === 'EACCES') return { ok: false, error: `Permission denied reading ${p}` };
        if (code === 'EISDIR') {
          return { ok: false, error: `Expected a file, got a directory: ${p}` };
        }
        if (err instanceof RangeError) {
          return {
            ok: false,
            error: `Input size exceeds limit ${(maxBytes / 1024 / 1024).toFixed(0)} MB. Raise WYREUP_MAX_INPUT_BYTES if intentional.`,
          };
        }
        return { ok: false, error: `Could not read ${p}: ${msg}` };
      }
    }
    return { ok: true, files };
  }

  // Build an AbortSignal that fires after `timeoutMs` (or never if 0/undefined).
  // Uses AbortSignal.timeout (Node 17.3+) so we don't have to wire setTimeout
  // ourselves. The reason on the abort signal is a DOMException with name
  // 'TimeoutError'; downstream tools see ctx.signal.aborted === true.
  function makeTimeoutSignal(timeoutMs: number | undefined, clientSignal?: AbortSignal): AbortSignal {
    if (!timeoutMs || timeoutMs <= 0) return clientSignal ?? new AbortController().signal;
    const timeout = AbortSignal.timeout(timeoutMs);
    return clientSignal ? AbortSignal.any([clientSignal, timeout]) : timeout;
  }

  // Handler signature requires Promise return; no internal await needed.
  // eslint-disable-next-line @typescript-eslint/require-await
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        ...CHAIN_TOOL,
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false, // defensive worst case across the chain
          openWorldHint: true, // chain may include network or Pro steps
        },
      },
      ...tools.map((tool) => ({
        name: tool.id,
        description: tool.llmDescription ?? `${tool.name}: ${tool.description}`,
        inputSchema: buildMcpInputSchema(tool),
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: isIdempotent(tool.id),
          openWorldHint: tool.cost === 'credit' || tool.id === 'domain-age-checker',
        },
      })),
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    if (extra.signal?.aborted) return errorResult('Tool request cancelled.');
    const { name, arguments: args } = request.params;

    // Meta-tool: run a chain in one shot.
    if (name === 'wyreup_chain') {
      // CHAIN STAYS IN-PROCESS: chains orchestrate Blob handoffs between steps
      // (intermediates never touch disk). Round-tripping each intermediate through
      // child_process.fork would double the cost of every chain. Because the
      // intermediates live in this process's heap, each step's output (and the
      // cumulative total) is size-capped below to prevent a memory DoS.
      const rawArgs = args ?? {};
      const stepsStr = rawArgs['steps'] as string | undefined;
      const inputPaths = (rawArgs['input_paths'] as string[] | undefined) ?? [];
      const outputPath = rawArgs['output_path'] as string | undefined;
      const outputDir = rawArgs['output_dir'] as string | undefined;
      return withAudit('wyreup_chain', inputPaths, outputPath, async () => {
        let effectiveTimeout: number;
        if (rawArgs['timeout_ms'] === undefined) {
          effectiveTimeout = 1_800_000;
        } else {
          const check = resolveTimeout(rawArgs['timeout_ms']);
          if (!check.ok) return errorResult(check.error);
          effectiveTimeout = check.ms;
        }
        const allowOverwrite = rawArgs['allow_overwrite'] === true;

        if (!stepsStr) {
          return errorResult('wyreup_chain requires a "steps" chain string.');
        }
        const chain = parseChainString(stepsStr);
        if (chain.length === 0) {
          return errorResult('wyreup_chain: no valid steps parsed from input.');
        }
        // Validate every step references a real, MCP-runnable tool.
        for (const step of chain) {
          const t = registry.toolsById.get(step.toolId);
          if (!t) return errorResult(`wyreup_chain: unknown tool "${step.toolId}".`);
          if (!toolRunsOnSurface(t, 'mcp')) {
            return errorResult(
              `wyreup_chain: tool "${step.toolId}" is not available on MCP. ` +
                'Web-only capture primitives (record-audio, take-photo, etc.) cannot run in a chain from MCP.',
            );
          }
        }

        const validatedPaths = await validatePaths(inputPaths, outputPath, outputDir);
        if (!validatedPaths.ok) return errorResult(validatedPaths.error);

        const readResult = await safeReadAllInputs(validatedPaths.inputPaths);
        if (!readResult.ok) return errorResult(readResult.error);
        const inputFiles = readResult.files;

        // If any step in the chain is a Pro tool, the whole chain needs
        // the API key. Fail fast with a clear message instead of letting
        // runPro throw mid-pipeline (which would have already done
        // billable steps).
        const chainHasPro = chain.some((s) => registry.toolsById.get(s.toolId)?.cost === 'credit');
        if (chainHasPro && !proApiKey) {
          return errorResult(
            'wyreup_chain includes a Pro tool but WYREUP_API_KEY is not set. ' +
              'Set the env var on the MCP server process and restart.',
          );
        }

        // Run the chain a step at a time so we can cap each intermediate
        // Blob (and the cumulative size) before it feeds the next step. Each
        // single-step runChain() call reuses core's per-step type-compat and
        // tool.run logic; we only add the size gate between steps.
        const ctx = {
          onProgress: () => {},
          signal: makeTimeoutSignal(effectiveTimeout, extra.signal),
          cache: new Map<string, unknown>(),
          executionId: randomUUID(),
          apiKey: proApiKey,
          proOrigin,
        };
        const stepCap = resolveChainStepCap();
        const totalCap = stepCap * 2; // cumulative ceiling across all steps
        let stepInputs: File[] = inputFiles;
        let stepOutputs: Blob[] = inputFiles;
        let cumulativeBytes = 0;
        try {
          for (let i = 0; i < chain.length; i++) {
            stepOutputs = await runChain([chain[i]!], stepInputs, ctx, registry);
            ctx.signal.throwIfAborted();

            const stepBytes = totalBlobBytes(stepOutputs);
            if (stepBytes > stepCap) {
              return errorResult(
                `wyreup_chain: step ${i + 1} (${chain[i]!.toolId}) produced ` +
                  `${(stepBytes / 1024 / 1024).toFixed(1)} MB, exceeding the ` +
                  `${(stepCap / 1024 / 1024).toFixed(0)} MB per-step ` +
                  `intermediate cap. Aborting before the next step.`,
              );
            }
            cumulativeBytes += stepBytes;
            if (cumulativeBytes > totalCap) {
              return errorResult(
                `wyreup_chain: cumulative intermediate size ` +
                  `${(cumulativeBytes / 1024 / 1024).toFixed(1)} MB exceeds the ` +
                  `${(totalCap / 1024 / 1024).toFixed(0)} MB chain cap. Aborting.`,
              );
            }

            // Wrap outputs as Files for the next step, preserving input names.
            stepInputs = stepOutputs.map((b, j) => {
              const name = stepInputs[j]?.name ?? `step-${i}-${j}`;
              return new File([b], name, { type: b.type });
            });
          }
        } catch (err) {
          const isTimeout = err instanceof Error && err.name === 'TimeoutError';
          const msg = err instanceof Error ? err.message : String(err);
          if (isTimeout) {
            return errorResult(
              `wyreup_chain timed out after ${effectiveTimeout} ms. Pass a larger timeout_ms (or 0 to disable) for chains that include slow tools (transcribe, audio-enhance, ocr-pro, convert-geo on large inputs).`,
            );
          }
          return errorResult(`wyreup_chain failed: ${msg}`);
        }

        const outputs = stepOutputs;
        const writtenPaths: string[] = [];

        if (outputs.length === 1 && validatedPaths.outputPath) {
          const writeErr = await atomicPublish(
            validatedPaths.outputPath,
            new Uint8Array(await outputs[0]!.arrayBuffer()),
            allowOverwrite,
            {}, ctx.signal,
          );
          if (writeErr) return errorResult(writeErr);
          writtenPaths.push(validatedPaths.outputPath);
        } else if (validatedPaths.outputDir) {
          // Use the final step's tool ID in the filename so multi-output
          // chains stay traceable: the user/agent can see which tool produced
          // each artifact rather than getting opaque "chain-0", "chain-1".
          const finalToolId = chain[chain.length - 1]!.toolId;
          for (let i = 0; i < outputs.length; i++) {
            const ext = extFromMime(outputs[i]!.type);
            const outPath = join(validatedPaths.outputDir, `${finalToolId}-${i}${ext}`);
            const writeErr = await atomicPublish(
              outPath,
              new Uint8Array(await outputs[i]!.arrayBuffer()),
              allowOverwrite,
              {}, ctx.signal,
            );
            if (writeErr) return errorResult(writeErr);
            writtenPaths.push(outPath);
          }
        } else if (outputs.length > 0 && !outputDir && !outputPath) {
          const blob = outputs[0]!;
          if (blob.type.startsWith('text/') || blob.type === 'application/json') {
            const text = await blob.text();
            return { content: [{ type: 'text', text }] };
          }
          return errorResult(
            'Chain produced binary output but no output_path was provided. Rerun with output_path or output_dir.',
          );
        }

        return {
          content: [
            {
              type: 'text',
              text: `Chain completed (${chain.length} step${chain.length === 1 ? '' : 's'}). Output${writtenPaths.length > 1 ? 's' : ''}:\n${writtenPaths.join('\n')}`,
            },
          ],
        };
      });
    }

    const tool = registry.toolsById.get(name);
    if (!tool || !toolRunsOnSurface(tool, 'mcp')) {
      return errorResult(`Unknown tool: ${name}`);
    }

    // Pro tools need an API key. Without one we'd have already hidden
    // it from the listing, but a stale agent / forced invocation could
    // still target it — fail loud rather than silently doing nothing.
    if (tool.cost === 'credit' && !proApiKey) {
      return errorResult(
        `Tool "${tool.id}" is a Pro tool. Set WYREUP_API_KEY on the MCP server process and restart.`,
      );
    }

    const rawArgs = args ?? {};
    const inputPaths = (rawArgs['input_paths'] as string[] | undefined) ?? [];
    const outputPath = rawArgs['output_path'] as string | undefined;
    const outputDir = rawArgs['output_dir'] as string | undefined;
    let params: Record<string, unknown>;
    try {
      params = admitToolParams(tool, rawArgs['params'] === undefined ? {} : rawArgs['params']);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid tool parameters.';
      return errorResult(`Tool "${tool.id}" parameters refused: ${message}`);
    }

    const timeoutCheck = resolveTimeout(rawArgs['timeout_ms']);
    if (!timeoutCheck.ok) return errorResult(timeoutCheck.error);
    const timeoutMs = timeoutCheck.ms;

    const allowOverwrite = rawArgs['allow_overwrite'] === true;

    return withAudit(name, inputPaths, outputPath, async () => {
      const validatedPaths = await validatePaths(inputPaths, outputPath, outputDir);
      if (!validatedPaths.ok) return errorResult(validatedPaths.error);

      const disableIsolation = process.env['WYREUP_DISABLE_WORKER_ISOLATION'] === '1';

      if (disableIsolation) {
        const signal = makeTimeoutSignal(timeoutMs, extra.signal);
        // Legacy in-process path for debugging. The worker path is the default.
        const readResult = await safeReadAllInputs(validatedPaths.inputPaths);
        if (!readResult.ok) return errorResult(readResult.error);
        const inputFiles = readResult.files;

        let toolResult: Blob[] | Blob;
        try {
          toolResult = await tool.run(inputFiles, params, {
            onProgress: () => {},
            signal,
            cache: new Map(),
            executionId: randomUUID(),
            apiKey: proApiKey,
            proOrigin,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return errorResult(`Tool "${tool.id}" failed: ${msg}`);
        }

        if (signal.aborted) return errorResult('Tool request cancelled or timed out.');
        const outputs = Array.isArray(toolResult) ? toolResult : [toolResult];
        const writtenPaths: string[] = [];

        if (outputs.length === 1 && validatedPaths.outputPath) {
          const writeErr = await atomicPublish(
            validatedPaths.outputPath,
            new Uint8Array(await outputs[0]!.arrayBuffer()),
            allowOverwrite,
            {}, signal,
          );
          if (writeErr) return errorResult(writeErr);
          writtenPaths.push(validatedPaths.outputPath);
        } else if (validatedPaths.outputDir) {
          for (let i = 0; i < outputs.length; i++) {
            const ext = extFromMime(outputs[i]!.type);
            const outPath = join(validatedPaths.outputDir, `${tool.id}-${i}${ext}`);
            const writeErr = await atomicPublish(
              outPath,
              new Uint8Array(await outputs[i]!.arrayBuffer()),
              allowOverwrite,
              {}, signal,
            );
            if (writeErr) return errorResult(writeErr);
            writtenPaths.push(outPath);
          }
        } else if (outputs.length > 0 && !outputDir && !outputPath) {
          const blob = outputs[0]!;
          if (blob.type.startsWith('text/') || blob.type === 'application/json') {
            const text = await blob.text();
            return { content: [{ type: 'text', text }] };
          }
          return errorResult(
            `Tool "${tool.id}" produced binary output but no output_path${tool.output.multiple ? '/output_dir' : ''} was provided. Rerun with an output path.`,
          );
        }

        return {
          content: [
            {
              type: 'text',
              text: `Successfully processed. Output${writtenPaths.length > 1 ? 's' : ''}:\n${writtenPaths.join('\n')}`,
            },
          ],
        };
      }

      // Worker path (default).
      const workerResult = await runInWorker({
        toolId: tool.id,
        inputPaths,
        params,
        outputPath,
        outputDir,
        timeoutMs,
        proApiKey: tool.cost === 'credit' ? proApiKey : undefined,
        proOrigin,
        modelCdn: modelCdn.base,
        modelAllowedOrigins: modelCdn.allowedOrigins,
        allowedRoots,
        allowOverwrite,
        maxBytes,
      }, extra.signal);

      if (!workerResult.ok) {
        return errorResult(sanitize(workerResult.error, proApiKey));
      }

      if (workerResult.textOutput !== undefined) {
        return { content: [{ type: 'text', text: workerResult.textOutput }] };
      }

      return {
        content: [
          {
            type: 'text',
            text: `Successfully processed. Output${workerResult.writtenPaths.length > 1 ? 's' : ''}:\n${workerResult.writtenPaths.join('\n')}`,
          },
        ],
      };
    });
  });

  // Test-only, non-enumerable handle to the registry the handlers close over,
  // so tests can inject a synthetic tool. Non-enumerable keeps it out of the
  // server's public/serialized shape; it is harmless in production.
  Object.defineProperty(server, '__wyreupRegistry', {
    value: registry,
    enumerable: false,
    configurable: true,
  });

  return server;
}

export { StdioServerTransport };
