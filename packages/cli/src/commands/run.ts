import { readFile, mkdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Command } from 'commander';
import { createDefaultRegistry } from '@wyreup/core';
import type { ToolModule, ToolRunContext } from '@wyreup/core';
import { inferMimeFromPath, extFromMime } from '../lib/mime.js';
import { formatSuggestion } from '../lib/fuzzy.js';
import { readApiKey, resolveProOrigin } from '../lib/credentials.js';
import { interactiveLogin } from '../lib/interactive-login.js';
import { atomicPublish } from '../lib/safety/atomic-publish.js';
import { resolveTimeout } from '../lib/safety/timeout.js';
import { printError } from '../lib/safety/print-error.js';

// ──── shared context builder ──────────────────────────────────────────────────

interface CtxOptions {
  verbose: boolean;
  ac: AbortController;
  apiKey?: string;
  proOrigin?: string;
}

function makeCtx(opts: CtxOptions): ToolRunContext {
  return {
    onProgress: opts.verbose
      ? (p) => {
          const pct = p.percent !== undefined ? ` ${p.percent}%` : '';
          process.stderr.write(`[${p.stage}]${pct}${p.message ? ' ' + p.message : ''}\n`);
        }
      : () => {},
    signal: opts.ac.signal,
    cache: new Map(),
    executionId: randomUUID(),
    apiKey: opts.apiKey,
    proOrigin: opts.proOrigin,
  };
}

// ──── file I/O ────────────────────────────────────────────────────────────────

async function readInputFiles(
  paths: string[],
  overrideMime?: string,
): Promise<File[]> {
  const files: File[] = [];
  for (const p of paths) {
    const bytes = await readFile(p);
    const mime = overrideMime ?? inferMimeFromPath(p);
    files.push(new File([bytes], basename(p), { type: mime }));
  }
  return files;
}

async function readStdin(overrideMime: string): Promise<File> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  const buf = Buffer.concat(chunks);
  return new File([buf], 'stdin', { type: overrideMime });
}

async function writeOutputs(
  outputs: Blob[],
  toolId: string,
  outputPath: string | undefined,
  outputDir: string | undefined,
  json: boolean,
  multi: boolean,
  overwrite: boolean,
): Promise<void> {
  // JSON-style output: text or json MIME with no output path → stdout
  if (!outputPath && !outputDir) {
    const blob = outputs[0];
    if (!blob) return;
    if (
      json ||
      blob.type.startsWith('text/') ||
      blob.type === 'application/json'
    ) {
      const text = await blob.text();
      process.stdout.write(text);
      if (!text.endsWith('\n')) process.stdout.write('\n');
      return;
    }
    // Binary with no output path: write to stdout raw (piping case)
    if (!process.stdout.isTTY) {
      const buf = Buffer.from(await blob.arrayBuffer());
      process.stdout.write(buf);
      return;
    }
    process.stderr.write(
      `Tool "${toolId}" produced binary output.\n` +
        `Use -o <path> to write to a file or pipe to a file with > output${extFromMime(blob.type)}.\n`,
    );
    process.exit(1);
  }

  if (multi || outputs.length > 1) {
    // Multi-output: require -O
    if (!outputDir) {
      process.stderr.write(
        `Tool "${toolId}" produces multiple files. Use -O <dir> to specify an output directory.\n`,
      );
      process.exit(1);
    }
    await mkdir(outputDir, { recursive: true });
    for (let i = 0; i < outputs.length; i++) {
      const blob = outputs[i]!;
      const ext = extFromMime(blob.type);
      const outPath = join(outputDir, `${toolId}-${i}${ext}`);
      const writeErr = await atomicPublish(outPath, new Uint8Array(await blob.arrayBuffer()), overwrite);
      if (writeErr) throw new Error(writeErr);
      process.stderr.write(`Written: ${outPath}\n`);
    }
    return;
  }

  // Single output
  const blob = outputs[0]!;
  const outPath = outputPath!;
  const writeErr = await atomicPublish(outPath, new Uint8Array(await blob.arrayBuffer()), overwrite);
  if (writeErr) throw new Error(writeErr);
}

