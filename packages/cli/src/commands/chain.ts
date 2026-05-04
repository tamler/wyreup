import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { basename, join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createDefaultRegistry, runChain, parseChainString, serializeChain } from '@wyreup/core';
import type { ToolRunContext } from '@wyreup/core';
import { inferMimeFromPath, extFromMime } from '../lib/mime.js';
import { formatSuggestion } from '../lib/fuzzy.js';
import { buildDryRun } from './chain-dryrun.js';

// ──── chain URL parser ────────────────────────────────────────────────────────

/**
 * Extract the steps string from a Wyreup chain URL.
 * Accepts:
 *   https://wyreup.com/chain/run?steps=strip-exif|compress[quality=80]
 *   steps=strip-exif|compress
 *   strip-exif|compress   (plain chain string, returned as-is)
 */
export function extractStepsFromUrl(input: string): string {
  try {
    // If it parses as a URL, pull out the steps query param
    const url = new URL(input);
    const steps = url.searchParams.get('steps');
    if (steps) return decodeURIComponent(steps);
    throw new Error('No "steps" query parameter in URL');
  } catch {
    // Not a full URL — check if it looks like key=value
    if (input.startsWith('steps=')) {
      return decodeURIComponent(input.slice('steps='.length));
    }
    // Plain chain string (already pipe-delimited)
    return input;
  }
}

// ──── options ─────────────────────────────────────────────────────────────────

export interface ChainOptions {
  steps?: string;
  fromUrl?: string;
  fromKit?: string;
  name?: string;
  output?: string;
  outputDir?: string;
  saveIntermediates?: string;
  inputFormat?: string;
  verbose?: boolean;
  /** Print the parsed plan + MIME flow + install groups; do not execute. */
  dryRun?: boolean;
}

interface KitChainStep {
  toolId: string;
  params: Record<string, unknown>;
}
interface KitChain {
  id: string;
  name: string;
  steps: KitChainStep[];
}

/**
 * Read a chain by name (or id, or substring) from a kit JSON file —
 * the same format the web's My Kit exports via "Export kit" on
 * `/my-kit`. Returns the steps as a chain string, or throws on
 * missing file / no match / ambiguous match.
 */
async function loadFromKit(path: string, nameOrId: string): Promise<string> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    throw new Error(`Could not read kit file: ${path}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Kit file is not valid JSON: ${path}`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`Kit file must be a JSON array of chains: ${path}`);
  }
  const chains = parsed as KitChain[];

  const needle = nameOrId.trim().toLowerCase();
  const exactId = chains.find((c) => c.id === nameOrId);
  if (exactId) return serializeChain(exactId.steps);

  const exactName = chains.filter((c) => c.name.toLowerCase() === needle);
  if (exactName.length === 1) return serializeChain(exactName[0]!.steps);
  if (exactName.length > 1) {
    throw new Error(
      `Multiple chains named "${nameOrId}" in kit file; use a unique id instead.`,
    );
  }

  const partial = chains.filter((c) => c.name.toLowerCase().includes(needle));
  if (partial.length === 1) return serializeChain(partial[0]!.steps);
  if (partial.length > 1) {
    const opts = partial.map((c) => `  ${c.name}`).join('\n');
    throw new Error(
      `"${nameOrId}" matches multiple chains in kit file:\n${opts}\nUse the full name or id.`,
    );
  }

  const all = chains.map((c) => `  ${c.name}`).join('\n');
  throw new Error(
    `No chain "${nameOrId}" in ${path}.\nAvailable:\n${all || '  (kit is empty)'}`,
  );
}

// ──── runner ──────────────────────────────────────────────────────────────────

