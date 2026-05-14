import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { createDefaultRegistry, toolRunsOnSurface, runChain, parseChainString } from '@wyreup/core';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, basename, join } from 'node:path';
import { randomUUID } from 'node:crypto';

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
  pdf: 'application/pdf',
  txt: 'text/plain',
  html: 'text/html',
  htm: 'text/html',
  md: 'text/markdown',
  json: 'application/json',
  csv: 'text/csv',
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
  'application/pdf': '.pdf',
  'text/plain': '.txt',
  'text/html': '.html',
  'text/markdown': '.md',
  'application/json': '.json',
  'text/csv': '.csv',
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

function inferParamType(value: unknown): Record<string, unknown> {
  if (value === null || value === undefined) return { type: 'null' };
  if (Array.isArray(value)) {
    if (value.length === 0) return { type: 'array', items: {} };
    return { type: 'array', items: inferParamType(value[0]) };
  }
  switch (typeof value) {
    case 'boolean': return { type: 'boolean' };
    case 'number': return { type: 'number' };
    case 'string': return { type: 'string' };
    case 'object': {
      const properties: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        properties[k] = inferParamType(v);
      }
      return { type: 'object', properties };
    }
    default: return {};
  }
}

function buildParamsSchema(defaults: unknown): Record<string, unknown> {
  if (!defaults || typeof defaults !== 'object' || Array.isArray(defaults)) {
    return { type: 'object', additionalProperties: true };
  }
  const properties: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(defaults as Record<string, unknown>)) {
    properties[key] = inferParamType(val);
  }
  return { type: 'object', properties, additionalProperties: true };
}

