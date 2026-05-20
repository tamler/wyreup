// Client-side helper for PRO tools.
//
// Every PRO tool's run() does the same thing: POST { toolId, input } to
// /api/tools/pro/run, surface errors clearly, and ping the browser shell
// so the header balance refreshes. This helper centralizes that, so
// individual tool modules stay focused on input shaping + output framing.

import type { ToolRunContext } from '../types.js';

export interface ProRunError {
  status: number;
  message: string;
}

/**
 * Read a File's bytes and base64-encode them. Chunked to avoid a
 * RangeError from `String.fromCharCode` spread on large inputs.
 */
export async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/**
 * POST to /api/tools/pro/run with credentials and parse the wrapped result.
 * Throws an Error whose message is the server's user-facing copy when
 * available (401, 402 insufficient credits, 429 rate limit, 502 model
 * failure). Dispatches `wyreup:balance-changed` on success so the header
 * ⚡ badge re-fetches without a page reload.
 */
export async function runPro<TResult>(
  toolId: string,
  input: Record<string, unknown>,
  ctx: ToolRunContext,
): Promise<TResult> {
  if (ctx.signal.aborted) throw new Error('Aborted');

  const res = await fetch('/api/tools/pro/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ toolId, input }),
    signal: ctx.signal,
  });

  if (!res.ok) {
    const detail = (await res.json().catch(() => ({}))) as { error?: string };
    if (res.status === 401) {
      throw new Error('Please sign in with your Wyreup API key to use PRO tools.');
    }
    if (res.status === 402) {
      throw new Error(detail.error ?? 'Not enough credits. Buy more from /account.');
    }
    if (res.status === 429) {
      throw new Error(detail.error ?? 'Too many PRO runs — wait a minute.');
    }
    throw new Error(detail.error ?? `PRO run failed (${res.status})`);
  }

  const body = (await res.json()) as { result?: TResult };
  if (body.result === undefined) {
    throw new Error('PRO endpoint returned no result');
  }

  // Tell the browser shell to re-fetch the balance. Guarded for non-browser
  // surfaces (PRO tools ship with surfaces: ['web'] today, but the import
  // graph is shared with CLI/MCP so window may be undefined.)
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('wyreup:balance-changed'));
  }

  return body.result;
}
