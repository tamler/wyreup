export type PwaUpdateStatus =
  | { kind: 'waiting'; message: string; checking: boolean; worker: ServiceWorker }
  | {
      kind: 'unsupported' | 'unregistered' | 'observing' | 'checking' | 'installing' | 'offline' | 'error';
      message: string;
      checking: boolean;
    };

export const waitingUpdateMessage =
  'An update is ready. Finish your work and download your results. Close all Wyreup tabs and windows, including the recovery tab, then reopen Wyreup to use it.';

export function shouldShowPwaUpdate(status: PwaUpdateStatus | null, dismissedWorker: ServiceWorker | null): boolean {
  return status?.kind === 'waiting' && status.worker !== dismissedWorker;
}

export function observePwaUpdate(emit: (status: PwaUpdateStatus) => void): {
  check(): Promise<void>;
  dispose(): void;
} {
  let disposed = false;
  let generation = 0;
  let registration: ServiceWorkerRegistration | null = null;
  let installing: ServiceWorker | null = null;
  const workers = new Set<ServiceWorker>();
  let pending: { promise: Promise<void>; finish: () => void } | null = null;
  const supported = typeof window !== 'undefined' && typeof navigator !== 'undefined' && 'serviceWorker' in navigator;
  const container = supported ? navigator.serviceWorker : null;
  const scope = supported ? new URL('/', window.location.href).href : null;
  let readyAttached = false;
  let readyGeneration = 0;
  let readyOutcome: { registration: ServiceWorkerRegistration } | { failed: true } | null = null;

  function report(kind: Exclude<PwaUpdateStatus['kind'], 'waiting'>, message: string) {
    if (!disposed) emit({ kind, message, checking: pending !== null });
  }

  function observeState(completedCheck = false) {
    if (disposed) return;
    bindWorkers(registration?.installing ?? null, registration?.waiting ?? null);
    const waiting = registration?.waiting;
    if (registration?.active && waiting?.state === 'installed') {
      emit({ kind: 'waiting', message: waitingUpdateMessage, checking: pending !== null, worker: waiting });
    } else if (installing && (installing.state === 'installing' || installing.state === 'installed')) {
      report('installing', registration?.active ? 'An update is installing. Keep working while it finishes.' : 'Wyreup is installing for offline use.');
    } else if (!registration) {
      report('unregistered', 'No root service-worker registration detected.');
    } else {
      report('observing', completedCheck ? 'No waiting update detected' : 'Watching for a waiting update.');
    }
  }

  function workerChanged() {
    observeState();
  }

  function bindWorkers(next: ServiceWorker | null, waiting: ServiceWorker | null) {
    installing = next;
    const current = new Set([next, waiting].filter((worker): worker is ServiceWorker => worker !== null));
    for (const worker of workers) {
      if (current.has(worker)) continue;
      worker.removeEventListener('statechange', workerChanged);
      workers.delete(worker);
    }
    for (const worker of current) {
      if (workers.has(worker)) continue;
      worker.addEventListener('statechange', workerChanged);
      workers.add(worker);
    }
  }

  function updateFound() {
    observeState();
  }

  function bind(next: ServiceWorkerRegistration) {
    if (disposed || next.scope !== scope) return false;
    if (registration !== next) {
      registration?.removeEventListener('updatefound', updateFound);
      bindWorkers(null, null);
      registration = next;
      registration.addEventListener('updatefound', updateFound);
    }
    observeState();
    return true;
  }

  function observeReady() {
    if (disposed || generation !== readyGeneration || registration || pending || !readyOutcome) return;
    if ('registration' in readyOutcome) bind(readyOutcome.registration);
    else report('error', 'Could not observe the service-worker registration. You can retry the check.');
  }

  function watchReady(expectedGeneration: number) {
    if (!container) return;
    // One handled native continuation serves passive observation across explicit retries.
    readyGeneration = expectedGeneration;
    if (readyAttached) {
      observeReady();
      return;
    }
    readyAttached = true;
    void container.ready.then((value) => {
      if (disposed || generation !== readyGeneration || value.scope !== scope) return;
      readyOutcome = { registration: value };
      observeReady();
    }, () => {
      if (disposed || generation !== readyGeneration) return;
      readyOutcome = { failed: true };
      observeReady();
    });
  }

  if (!container || !scope) {
    report('unsupported', 'Service-worker update checks are unavailable in this browser.');
  } else {
    report('observing', 'Watching for a waiting update.');
    const initialGeneration = generation;
    void Promise.resolve().then(() => {
      if (disposed || generation !== initialGeneration) return;
      return container.getRegistration(scope);
    }).then((value) => {
      if (disposed || generation !== initialGeneration || registration) return;
      if (!value || !bind(value)) report('unregistered', 'No root service-worker registration detected.');
    }, () => {
      if (!disposed && generation === initialGeneration && !registration) report('error', 'Could not observe the service-worker registration. You can retry the check.');
    });
    watchReady(initialGeneration);
  }

  function check(): Promise<void> {
    if (disposed) return Promise.resolve();
    if (pending) return pending.promise;
    if (!container || !scope) {
      report('unsupported', 'Service-worker update checks are unavailable in this browser.');
      return Promise.resolve();
    }
    if (navigator.onLine === false) {
      report('offline', 'You are offline. Connect to the internet, then check again.');
      return Promise.resolve();
    }
    const ownedGeneration = ++generation;
    readyGeneration = ownedGeneration;
    let finished = false;
    let settle: () => void = () => {};
    const promise = new Promise<void>((resolve) => { settle = resolve; });
    const timer = window.setTimeout(() => {
      if (!current()) return;
      finish();
      report('error', 'The update check timed out. You can retry.');
    }, 10000);
    function current() {
      return !disposed && !finished && generation === ownedGeneration;
    }
    function finish() {
      if (finished) return;
      finished = true;
      window.clearTimeout(timer);
      pending = null;
      settle();
      if (!disposed && !registration) watchReady(ownedGeneration);
    }
    pending = { promise, finish };
    report('checking', 'Checking for a waiting update…');
    void Promise.resolve().then(async () => {
      if (!current()) return;
      const value = await container.getRegistration(scope);
      if (!current()) return;
      if (!value || value.scope !== scope) {
        finish();
        report('unregistered', 'No root service-worker registration detected.');
        return;
      }
      bind(value);
      await value.update();
      if (!current()) return;
      finish();
      observeState(true);
    }).catch(() => {
      if (!current()) return;
      finish();
      report('error', 'The update check failed. You can retry.');
    });
    return promise;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    generation++;
    pending?.finish();
    registration?.removeEventListener('updatefound', updateFound);
    bindWorkers(null, null);
    registration = null;
    readyOutcome = null;
  }

  return { check, dispose };
}
