/**
 * Parse a chain string like "strip-exif|compress[quality=75]|face-blur" into
 * an ordered list of ChainStep objects.
 *
 * Grammar:
 *   chain-string  = step ( "|" step )*
 *   step          = tool-id ( "[" params "]" )?
 *   params        = param ( "," param )*
 *   param         = key "=" value
 *
 * Keys and values are unquoted; values are coerced to number/boolean where
 * unambiguous, otherwise kept as strings.
 */

import type { Chain, ChainStep } from './types.js';

function coerce(value: string): unknown {
  if (value === 'true') return true;
  if (value === 'false') return false;
  const n = Number(value);
  if (!Number.isNaN(n) && value.trim() !== '') return n;
  return value;
}

function parseParams(raw: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  if (!raw.trim()) return result;
  for (const pair of raw.split(',')) {
    const eq = pair.indexOf('=');
    if (eq === -1) continue; // skip malformed pair
    const key = pair.slice(0, eq).trim();
    const val = pair.slice(eq + 1).trim();
    if (key) result[key] = coerce(val);
  }
  return result;
}

function parseStep(raw: string): ChainStep {
  const bracketOpen = raw.indexOf('[');
  if (bracketOpen === -1) {
    return { toolId: raw.trim(), params: {} };
  }
  const bracketClose = raw.lastIndexOf(']');
  const toolId = raw.slice(0, bracketOpen).trim();
  const paramStr =
    bracketClose > bracketOpen
      ? raw.slice(bracketOpen + 1, bracketClose)
      : '';
  return { toolId, params: parseParams(paramStr) };
}

/**
 * Parse a pipe-delimited chain string into a Chain (array of ChainStep).
 * Returns an empty array if the input is empty.
 */
export function parseChainString(chainStr: string): Chain {
  if (!chainStr.trim()) return [];
  return chainStr.split('|').map(parseStep);
}

/**
 * Serialize a Chain back to a pipe-delimited chain string.
 * Inverse of parseChainString (round-trips cleanly for simple values).
 */
export function serializeChain(chain: Chain): string {
  return chain
    .map((step) => {
      const pairs = Object.entries(step.params)
        .map(([k, v]) => `${k}=${String(v)}`)
        .join(',');
      return pairs ? `${step.toolId}[${pairs}]` : step.toolId;
    })
    .join('|');
}
