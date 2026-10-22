import { describe, expect, it } from 'vitest';
import { TimerState, timerDisplay } from '../src/components/runners/timerState';

describe('injected monotonic timer lifecycle', () => {
  it('uses one advancing clock sample for pause and snapshot at the countdown boundary', () => {
    for (const action of ['pause', 'snapshot'] as const) {
      const values = [0, 999, 1000]; let reads = 0;
      const timer = new TimerState('countdown', () => values[reads++], 1000);
      timer.start();
      if (action === 'pause') timer.pause();
      const saved = timer.snapshot();
      expect(reads).toBe(2);
      expect(saved).toEqual({ version: 1, kind: 'countdown', state: action === 'pause' ? 'paused' : 'running', durationMs: 1000, elapsedMs: 999 });
    }
    const values = [0, 1000, 1001]; let reads = 0;
    const timer = new TimerState('countdown', () => values[reads++], 1000);
    timer.start(); timer.pause();
    expect(reads).toBe(2); expect(timer.state).toBe('done');
    expect(timer.tick()).toBe(true); expect(timer.tick()).toBe(false);
  });
  it('settles the stopwatch limit with the same single sample recorded as its final lap', () => {
    const values = [0, 604800000, 604800001]; let reads = 0;
    const timer = new TimerState('stopwatch', () => values[reads++]);
    timer.start(); timer.lap();
    expect(reads).toBe(2); expect(timer.state).toBe('paused');
    expect(timer.laps).toEqual([{ totalMs: 604800000, deltaMs: 604800000 }]);
    expect(timer.snapshot()).toEqual({ version: 1, kind: 'stopwatch', state: 'paused', elapsedMs: 604800000, laps: [{ totalMs: 604800000, deltaMs: 604800000 }] });
    expect(reads).toBe(2);
  });
  it('derives frame gaps and lap deltas, makes double-start/pause idempotent and resumes correctly', () => {
    let now = 0; const timer = new TimerState('stopwatch', () => now);
    timer.start(); now = 100; timer.start(); now = 60000; expect(timer.elapsed()).toBe(60000); timer.lap(); now = 65000; timer.lap(); expect(timer.laps).toEqual([{ totalMs: 60000, deltaMs: 60000 }, { totalMs: 65000, deltaMs: 5000 }]); timer.pause(); now = 999999; timer.pause(); expect(timer.elapsed()).toBe(65000); timer.start(); now += 1000; expect(timer.elapsed()).toBe(66000); timer.reset(); expect(timer.elapsed()).toBe(0); expect(timer.laps).toEqual([]); expect(timer.state).toBe('paused');
  });
  it('completes exactly once after a long gap, resets cleanly and clamps stopwatch limit', () => {
    let now = 0; const countdown = new TimerState('countdown', () => now, 1000); countdown.start(); now = 40000; expect(countdown.tick()).toBe(true); expect(countdown.tick()).toBe(false); expect(countdown.elapsed()).toBe(1000); expect(countdown.state).toBe('done'); countdown.start(); expect(countdown.state).toBe('done'); countdown.reset(); countdown.start(); now += 1000; expect(countdown.tick()).toBe(true);
    const watch = new TimerState('stopwatch', () => now); watch.start(); now += 604800001; watch.tick(); expect(watch.elapsed()).toBe(604800000); expect(watch.state).toBe('paused');
  });
  it('roundtrips running sessions paused and done sessions without completion replay', () => {
    let now = 0; const source = new TimerState('stopwatch', () => now); source.start(); now = 400; source.lap(); now = 900; const saved = source.snapshot(); const restored = new TimerState('stopwatch', () => now); restored.restore(saved); expect(restored.elapsed()).toBe(900); expect(restored.state).toBe('paused'); expect(restored.laps).toEqual([{ totalMs: 400, deltaMs: 400 }]); expect(source.state).toBe('running');
    const countdown = new TimerState('countdown', () => now, 1000); countdown.restore({ version: 1, kind: 'countdown', state: 'done', durationMs: 1000, elapsedMs: 1000 }); expect(countdown.state).toBe('done'); expect(countdown.tick()).toBe(false);
  });
  it('retains one completion after snapshot or pause observes an elapsed deadline', () => {
    let now = 0; const timer = new TimerState('countdown', () => now, 1000); timer.start(); now = 1000;
    expect(timer.snapshot()).toEqual({ version: 1, kind: 'countdown', state: 'done', durationMs: 1000, elapsedMs: 1000 });
    expect(timer.tick()).toBe(true); expect(timer.tick()).toBe(false);
    timer.reset(); timer.start(); now += 1500; timer.pause(); expect(timer.state).toBe('done'); expect(timer.tick()).toBe(true); expect(timer.tick()).toBe(false);
  });
  it('rejects invalid restore atomically, reversed clocks, running duration edits and excess laps', () => {
    let now = 0; const timer = new TimerState('stopwatch', () => now); timer.start(); now = 100; const before = timer.snapshot(); expect(() => timer.restore({ ...before, extra: 1 })).toThrow(); expect(timer.snapshot()).toEqual(before); expect(() => timer.setDuration(1000)).toThrow(); for (let i = 0; i < 200; i++) timer.lap(); expect(() => timer.lap()).toThrow(); now = -1; expect(() => timer.elapsed()).toThrow('monotonic');
    expect(timerDisplay(3661230)).toBe('01:01:01.23');
  });
});