function buildMcpInputSchema(tool: { defaults: unknown; output: { multiple?: boolean } }): Record<string, unknown> {
  const isMultiOutput = tool.output.multiple === true;
  const properties: Record<string, unknown> = {
    input_paths: {
      type: 'array',
      items: { type: 'string' },
      description: 'Absolute paths to input files on disk.',
    },
    params: {
      ...buildParamsSchema(tool.defaults),
      description: 'Tool-specific parameters. Uses defaults if omitted.',
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

export function createWyreupMcpServer(): Server {
  const registry = createDefaultRegistry();
  // Hide tools that can't run via MCP (e.g. web-only capture
  // primitives like record-audio that need getUserMedia). They aren't
  // listed and aren't callable — the agent never sees them as an
  // option, so there's no fail path.
  const tools = Array.from(registry.toolsById.values()).filter((t) =>
    toolRunsOnSurface(t, 'mcp'),
  );

  const server = new Server(
    { name: 'wyreup', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  // The `wyreup_chain` meta-tool lets agents run a multi-step chain
  // in a single call instead of orchestrating each tool individually.
  // Same pipeline the web's /chain/run uses; same chain string syntax
  // the CLI's `wyreup chain --steps "..."` accepts.
  const CHAIN_TOOL = {
    name: 'wyreup_chain',
    description:
      'Run a chain of Wyreup tools in sequence. Each step\'s output becomes the next step\'s input. ' +
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
          description: 'Directory for multi-output chains (each output written with a tool-derived name).',
        },
        timeout_ms: {
          type: 'number',
          description:
            'Optional max runtime in milliseconds before the chain is aborted. Default 1800000 (30 min). Override upward for chains that include slow models — transcribe (~5–10 min/hour of audio), audio-enhance, ocr-pro — or downward for known-fast chains. Pass 0 to disable.',
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

  // Read an absolute path into a File. On any I/O error (missing file,
  // permission denied, EISDIR, etc.) returns a structured error message
  // instead of throwing — the LLM sees a clear path to retry.
  async function safeReadFile(
    filePath: string,
  ): Promise<{ ok: true; file: File } | { ok: false; error: string }> {
    try {
      const data = await readFile(filePath);
      return {
        ok: true,
        file: new File([data], basename(filePath), {
          type: inferMimeFromPath(filePath),
        }),
      };
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      const msg = err instanceof Error ? err.message : String(err);
      if (code === 'ENOENT') return { ok: false, error: `File not found: ${filePath}` };
      if (code === 'EACCES') return { ok: false, error: `Permission denied reading ${filePath}` };
      if (code === 'EISDIR') return { ok: false, error: `Expected a file, got a directory: ${filePath}` };
      return { ok: false, error: `Could not read ${filePath}: ${msg}` };
    }
  }

  async function safeReadAllInputs(
    paths: string[],
  ): Promise<{ ok: true; files: File[] } | { ok: false; error: string }> {
    const files: File[] = [];
    for (const p of paths) {
      const r = await safeReadFile(p);
      if (!r.ok) return r;
      files.push(r.file);
    }
    return { ok: true, files };
  }

  async function safeWriteFile(target: string, bytes: Uint8Array): Promise<string | null> {
    try {
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, bytes);
      return null;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      const msg = err instanceof Error ? err.message : String(err);
      if (code === 'EACCES') return `Permission denied writing to ${target}`;
      if (code === 'ENOSPC') return `No space left on device writing ${target}`;
      return `Could not write ${target}: ${msg}`;
    }
  }

  // Build an AbortSignal that fires after `timeoutMs` (or never if 0/undefined).
  // Uses AbortSignal.timeout (Node 17.3+) so we don't have to wire setTimeout
  // ourselves. The reason on the abort signal is a DOMException with name
  // 'TimeoutError'; downstream tools see ctx.signal.aborted === true.
  function makeTimeoutSignal(timeoutMs: number | undefined): AbortSignal {
    if (!timeoutMs || timeoutMs <= 0) return new AbortController().signal;
    return AbortSignal.timeout(timeoutMs);
  }

  // Handler signature requires Promise return; no internal await needed.
  // eslint-disable-next-line @typescript-eslint/require-await
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      CHAIN_TOOL,
      ...tools.map((tool) => ({
        name: tool.id,
        description: tool.llmDescription ?? `${tool.name}: ${tool.description}`,
        inputSchema: buildMcpInputSchema(tool),
      })),
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    // Meta-tool: run a chain in one shot.
    if (name === 'wyreup_chain') {
      const rawArgs = args ?? {};
      const stepsStr = rawArgs['steps'] as string | undefined;
      const inputPaths = (rawArgs['input_paths'] as string[] | undefined) ?? [];
      const outputPath = rawArgs['output_path'] as string | undefined;
      const outputDir = rawArgs['output_dir'] as string | undefined;
      const timeoutMs = rawArgs['timeout_ms'] as number | undefined;

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

      const readResult = await safeReadAllInputs(inputPaths);
      if (!readResult.ok) return errorResult(readResult.error);
      const inputFiles = readResult.files;

      const effectiveTimeout = timeoutMs ?? 1800000; // 30 min default
      let result: Blob[] | Blob;
      try {
        result = await runChain(
          chain,
          inputFiles,
          {
            onProgress: () => {},
            signal: makeTimeoutSignal(effectiveTimeout),
            cache: new Map(),
            executionId: randomUUID(),
          },
          registry,
        );
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

      const outputs = Array.isArray(result) ? result : [result];
      const writtenPaths: string[] = [];

      if (outputs.length === 1 && outputPath) {
        const writeErr = await safeWriteFile(outputPath, new Uint8Array(await outputs[0]!.arrayBuffer()));
        if (writeErr) return errorResult(writeErr);
        writtenPaths.push(outputPath);
      } else if (outputDir) {
        // Use the final step's tool ID in the filename so multi-output
        // chains stay traceable: the user/agent can see which tool produced
        // each artifact rather than getting opaque "chain-0", "chain-1".
        const finalToolId = chain[chain.length - 1]!.toolId;
        for (let i = 0; i < outputs.length; i++) {
          const ext = extFromMime(outputs[i]!.type);
          const outPath = join(outputDir, `${finalToolId}-${i}${ext}`);
          const writeErr = await safeWriteFile(outPath, new Uint8Array(await outputs[i]!.arrayBuffer()));
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
    }

    const tool = registry.toolsById.get(name);
    if (!tool || !toolRunsOnSurface(tool, 'mcp')) {
      return errorResult(`Unknown tool: ${name}`);
    }

    const rawArgs = args ?? {};
    const inputPaths = (rawArgs['input_paths'] as string[] | undefined) ?? [];
    const outputPath = rawArgs['output_path'] as string | undefined;
    const outputDir = rawArgs['output_dir'] as string | undefined;
    const params = (rawArgs['params'] as Record<string, unknown> | undefined) ?? tool.defaults;

    // Read input files from disk with structured error reporting.
    const readResult = await safeReadAllInputs(inputPaths);
    if (!readResult.ok) return errorResult(readResult.error);
    const inputFiles = readResult.files;

    // Run the tool. Errors from tool.run() are tool-level, not transport —
    // surface them as isError content so the LLM can act on them.
    let result: Blob[] | Blob;
    try {
      result = await tool.run(inputFiles, params, {
        onProgress: () => {},
        signal: new AbortController().signal,
        cache: new Map(),
        executionId: randomUUID(),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return errorResult(`Tool "${tool.id}" failed: ${msg}`);
    }

    const outputs = Array.isArray(result) ? result : [result];
    const writtenPaths: string[] = [];

    if (outputs.length === 1 && outputPath) {
      const writeErr = await safeWriteFile(outputPath, new Uint8Array(await outputs[0]!.arrayBuffer()));
      if (writeErr) return errorResult(writeErr);
      writtenPaths.push(outputPath);
    } else if (outputDir) {
      for (let i = 0; i < outputs.length; i++) {
        const ext = extFromMime(outputs[i]!.type);
        const outPath = join(outputDir, `${tool.id}-${i}${ext}`);
        const writeErr = await safeWriteFile(outPath, new Uint8Array(await outputs[i]!.arrayBuffer()));
        if (writeErr) return errorResult(writeErr);
        writtenPaths.push(outPath);
      }
    } else if (outputs.length > 0 && !outputDir && !outputPath) {
      // No output path given — return content inline for text/JSON tools
      const blob = outputs[0]!;
      if (blob.type.startsWith('text/') || blob.type === 'application/json') {
        const text = await blob.text();
        return { content: [{ type: 'text', text }] };
      }
      // Binary with no output path — surface a helpful error
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
  });

  return server;
}

export { StdioServerTransport };
