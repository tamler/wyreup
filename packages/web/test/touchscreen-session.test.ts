import { describe, expect, it, vi } from 'vitest';
const { coreFixture } = vi.hoisted(() => {
  let fixture: Promise<Record<string, unknown>> | undefined;
  return {
    coreFixture: () =>
      (fixture ??= (async () => ({
        ...(await import('../../core/src/utilities/common')),
        ...(await import('../../core/src/utilities/hardware')),
      }))()),
  };
});
vi.mock('@wyreup/core', () => coreFixture());
vi.mock('@wyreup/core/execution', () => coreFixture());
import { summarizeTouchscreenSession } from '../../core/src/utilities/hardware';
import { createTouchscreenCollector } from '../src/components/runners/touchscreen-session';
describe('bounded actual CSS-coordinate touchscreen sessions', () => {
  const rect = { left: 100, top: 200, width: 200, height: 100 };
  it('counts far edge/outside and mouse/pen separately and freezes export geometry', () => {
    let now = 10,
      cleared = 0;
    const stopped: unknown[] = [];
    const collector = createTouchscreenCollector({
      columns: 2,
      rows: 2,
      rect,
      now: () => now,
      setTimer: () => 1,
      clearTimer: () => {
        cleared++;
      },
      stopped: (_, s) => stopped.push(s),
    });
    collector.record({ clientX: 100, clientY: 200, pointerType: 'mouse', pressure: 0.5 });
    now = 20;
    collector.record({ clientX: 300, clientY: 300, pointerType: 'pen', pressure: 1 });
    collector.record({ clientX: 99, clientY: 200, pointerType: 'mouse', pressure: 0 });
    now = 30;
    const snapshot = collector.stop();
    expect(collector.stop()).toBe(snapshot);
    expect(stopped).toHaveLength(1);
    expect(cleared).toBe(1);
    expect(Object.isFrozen(snapshot.samples[0])).toBe(true);
    expect(Object.isFrozen(snapshot.rect)).toBe(true);
    expect(summarizeTouchscreenSession(snapshot, { columns: 2, rows: 2 })).toMatchObject({
      sampleCount: 2,
      excludedSampleCount: 1,
      touchedCells: 2,
      coveragePercent: 50,
      cellCoverage: [1, 0, 0, 1],
      pointerTypeCounts: { mouse: 2, pen: 1 },
      durationMs: 20,
    });
    collector.record({ clientX: 150, clientY: 250, pointerType: 'touch', pressure: 1 });
    expect(collector.counts()).toEqual({ accepted: 2, excluded: 1 });
    expect(collector.matches({ ...rect, left: 101 })).toBe(false);
  });
  it('handles no samples honestly, excluded-only measured zero, grid constraints and timer ownership', () => {
    let callback = () => {},
      now = 0,
      cleared = 0;
    const make = () =>
      createTouchscreenCollector({
        columns: 2,
        rows: 2,
        rect,
        now: () => now,
        setTimer: (fn) => {
          callback = fn;
          return 2;
        },
        clearTimer: () => {
          cleared++;
        },
        stopped: () => {},
      });
    const empty = make();
    expect(() => summarizeTouchscreenSession(empty.stop(), { columns: 2, rows: 2 })).toThrow();
    const outside = make();
    outside.record({ clientX: 0, clientY: 0, pointerType: 'mouse', pressure: 0 });
    now = 120000;
    callback();
    expect(outside.isActive()).toBe(false);
    expect(summarizeTouchscreenSession(outside.stop(), { columns: 2, rows: 2 })).toMatchObject({
      coveragePercent: 0,
      sampleCount: 0,
      excludedSampleCount: 1,
      durationMs: 120000,
    });
    const disposed = make();
    disposed.dispose();
    expect(disposed.isActive()).toBe(false);
    expect(cleared).toBe(3);
    expect(() =>
      createTouchscreenCollector({
        columns: 2.5,
        rows: 2,
        rect,
        now: () => 0,
        setTimer: () => 1,
        clearTimer: () => {},
        stopped: () => {},
      }),
    ).toThrow();
  });
  it('automatically seals exactly100000 accepted/excluded events without truncating accepted samples', () => {
    const collector = createTouchscreenCollector({
      columns: 2,
      rows: 2,
      rect,
      now: () => 0,
      setTimer: () => 1,
      clearTimer: () => {},
      stopped: () => {},
    });
    for (let i = 0; i < 100000; i++)
      collector.record({ clientX: 100, clientY: 200, pointerType: 'touch', pressure: 0.5 });
    expect(collector.isActive()).toBe(false);
    expect(collector.stop().samples).toHaveLength(100000);
    expect(summarizeTouchscreenSession(collector.stop(), { columns: 2, rows: 2 })).toMatchObject({
      sampleCount: 100000,
      cellCoverage: [100000, 0, 0, 0],
    });
  });
});
