import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { basename, join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Command } from 'commander';
import { createDefaultRegistry } from '@wyreup/core';
import type { ToolModule, ToolRunContext } from '@wyreup/core';
import { inferMimeFromPath, extFromMime } from '../lib/mime.js';
import { formatSuggestion } from '../lib/fuzzy.js';

// ──── shared context builder ──────────────────────────────────────────────────

function makeCtx(verbose: boolean, ac: AbortController): ToolRunContext {
  return {
    onProgress: verbose
      ? (p) => {
          const pct = p.percent !== undefined ? ` ${p.percent}%` : '';
          process.stderr.write(`[${p.stage}]${pct}${p.message ? ' ' + p.message : ''}\n`);
        }
      : () => {},
    signal: ac.signal,
    cache: new Map(),
    executionId: randomUUID(),
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
      await writeFile(outPath, Buffer.from(await blob.arrayBuffer()));
      process.stderr.write(`Written: ${outPath}\n`);
    }
    return;
  }

  // Single output
  const blob = outputs[0]!;
  const outPath = outputPath!;
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, Buffer.from(await blob.arrayBuffer()));
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

  // Collect input files
  let inputFiles: File[];

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

  const ac = new AbortController();
  process.on('SIGINT', () => ac.abort());

  const ctx = makeCtx(opts.verbose ?? false, ac);

  let result: Blob | Blob[];
  try {
    result = await tool.run(inputFiles, params, ctx);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Error running ${toolId}: ${msg}\n`);
    process.exit(1);
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