// ──── param parsing ───────────────────────────────────────────────────────────

function coerce(value: string): unknown {
  if (value === 'true') return true;
  if (value === 'false') return false;
  const n = Number(value);
  if (!Number.isNaN(n) && value.trim() !== '') return n;
  return value;
}

function parseKeyValuePairs(pairs: string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const pair of pairs) {
    const eq = pair.indexOf('=');
    if (eq === -1) {
      process.stderr.write(`Warning: ignoring malformed --param "${pair}" (expected key=value)\n`);
      continue;
    }
    result[pair.slice(0, eq).trim()] = coerce(pair.slice(eq + 1));
  }
  return result;
}

// ──── core runner ─────────────────────────────────────────────────────────────

export interface RunOptions {
  output?: string;
  outputDir?: string;
  param?: string[];
  inputFormat?: string;
  json?: boolean;
  verbose?: boolean;
  overwrite?: boolean;
  timeout?: number;
}

export async function executeTool(
  toolId: string,
  inputPaths: string[],
  opts: RunOptions,
): Promise<void> {
  const registry = createDefaultRegistry();
  const tool = registry.toolsById.get(toolId);
  if (!tool) {
    process.stderr.write(formatSuggestion(toolId, Array.from(registry.toolsById.keys())));
    process.exit(1);
  }

  const useStdin =
    inputPaths.length === 0 ||
    (inputPaths.length === 1 && inputPaths[0] === '-');

  const isStdinMode =
    useStdin && (inputPaths[0] === '-' || !process.stdin.isTTY);

  // Friendly guard: an interactive shell (stdin is a TTY) running a tool
  // that needs input but with no file args and no piped stdin would
  // otherwise hang reading empty stdin. Exit early with actionable copy.
  if (
    useStdin &&
    !isStdinMode &&
    tool.input.min > 0 &&
    process.stdin.isTTY
  ) {
    process.stderr.write(
      `Tool "${tool.id}" needs at least ${tool.input.min} input file${tool.input.min === 1 ? '' : 's'}.\n` +
        `Pass a file path as an argument, or pipe data via stdin:\n` +
        `  wyreup run ${tool.id} <file>\n` +
        `  cat <file> | wyreup run ${tool.id} --input-format <mime>\n`,
    );
    process.exit(1);
  }

  // Pro tools (cost: 'credit') need an API key for the Bearer-auth
  // path in lib/pro-runner.ts. Resolve this BEFORE reading any input —
  // if a TTY user runs `wyreup run <pro-tool> -` and we drain stdin
  // first, the interactive login prompt's readline gets immediate EOF
  // and silently fails. Order: env/file lookup → maybe prompt → then
  // read tool input.
  let apiKey: string | undefined;
  let proOrigin: string | undefined;
  if (tool.cost === 'credit') {
    let key = await readApiKey();
    if (!key) {
      if (isStdinMode) {
        // Stdin is already earmarked for tool input — we can't also use
        // it for an interactive prompt. Tell the user explicitly so
        // they don't get a confusing "no API key found" after their
        // pipe finishes.
        process.stderr.write(
          `Tool "${tool.id}" is a Pro tool, but stdin is reserved for tool input.\n` +
            `Save your key first with \`wyreup login\`, or set WYREUP_API_KEY in your shell.\n`,
        );
        process.exit(1);
      }
      key = await interactiveLogin({
        intro:
          `\n"${tool.id}" is a Wyreup Pro tool. It needs your API key to run.\n` +
          'Get one at https://wyreup.com/account (free signup, packs start at $5/220 credits).',
      });
    }
    if (!key) {
      process.stderr.write(
        `Tool "${tool.id}" is a Pro tool — no API key found.\n` +
          `Get one at https://wyreup.com/account, then either:\n` +
          `  • run \`wyreup login\` to save it locally, or\n` +
          `  • export WYREUP_API_KEY=...\n`,
      );
      process.exit(1);
    }
    apiKey = key;
    proOrigin = resolveProOrigin();
  }

  // Collect input files — stdin is safe to drain now that any Pro
  // login prompt has already completed.
  let inputFiles: File[];

  if (isStdinMode && tool.input.min > 0) {
    if (!opts.inputFormat) {
      process.stderr.write(
        `Reading from stdin — use --input-format <mime> to specify the MIME type.\n`,
      );
      // Use a generic fallback
    }
    const mime = opts.inputFormat ?? 'application/octet-stream';
    inputFiles = [await readStdin(mime)];
  } else if (inputPaths.length > 0 && inputPaths[0] !== '-') {
    inputFiles = await readInputFiles(inputPaths, opts.inputFormat);
  } else {
    inputFiles = [];
  }

  // Collect params: start with tool defaults, overlay --param flags, then per-tool flags
  const paramOverrides = parseKeyValuePairs(opts.param ?? []);
  const params = { ...(tool.defaults as Record<string, unknown>), ...paramOverrides };

  const timeoutResult = resolveTimeout(opts.timeout);
  if (!timeoutResult.ok) {
    process.stderr.write(`${timeoutResult.error}\n`);
    process.exit(1);
  }
  const { ms: timeoutMs } = timeoutResult;

  const ac = new AbortController();
  process.on('SIGINT', () => ac.abort());
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  if (timeoutMs > 0) {
    timeoutHandle = setTimeout(() => ac.abort(new Error(`Tool timed out after ${timeoutMs}ms`)), timeoutMs);
  }

  const ctx = makeCtx({
    verbose: opts.verbose ?? false,
    ac,
    apiKey,
    proOrigin,
  });

  let result: Blob | Blob[];
  try {
    result = await tool.run(inputFiles, params, ctx);
  } catch (err) {
    await printError(`Error running ${toolId}`, err);
    process.exit(1);
  } finally {
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
  }

  const outputs = Array.isArray(result) ? result : [result];

  // Stdout piping for single-output binary: if no -o and stdout is a pipe
  if (
    !opts.output &&
    !opts.outputDir &&
    !process.stdout.isTTY &&
    outputs.length === 1
  ) {
    const blob = outputs[0]!;
    if (blob.type.startsWith('text/') || blob.type === 'application/json') {
      process.stdout.write(await blob.text());
    } else {
      const buf = Buffer.from(await blob.arrayBuffer());
      process.stdout.write(buf);
    }
    return;
  }

  // Use actual output count (not tool.output.multiple) because some tools
  // declare multiple=true but return a single blob based on params.
  await writeOutputs(
    outputs,
    toolId,
    opts.output,
    opts.outputDir,
    opts.json ?? false,
    outputs.length > 1,
    opts.overwrite ?? false,
  );
}

