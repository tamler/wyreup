/**
 * Reference-counted screen wake lock for long-running tool execution.
 *
 * On mobile, the screen auto-dims/locks during multi-second inferences,
 * which throttles the JS engine and can stall the run. Holding a screen
 * wake lock keeps the page active for the duration. Released as soon as
 * every caller has released — so concurrent tool runs share one lock.
 *
 * Usage:
 *   const wake = holdWakeLock();
 *   try {
 *     await runLongInference();
 *   } finally {
 *     wake.release();
 *   }
 *
 * No-ops in browsers without the Wake Lock API (older Safari, Firefox
 * pre-126). Failures are silent — the lock is best-effort.
 */

interface WakeLockSentinelLike {
  release: () => Promise<void>;
  addEventListener?: (type: 'release', listener: () => void) => void;
  removeEventListener?: (type: 'release', listener: () => void) => void;
}

interface WakeLockApi {
  request: (type: 'screen') => Promise<WakeLockSentinelLike>;
}

let lock: { sentinel: WakeLockSentinelLike; onRelease: () => void } | null = null;
const owners = new Set<symbol>();
const legacyOwners: ReturnType<typeof holdWakeLock>[] = [];
let pending: Promise<void> | null = null;

function getApi(): WakeLockApi | null {
  if (typeof navigator === 'undefined') return null;
  const nav = navigator as unknown as { wakeLock?: WakeLockApi };
  return nav.wakeLock ?? null;
}

function releaseSentinel(sentinel: WakeLockSentinelLike): void {
  try {
    void sentinel.release().catch(() => {});
  } catch {
    // Best-effort also covers a synchronous platform failure.
  }
}

function requestLock(): Promise<void> {
  if (lock || owners.size === 0) return Promise.resolve();
  if (pending) return pending;
  const api = getApi();
  if (!api) return Promise.resolve();
  try {
    const request = api
      .request('screen')
      .then(
        (sentinel) => {
          if (owners.size === 0) {
            releaseSentinel(sentinel);
            return;
          }
          const onRelease = () => {
            if (lock?.sentinel === sentinel) lock = null;
          };
          lock = { sentinel, onRelease };
          if (typeof sentinel.addEventListener === 'function') {
            sentinel.addEventListener('release', onRelease);
          }
        },
        () => {},
      )
      .finally(() => {
        if (pending === request) pending = null;
      });
    pending = request;
    return request;
  } catch {
    return Promise.resolve();
  }
}

/** One caller owns one idempotent release, even before ready settles. */
export function holdWakeLock(): { ready: Promise<void>; release: () => void } {
  const owner = Symbol();
  owners.add(owner);
  return {
    ready: requestLock(),
    release() {
      if (!owners.delete(owner) || owners.size !== 0 || !lock) return;
      const previous = lock;
      lock = null;
      if (typeof previous.sentinel.removeEventListener === 'function') {
        previous.sentinel.removeEventListener('release', previous.onRelease);
      }
      releaseSentinel(previous.sentinel);
    },
  };
}

/** Compatibility: each acquire requires one matching legacy release. */
export function acquireWakeLock(): Promise<void> {
  const owner = holdWakeLock();
  legacyOwners.push(owner);
  return owner.ready;
}

export function releaseWakeLock(): void {
  legacyOwners.shift()?.release();
}

/** Re-acquire if the page becomes visible again and we still need it. */
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && owners.size > 0 && !lock) {
      void requestLock();
    }
  });
}
