// Client-side helper for PRO tools.
//
// Every PRO tool's run() does the same thing: POST { toolId, input } to
// /api/tools/pro/run, surface errors clearly, and ping the browser shell
// so the header balance refreshes. This helper centralizes that, so
// individual tool modules stay focused on input shaping + output framing.
//
// Auth: cookie OR Bearer. The browser path leans on the wyreup_session
// cookie set by /api/account/verify. CLI and MCP pass an explicit API
// key via `ctx.apiKey`, which switches us to a Bearer header. The
// server-side `resolveUser()` accepts either form (see
// functions/_lib/auth.ts).

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
 * POST to /api/tools/pro/run with the right auth for the surface, then
 * parse the wrapped result. Throws an Error whose message is the
 * server's user-facing copy when available (401, 402 insufficient
 * credits, 429 rate limit, 502 model failure). Dispatches
 * `wyreup:balance-changed` on success so the header ⚡ badge re-fetches
 * without a page reload (no-op outside the browser).
 */
export async function runPro<TResult>(
  toolId: string,
  input: Record<string, unknown>,
  ctx: ToolRunContext,
): Promise<TResult> {
  if (ctx.signal.aborted) throw new Error('Aborted');

  const isBrowser = typeof window !== 'undefined';
  const base = ctx.proOrigin ?? '';
  const url = `${base}/api/tools/pro/run`;

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const init: RequestInit = {
    method: 'POST',
    headers,
    body: JSON.stringify({ toolId, input }),
    signal: ctx.signal,
  };

  if (ctx.apiKey) {
    // Explicit key wins on every surface. This is how CLI and MCP
    // authenticate, and how a browser script with a Bearer key can
    // run Pro tools without relying on the wyreup_session cookie.
    headers.Authorization = `Bearer ${ctx.apiKey}`;
  } else if (isBrowser) {
    // Browser default — the wyreup_session cookie was set by
    // /api/account/verify when the user activated their key.
    init.credentials = 'same-origin';
  } else {
    // Non-browser without a key — fail fast with the recovery path.
    throw new Error(
      'PRO tools require an API key when not in a browser. ' +
        'Run `wyreup login` (CLI) or set WYREUP_API_KEY (MCP).',
    );
  }

  const res = await fetch(url, init);

  if (!res.ok) {
    const detail = (await res.json().catch(() => ({}))) as { error?: string };
    if (res.status === 401) {
      throw new Error(
        isBrowser && !ctx.apiKey
          ? 'Please sign in with your Wyreup API key to use PRO tools.'
          : 'Your Wyreup API key was rejected. Re-run `wyreup login` or check WYREUP_API_KEY.',
      );
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
  // surfaces (CLI / MCP have no DOM to dispatch into).
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('wyreup:balance-changed'));
  }

  return body.result;
}