// ──── per-tool dynamic option registration ────────────────────────────────────

export function addToolOptions(cmd: Command, tool: ToolModule): void {
  if (!tool.paramSchema) return;
  for (const [key, schema] of Object.entries(tool.paramSchema)) {
    if (!schema || typeof schema !== 'object') continue;
    const flagName = `--${key} <value>`;
    const s = schema as { label?: unknown; help?: unknown };
    const label = typeof s.label === 'string' ? s.label : '';
    const helpText = typeof s.help === 'string' ? s.help : '';
    const combined = (label ? `${label}. ` : '') + helpText;

    cmd.option(flagName, combined || key);
  }
}

// ──── CLI wiring helper ───────────────────────────────────────────────────────

/**
 * Given Commander parsed options, merge per-tool named options into the
 * --param list. Called after parse so Commander has populated the named flags.
 */
export function mergeToolOptions(
  rawOpts: Record<string, unknown>,
  tool: ToolModule,
): string[] {
  const extra: string[] = [];
  if (!tool.paramSchema) return extra;
  for (const key of Object.keys(tool.paramSchema)) {
    if (Object.prototype.hasOwnProperty.call(rawOpts, key) && rawOpts[key] !== undefined) {
      const v = rawOpts[key];
      const str =
        typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'
          ? String(v)
          : JSON.stringify(v);
      extra.push(`${key}=${str}`);
    }
  }
  return extra;
}
