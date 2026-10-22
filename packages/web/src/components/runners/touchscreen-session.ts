import {
  numberParam,
  touchscreenCellIndex,
  type TouchscreenRect,
  type TouchscreenSample,
  type TouchscreenSession,
} from '@wyreup/core/execution';

export interface TouchscreenCollectorOptions {
  columns: number;
  rows: number;
  rect: TouchscreenRect;
  now: () => number;
  setTimer: (callback: () => void, ms: number) => number;
  clearTimer: (id: number) => void;
  stopped: (reason: string, snapshot: TouchscreenSession) => void;
}
export function createTouchscreenCollector(options: TouchscreenCollectorOptions) {
  numberParam({ columns: options.columns }, 'columns', { min: 2, max: 50, integer: true });
  numberParam({ rows: options.rows }, 'rows', { min: 2, max: 50, integer: true });
  const rect = { ...options.rect };
  touchscreenCellIndex(rect, options.columns, options.rows, rect.left, rect.top);
  const startedAt = options.now(),
    samples: TouchscreenSample[] = [],
    pointerTypes: Record<string, number> = Object.create(null) as Record<string, number>,
    cells = new Array<number>(options.columns * options.rows).fill(0);
  let excludedSamples = 0,
    active = true,
    sealed: TouchscreenSession | null = null,
    timer: number | null = null;
  function stop(reason = 'Stopped.') {
    if (sealed) return sealed;
    active = false;
    if (timer !== null) options.clearTimer(timer);
    timer = null;
    const stoppedAt = Math.max(startedAt, Math.min(startedAt + 120000, options.now()));
    const frozenSamples = samples.map((sample) => Object.freeze({ ...sample }));
    Object.freeze(frozenSamples);
    const frozenTypes = Object.freeze({ ...pointerTypes }),
      frozenRect = Object.freeze({ ...rect });
    sealed = {
      columns: options.columns,
      rows: options.rows,
      rect: frozenRect,
      startedAt,
      stoppedAt,
      samples: frozenSamples,
      excludedSamples,
      pointerTypes: frozenTypes,
    };
    Object.freeze(sealed);
    options.stopped(reason, sealed);
    return sealed;
  }
  function record(event: Pick<PointerEvent, 'clientX' | 'clientY' | 'pointerType' | 'pressure'>) {
    if (!active) return;
    const at = options.now();
    if (at >= startedAt + 120000) {
      stop('Stopped at the120-second measurement bound.');
      return;
    }
    const pointerType = event.pointerType || 'unknown';
    if (
      pointerType.length > 32 ||
      !Number.isFinite(event.pressure) ||
      event.pressure < 0 ||
      event.pressure > 1
    )
      throw new Error('Malformed pointer type or pressure.');
    const index = touchscreenCellIndex(
      rect,
      options.columns,
      options.rows,
      event.clientX,
      event.clientY,
    );
    pointerTypes[pointerType] = (pointerTypes[pointerType] ?? 0) + 1;
    if (index === null) excludedSamples++;
    else {
      samples.push({
        clientX: event.clientX,
        clientY: event.clientY,
        at,
        pointerType,
        pressure: event.pressure,
      });
      cells[index] = cells[index] + 1;
    }
    if (samples.length + excludedSamples === 100000)
      stop('Stopped at the100000-event measurement bound.');
  }
  function matches(next: TouchscreenRect) {
    return Object.keys(rect).every(
      (key) => rect[key as keyof TouchscreenRect] === next[key as keyof TouchscreenRect],
    );
  }
  timer = options.setTimer(() => stop('Stopped at the120-second measurement bound.'), 120000);
  return {
    record,
    stop,
    matches,
    isActive: () => active,
    cells,
    counts: () => ({ accepted: samples.length, excluded: excludedSamples }),
    dispose: () => {
      active = false;
      if (timer !== null) options.clearTimer(timer);
      timer = null;
    },
  };
}
