/**
 * Reference-counted screen wake lock for long-running tool execution.
 *
 * On mobile, the screen auto-dims/locks during multi-second inferences,
 * which throttles the JS engine and can stall the run. Holding a screen
 * wake lock keeps the page active for the duration. Released as soon as
 * every caller has released — so concurrent tool runs share one lock.
 *
 * Usage:
 *   await acquireWakeLock();
 *   try {
 *     await runLongInference();
 *   } finally {
 *     releaseWakeLock();
 *   }
 *
 * No-ops in browsers without the Wake Lock API (older Safari, Firefox
 * pre-126). Failures are silent — the lock is best-effort.
 */

interface WakeLockSentinelLike {
  release: () => Promise<void>;
}

interface WakeLockApi {
  request: (type: 'screen') => Promise<WakeLockSentinelLike>;
}

let lock: WakeLockSentinelLike | null = null;
let refCount = 0;
let pending: Promise<void> | null = null;

function getApi(): WakeLockApi | null {
  if (typeof navigator === 'undefined') return null;
  const nav = navigator as unknown as { wakeLock?: WakeLockApi };
  return nav.wakeLock ?? null;
}

export async function acquireWakeLock(): Promise<void> {
  refCount += 1;
  if (lock) return;
  // Coalesce concurrent acquires — only the first request actually calls
  // navigator.wakeLock.request; later callers await the in-flight promise.
  if (pending) return pending;
  const api = getApi();
  if (!api) return;
  pending = (async () => {
    try {
      lock = await api.request('screen');
    } catch {
      /* best-effort — likely permission denied */
    } finally {
      pending = null;
    }
  })();
  return pending;
}

export function releaseWakeLock(): void {
  refCount = Math.max(0, refCount - 1);
  if (refCount === 0 && lock) {
    void lock.release().catch(() => { /* ignore */ });
    lock = null;
  }
}

/** Re-acquire if the page becomes visible again and we still need it. */
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && refCount > 0 && !lock) {
      void acquireWakeLock();
    }
  });
}
