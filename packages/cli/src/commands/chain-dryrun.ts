/**
 * `wyreup chain --dry-run` formatter. Prints the parsed pipeline, the
 * MIME flow between adjacent steps, and a tally of lazy-loaded install
 * groups so the user can see what they're about to download before
 * running a heavy chain.
 *
 * No I/O. No file reads. Just inspection.
 */

import { type Chain, mimeMatches, type ToolModule, type ToolRegistry } from '@wyreup/core';

/**
 * Check whether a producer's declared output MIME could feed a consumer's
 * accept list. Some tools declare wildcard outputs like `image/*` to mean
 * "I preserve the input's concrete format" — at runtime that resolves to
 * a specific type the consumer probably accepts. Treat such wildcards as
 * compatible whenever the consumer accepts the same family.
 */
function couldFlowTo(producerOutput: string, consumerAccept: string[]): boolean {
  const out = producerOutput.split(';')[0]?.trim().toLowerCase() ?? '';
  if (out.endsWith('/*')) {
    const family = out.slice(0, -1); // 'image/'
    return consumerAccept.some((pattern) => {
      const p = pattern.split(';')[0]?.trim().toLowerCase() ?? '';
      if (p === '*' || p === '*/*') return true;
      if (p.endsWith('/*')) return p.startsWith(family) || family.startsWith(p.slice(0, -1));
      return p.startsWith(family);
    });
  }
  return consumerAccept.some((p) => mimeMatches(producerOutput, p));
}

export interface DryRunResult {
  /** Human-readable text. Written to stderr from the CLI. */
  text: string;
  /** True if every step's input pattern matches the previous step's output. */
  mimeFlowOk: boolean;
  /** Total install bytes across distinct install groups in this chain. */
  totalInstallBytes: number;
}

interface StepRow {
  index: number;
  toolId: string;
  paramOverrides: string;
  inputAccept: string[];
  outputMime: string;
  installGroup?: string;
  installSize?: number;
  /** Set when the previous step's output mime doesn't match this step's accept. */
  mismatch?: { previousOutput: string; thisAccepts: string[] };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(2)} GB`;
}

function paramSummary(params: Record<string, unknown>): string {
  const keys = Object.keys(params);
  if (keys.length === 0) return '';
  return keys.map((k) => `${k}=${String(params[k])}`).join(', ');
}

/**
 * Compute the dry-run report. Pure — no I/O, no process exit. The CLI
 * caller handles printing and exit code.
 */
export function buildDryRun(chain: Chain, registry: ToolRegistry): DryRunResult {
  // Validate every tool ID up front. The CLI already does this for the
  // execution path, but the dry-run is meant to surface problems before
  // running, so do it again here in case future call sites skip the
  // up-front check.
  const unknown = chain
    .map((step, i) => ({ step, i }))
    .filter(({ step }) => !registry.toolsById.has(step.toolId));
  if (unknown.length > 0) {
    const names = unknown.map(({ step, i }) => `step ${i + 1}: ${step.toolId}`).join(', ');
    return {
      text: `Unknown tool(s) in chain: ${names}\n`,
      mimeFlowOk: false,
      totalInstallBytes: 0,
    };
  }

  const rows: StepRow[] = chain.map((step, i) => {
    const tool = registry.toolsById.get(step.toolId)!;
    const t = tool as ToolModule & { installGroup?: string; installSize?: number };
    return {
      index: i + 1,
      toolId: step.toolId,
      paramOverrides: paramSummary(step.params),
      inputAccept: tool.input.accept,
      outputMime: tool.output.mime,
      installGroup: t.installGroup,
      installSize: t.installSize,
    };
  });

  // Compute MIME mismatches between adjacent steps. Wildcards are
  // tolerant in either direction: an `image/*` producer with an
  // `image/jpeg` consumer plausibly feeds because at runtime the
  // wildcard resolves to a concrete type the consumer accepts.
  let mimeFlowOk = true;
  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1]!;
    const cur = rows[i]!;
    if (!couldFlowTo(prev.outputMime, cur.inputAccept)) {
      cur.mismatch = { previousOutput: prev.outputMime, thisAccepts: cur.inputAccept };
      mimeFlowOk = false;
    }
  }

  // Aggregate install bytes per group; tools without a group still
  // contribute their installSize independently (e.g. ocr ships its own
  // tesseract bundle without sharing).
  const groupBytes = new Map<string, number>();
  const ungroupedBytes = new Map<string, number>(); // keyed by tool id
  for (const row of rows) {
    if (!row.installSize) continue;
    if (row.installGroup) {
      // Only count each group once even if multiple steps share it.
      groupBytes.set(row.installGroup, row.installSize);
    } else {
      ungroupedBytes.set(row.toolId, row.installSize);
    }
  }
  const totalInstallBytes =
    Array.from(groupBytes.values()).reduce((s, n) => s + n, 0) +
    Array.from(ungroupedBytes.values()).reduce((s, n) => s + n, 0);

  // ── Render text ─────────────────────────────────────────────────────────
  const lines: string[] = [];
  lines.push(`Chain plan — ${chain.length} step${chain.length === 1 ? '' : 's'}`);
  lines.push('');
  for (const row of rows) {
    const params = row.paramOverrides ? `[${row.paramOverrides}]` : '';
    const accept = row.inputAccept.join(', ');
    lines.push(`  ${row.index}. ${row.toolId}${params}`);
    lines.push(`       accepts: ${accept || '(any)'}`);
    lines.push(`       output:  ${row.outputMime}`);
    if (row.mismatch) {
      lines.push(
        `       ⚠ mime mismatch: previous step produced "${row.mismatch.previousOutput}", ` +
          `this step accepts ${row.mismatch.thisAccepts.join(', ')}`,
      );
    }
  }

  lines.push('');
  if (totalInstallBytes === 0) {
    lines.push('Lazy installs needed on first run: none — every tool ships in-bundle.');
  } else {
    lines.push('Lazy installs needed on first run:');
    if (groupBytes.size > 0) {
      // Sort by size descending for readability.
      const groups = Array.from(groupBytes.entries()).sort(([, a], [, b]) => b - a);
      for (const [group, bytes] of groups) {
        lines.push(`  ${group.padEnd(20)} ~${formatBytes(bytes)}`);
      }
    }
    if (ungroupedBytes.size > 0) {
      const ungrouped = Array.from(ungroupedBytes.entries()).sort(([, a], [, b]) => b - a);
      for (const [toolId, bytes] of ungrouped) {
        lines.push(`  ${toolId.padEnd(20)} ~${formatBytes(bytes)}`);
      }
    }
    lines.push(`  total                ~${formatBytes(totalInstallBytes)}`);
  }

  if (!mimeFlowOk) {
    lines.push('');
    lines.push('⚠ At least one step rejects the previous step\'s output MIME.');
    lines.push('  The chain may still run if the data shape matches; the warning is advisory.');
  }

  lines.push('');
  lines.push('(dry run — nothing executed, no files read)');

  return {
    text: lines.join('\n') + '\n',
    mimeFlowOk,
    totalInstallBytes,
  };
}
