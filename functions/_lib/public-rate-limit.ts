import type { D1Database, D1Result } from './env';
import { hmacSha256Hex } from './crypto';

const TRIGGERS = [
  'public_api_window_insert',
  'public_api_window_update',
  'public_api_global_full',
  'public_api_network_full',
  'public_api_lease_full',
  'public_api_lease_clock',
];
let active = 0;

export class DomainAdmissionError extends Error {
  constructor(
    public readonly status: 429 | 503 = 503,
    public readonly retryAfter = 1,
  ) {
    super(
      status === 429
        ? 'Public lookup capacity is temporarily limited.'
        : 'Public lookup is temporarily unavailable.',
    );
  }
}

export function acquireDomainIsolateSlot(): () => void {
  if (active >= 4) throw new DomainAdmissionError();
  active++;
  let released = false;
  return () => {
    if (!released) {
      released = true;
      active--;
    }
  };
}

function checkResult(result: D1Result | undefined, changes?: number): void {
  if (
    !result ||
    result.success !== true ||
    (changes !== undefined && result.meta?.changes !== changes)
  )
    throw new DomainAdmissionError();
}

export interface DomainLease {
  release(): Promise<void>;
}

export async function reserveDomainLookup(
  db: D1Database,
  secret: string,
  ip: string,
  signal: AbortSignal,
  randomToken: () => string = () => {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  },
): Promise<DomainLease> {
  if (!db || !secret || !ip || ip.length > 64 || signal.aborted) throw new DomainAdmissionError();
  const clock = await db
    .prepare('SELECT unixepoch() AS now_seconds, (unixepoch() / 60) * 60 AS window_start')
    .first<{ now_seconds: number; window_start: number }>();
  if (
    !clock ||
    !Number.isSafeInteger(clock.now_seconds) ||
    !Number.isSafeInteger(clock.window_start) ||
    clock.now_seconds < 0 ||
    clock.window_start !== Math.floor(clock.now_seconds / 60) * 60 ||
    signal.aborted
  )
    throw new DomainAdmissionError();
  const digest = await hmacSha256Hex(
    secret,
    `wyreup:domain-age:rate:v1:${clock.window_start}:${ip}`,
  );
  if (signal.aborted) throw new DomainAdmissionError();
  const cleanup = await db.batch([
    db.prepare(
      'DELETE FROM public_api_rate_windows WHERE window_start < (unixepoch() / 60) * 60 - 120',
    ),
    db.prepare('DELETE FROM public_api_inflight_leases WHERE expires_at <= unixepoch()'),
    db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'trigger' AND name IN (${TRIGGERS.map(() => '?').join(',')})`,
      )
      .bind(...TRIGGERS),
  ]);
  if (cleanup.length !== 3) throw new DomainAdmissionError();
  for (const result of cleanup) checkResult(result);
  const present = cleanup[2].results;
  if (
    !present ||
    present.length !== TRIGGERS.length ||
    present.some(
      (row) =>
        !row || typeof row !== 'object' || !TRIGGERS.includes((row as { name: string }).name),
    ) ||
    new Set(present.map((row) => (row as { name: string }).name)).size !== TRIGGERS.length ||
    signal.aborted
  )
    throw new DomainAdmissionError();
  const token = randomToken();
  if (!/^[0-9a-f]{32}$/.test(token)) throw new DomainAdmissionError();
  let acknowledged = false;
  const release = async () => {
    if (!acknowledged) return;
    const result = await db
      .prepare("DELETE FROM public_api_inflight_leases WHERE route = 'domain-age' AND token = ?")
      .bind(token)
      .run();
    checkResult(result);
    if (result.meta.changes !== 0 && result.meta.changes !== 1) throw new DomainAdmissionError();
  };
  try {
    const admitted = await db.batch([
      db
        .prepare(
          "INSERT INTO public_api_rate_windows(route, window_start, scope_key, count) VALUES ('domain-age', ?, 'global', 1) ON CONFLICT(route, window_start, scope_key) DO UPDATE SET count = count + 1",
        )
        .bind(clock.window_start),
      db
        .prepare(
          "INSERT INTO public_api_rate_windows(route, window_start, scope_key, count) VALUES ('domain-age', ?, ?, 1) ON CONFLICT(route, window_start, scope_key) DO UPDATE SET count = count + 1",
        )
        .bind(clock.window_start, digest),
      db
        .prepare(
          "INSERT INTO public_api_inflight_leases(route, token, created_at, expires_at) VALUES ('domain-age', ?, unixepoch(), unixepoch() + 30)",
        )
        .bind(token),
    ]);
    if (admitted.length !== 3) throw new DomainAdmissionError();
    for (const result of admitted) checkResult(result, 1);
    acknowledged = true;
    if (signal.aborted) {
      await release();
      throw new DomainAdmissionError();
    }
    return { release };
  } catch (error) {
    if (error instanceof DomainAdmissionError) throw error;
    const message = error instanceof Error ? error.message : '';
    if (message.includes('DOMAIN_AGE_GLOBAL_LIMIT') || message.includes('DOMAIN_AGE_NETWORK_LIMIT'))
      throw new DomainAdmissionError(
        429,
        Math.max(1, Math.min(60, clock.window_start + 60 - clock.now_seconds)),
      );
    throw new DomainAdmissionError();
  }
}
