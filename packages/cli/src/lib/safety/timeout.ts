// Per-tool timeout validation — shared by run.ts and chain.ts.
// Returns { ok: true, ms } or { ok: false, error }.
// ms === 0 means no timeout (requires WYREUP_ALLOW_DISABLE_TIMEOUT=1).

export function resolveTimeout(
  raw: number | undefined,
): { ok: true; ms: number } | { ok: false; error: string } {
  if (raw === undefined) return { ok: true, ms: 300_000 };
  if (!Number.isFinite(raw) || raw < 0 || !Number.isInteger(raw)) {
    return { ok: false, error: `--timeout must be a non-negative integer (got ${String(raw)})` };
  }
  if (raw === 0) {
    if (process.env['WYREUP_ALLOW_DISABLE_TIMEOUT'] !== '1') {
      return { ok: false, error: '--timeout 0 (disable) requires WYREUP_ALLOW_DISABLE_TIMEOUT=1' };
    }
    return { ok: true, ms: 0 };
  }
  return { ok: true, ms: Math.min(raw, 3_600_000) };
}