export async function executeChain(
  inputPaths: string[],
  opts: ChainOptions,
): Promise<void> {
  // Resolve the chain string from the chosen source.
  let rawSteps = '';
  if (opts.fromKit) {
    if (!opts.name) {
      process.stderr.write('--from-kit requires --name <chain-name>.\n');
      process.exit(1);
    }
    try {
      rawSteps = await loadFromKit(opts.fromKit, opts.name);
    } catch (err) {
      process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    }
  } else if (opts.fromUrl) {
    rawSteps = extractStepsFromUrl(opts.fromUrl);
  } else {
    rawSteps = opts.steps ?? '';
  }

  if (!rawSteps.trim()) {
    process.stderr.write(
      'Provide --steps "tool1|tool2", --from-url <url>, or --from-kit <kit.json> --name <chain-name>.\n',
    );
    process.exit(1);
  }

  const chain = parseChainString(rawSteps);
  if (chain.length === 0) {
    process.stderr.write('Chain is empty after parsing.\n');
    process.exit(1);
  }

  // Validate all steps before running
  const registry = createDefaultRegistry();
  for (let i = 0; i < chain.length; i++) {
    const step = chain[i]!;
    if (!registry.toolsById.has(step.toolId)) {
      const allIds = Array.from(registry.toolsById.keys());
      process.stderr.write(`In step ${i + 1}: ` + formatSuggestion(step.toolId, allIds));
      process.exit(1);
    }
  }

  // Dry-run: print plan + MIME flow + install groups, then exit. No I/O,
  // no file reads, no stdin consumption. Same exit code regardless of
  // mime-flow warnings — they're advisory, not fatal.
  if (opts.dryRun) {
    const report = buildDryRun(chain, registry);
    process.stdout.write(report.text);
    process.exit(0);
  }

  // Read input files
  let inputFiles: File[];
  const useStdin =
    inputPaths.length === 0 ||
    (inputPaths.length === 1 && inputPaths[0] === '-');

  if (useStdin && !process.stdin.isTTY) {
    const mime = opts.inputFormat ?? 'application/octet-stream';
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk as Buffer);
    }
    const buf = Buffer.concat(chunks);
    inputFiles = [new File([buf], 'stdin', { type: mime })];
  } else if (inputPaths.length > 0 && inputPaths[0] !== '-') {
    inputFiles = await Promise.all(
      inputPaths.map(async (p) => {
        const bytes = await readFile(p);
        const mime = opts.inputFormat ?? inferMimeFromPath(p);
        return new File([bytes], basename(p), { type: mime });
      }),
    );
  } else {
    inputFiles = [];
  }

  // Intermediate saving support
  const saveDir = opts.saveIntermediates;
  if (saveDir) {
    await mkdir(saveDir, { recursive: true });
  }

  // Build a wrapped context that saves intermediates per step
  const ac = new AbortController();
  process.on('SIGINT', () => ac.abort());

  const ctx: ToolRunContext = {
    onProgress: opts.verbose
      ? (p) => {
          const pct = p.percent !== undefined ? ` ${p.percent}%` : '';
          process.stderr.write(`[${p.stage}]${pct}${p.message ? ' ' + p.message : ''}\n`);
        }
      : () => {},
    signal: ac.signal,
    cache: new Map(),
    executionId: randomUUID(),
  };

  // Run with intermediate saves if requested
  let outputs: Blob[];

  if (saveDir) {
    // Run step by step to capture intermediates
    let current: File[] = inputFiles;
    for (let i = 0; i < chain.length; i++) {
      const step = chain[i]!;
      const tool = registry.toolsById.get(step.toolId)!;
      const params = { ...(tool.defaults as Record<string, unknown>), ...step.params };
      const result = await tool.run(current, params, ctx);
      const blobs = Array.isArray(result) ? result : [result];
      // Save intermediates
      for (let j = 0; j < blobs.length; j++) {
        const blob = blobs[j]!;
        const ext = extFromMime(blob.type);
        const outPath = join(saveDir, `step-${i + 1}-${step.toolId}-${j}${ext}`);
        await writeFile(outPath, Buffer.from(await blob.arrayBuffer()));
        if (opts.verbose) {
          process.stderr.write(`Intermediate: ${outPath}\n`);
        }
      }
      current = blobs.map((b, j) => {
        const name = current[j]?.name ?? `step-${i}-${j}`;
        return new File([b], name, { type: b.type });
      });
    }
    outputs = current.map((f) => new Blob([f], { type: f.type }));
  } else {
    try {
      outputs = await runChain(chain, inputFiles, ctx, registry);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`Chain error: ${msg}\n`);
      process.exit(1);
    }
  }

  if (outputs.length === 0) {
    process.stderr.write('Chain produced no output.\n');
    process.exit(1);
  }

  // Write outputs
  // Use actual output count rather than the tool spec's `multiple` flag,
  // because some tools declare multiple=true but return a single blob
  // depending on params (e.g. compress with a single input).
  const isMulti = outputs.length > 1;

  if (isMulti) {
    if (!opts.outputDir) {
      process.stderr.write(
        `Chain produced ${outputs.length} files. Use -O <dir> to specify an output directory.\n`,
      );
      process.exit(1);
    }
    await mkdir(opts.outputDir, { recursive: true });
    for (let i = 0; i < outputs.length; i++) {
      const blob = outputs[i]!;
      const ext = extFromMime(blob.type);
      const outPath = join(opts.outputDir, `chain-output-${i}${ext}`);
      await writeFile(outPath, Buffer.from(await blob.arrayBuffer()));
      process.stderr.write(`Written: ${outPath}\n`);
    }
    return;
  }

  const blob = outputs[0]!;

  // Stdout pipe
  if (!opts.output && !process.stdout.isTTY) {
    if (blob.type.startsWith('text/') || blob.type === 'application/json') {
      process.stdout.write(await blob.text());
    } else {
      process.stdout.write(Buffer.from(await blob.arrayBuffer()));
    }
    return;
  }

  if (!opts.output) {
    // Text/JSON with no output path — print to stdout
    if (blob.type.startsWith('text/') || blob.type === 'application/json') {
      const text = await blob.text();
      process.stdout.write(text);
      if (!text.endsWith('\n')) process.stdout.write('\n');
      return;
    }
    process.stderr.write(
      `Chain produced binary output. Use -o <path> to save it.\n`,
    );
    process.exit(1);
  }

  await mkdir(dirname(opts.output), { recursive: true });
  await writeFile(opts.output, Buffer.from(await blob.arrayBuffer()));
}
