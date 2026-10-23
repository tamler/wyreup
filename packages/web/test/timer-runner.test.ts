import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { openBrowserHarness } from './browserHarness';

describe('mounted live timer controls and real exports', () => {
  let harness: Awaited<ReturnType<typeof openBrowserHarness>>;
  beforeAll(async () => { harness = await openBrowserHarness('./test/fixtures/PlanningHarness.svelte'); }, 30000);
  afterAll(async () => { await harness?.close(); });
  it.each(['frame', 'visibility'] as const)('shows a %s clock failure once and freezes without resampling or throwing', async (trigger) => {
    const page = await harness.browser.newPage();
    const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
    try {
      await page.clock.install(); await page.goto(`${harness.url}?id=stopwatch`);
      await page.getByRole('button', { name: 'Start', exact: true }).click();
      await page.clock.fastForward(100);
      const before = await page.evaluate((trigger) => {
        const outputs = document.querySelectorAll('output[aria-label="Elapsed time"]');
        if (outputs.length !== 1) throw new Error('Expected exactly one elapsed time output.');
        const before = outputs[0].textContent;
        Object.assign(window, { failedTimerReads: 0 });
        Object.defineProperty(performance, 'now', { configurable: true, value: () => {
          const probe = window as unknown as { failedTimerReads: number };
          probe.failedTimerReads++; return NaN;
        } });
        if (trigger === 'visibility') document.dispatchEvent(new Event('visibilitychange'));
        return before;
      }, trigger);
      if (trigger === 'frame') await page.clock.fastForward(20);
      expect(await page.getByRole('alert').count()).toBe(1);
      expect(await page.getByRole('alert').textContent()).toContain('finite monotonic clock');
      expect(await page.getByText('State: paused', { exact: true }).count()).toBe(1);
      expect(await page.getByLabel('Elapsed time').textContent()).toBe(before);
      const reads = await page.evaluate(() => (window as unknown as { failedTimerReads: number }).failedTimerReads);
      expect(reads).toBe(1); await page.clock.fastForward(100);
      expect(await page.evaluate(() => (window as unknown as { failedTimerReads: number }).failedTimerReads)).toBe(reads);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }, 30000);
  it('starts only on gesture, records laps, pauses and exports a restorable running session', async () => {
    const page = await harness.browser.newPage();
    try {
      await page.clock.install(); await page.goto(`${harness.url}?id=stopwatch`); expect(await page.getByText('State: paused', { exact: true }).count()).toBe(1);
      await page.getByRole('button', { name: 'Start', exact: true }).click(); await page.clock.fastForward(1200); await page.getByRole('button', { name: 'Lap', exact: true }).click(); await page.clock.fastForward(500);
      const downloadEvent = page.waitForEvent('download'); await page.getByRole('button', { name: 'Save session JSON' }).click(); const download = await downloadEvent; const path = await download.path(); if (!path) throw new Error('No download file.'); const raw = await readFile(path, 'utf8'); const snapshot = JSON.parse(raw) as { state: string; elapsedMs: number; laps: unknown[] }; expect(snapshot.state).toBe('running'); expect(snapshot.elapsedMs).toBeGreaterThanOrEqual(1700); expect(snapshot.laps).toHaveLength(1);
      await page.getByRole('button', { name: 'Pause', exact: true }).click(); await page.getByLabel('Restore session JSON').setInputFiles({ name: 'session.json', mimeType: 'application/json', buffer: Buffer.from(raw) }); await page.getByText('State: paused', { exact: true }).waitFor();
      const csvEvent = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export laps CSV' }).click(); const csvPath = await (await csvEvent).path(); if (!csvPath) throw new Error('No CSV.'); expect(await readFile(csvPath, 'utf8')).toContain('"summary"');
      await page.getByRole('button', { name: 'Unmount runner' }).click(); await page.clock.fastForward(5000); expect(await page.getByLabel('Elapsed time').count()).toBe(0);
    } finally { await page.close(); }
  }, 30000);
  it('completes countdown once and restores done state without replay', async () => {
    const page = await harness.browser.newPage();
    try {
      await page.clock.install(); await page.goto(`${harness.url}?id=countdown-timer`); await page.getByLabel('Duration (seconds)').fill('1'); await page.getByRole('button', { name: 'Replace duration and reset' }).click(); await page.getByRole('button', { name: 'Start', exact: true }).click(); await page.clock.fastForward(1500); await page.getByText('Countdown complete.', { exact: true }).waitFor(); expect(await page.getByText('State: done', { exact: true }).count()).toBe(1);
      const event = page.waitForEvent('download'); await page.getByRole('button', { name: 'Save session JSON' }).click(); const path = await (await event).path(); if (!path) throw new Error('No JSON.'); const raw = await readFile(path, 'utf8'); expect(JSON.parse(raw)).toEqual({ version: 1, kind: 'countdown', state: 'done', durationMs: 1000, elapsedMs: 1000 });
      await page.getByRole('button', { name: 'Reset', exact: true }).click(); await page.getByLabel('Restore session JSON').setInputFiles({ name: 'done.json', mimeType: 'application/json', buffer: Buffer.from(raw) }); await page.getByText('State: done', { exact: true }).waitFor(); expect(await page.getByText('Countdown complete.', { exact: true }).count()).toBe(0);
    } finally { await page.close(); }
  }, 30000);
  it('cancels owned frames/listeners/audio and invalidates a pending audio start on reset', async () => {
    type VisibilityPair = { callback: EventListenerOrEventListenerObject | null; capture: boolean };
    type VisibilityAdd = VisibilityPair & { phase: 'empty-app' | 'timer-dom' | 'unknown'; optionsSupported: boolean };
    type TimerProbe = {
      frames: Set<number>; frameCalls: number; closes: number; resolveResume(): void;
      visibilityAdds: VisibilityAdd[];
      visibilityRemoves: Array<VisibilityPair & { optionsSupported: boolean }>;
      visibilityActive: VisibilityPair[];
      baseline: VisibilityPair | null; timer: VisibilityPair | null;
    };
    const page = await harness.browser.newPage();
    try {
      await page.clock.install();
      await page.addInitScript(() => {
        const probe: TimerProbe = {
          frames: new Set<number>(), frameCalls: 0, closes: 0, resolveResume: () => {},
          visibilityAdds: [], visibilityRemoves: [], visibilityActive: [], baseline: null, timer: null,
        };
        Object.assign(window, { timerProbe: probe });
        const request = window.requestAnimationFrame.bind(window); const cancel = window.cancelAnimationFrame.bind(window);
        window.requestAnimationFrame = callback => { let id = 0; id = request(timestamp => { probe.frames.delete(id); callback(timestamp); }); probe.frames.add(id); probe.frameCalls++; return id; };
        window.cancelAnimationFrame = id => { probe.frames.delete(id); cancel(id); };
        const add = document.addEventListener.bind(document); const remove = document.removeEventListener.bind(document);
        const options = (value: boolean | AddEventListenerOptions | undefined) => ({
          capture: typeof value === 'boolean' ? value : Boolean(value && value.capture),
          optionsSupported: !(value && typeof value === 'object' &&
            (('once' in value && Boolean(value.once)) || ('signal' in value && value.signal !== undefined))),
        });
        document.addEventListener = (...args: Parameters<typeof document.addEventListener>) => {
          const app = document.getElementById('app');
          const phase = app && app.childNodes.length === 0 ? 'empty-app'
            : app?.querySelectorAll('.timer output[aria-label="Remaining time"]').length === 1 ? 'timer-dom' : 'unknown';
          add(...args);
          if (args[0] === 'visibilitychange') {
            const row: VisibilityAdd = { callback: args[1], ...options(args[2]), phase };
            probe.visibilityAdds.push(row);
            if (!probe.visibilityActive.some(pair => pair.callback === row.callback && pair.capture === row.capture))
              probe.visibilityActive.push(row);
          }
        };
        document.removeEventListener = (...args: Parameters<typeof document.removeEventListener>) => {
          remove(...args);
          if (args[0] === 'visibilitychange') {
            const row = { callback: args[1], ...options(args[2]) };
            probe.visibilityRemoves.push(row);
            const index = probe.visibilityActive.findIndex(pair => pair.callback === row.callback && pair.capture === row.capture);
            if (index !== -1) probe.visibilityActive.splice(index, 1);
          }
        };
        Object.assign(window, { AudioContext: class { resume() { return new Promise<void>(resolve => { probe.resolveResume = resolve; }); } close() { probe.closes++; return Promise.resolve(); } } });
      });
      await page.goto(`${harness.url}?id=countdown-timer`);
      await page.getByLabel('Enable completion sound').waitFor();
      await page.waitForFunction(() => (window as unknown as { timerProbe: TimerProbe }).timerProbe.visibilityAdds.some(row => row.phase === 'timer-dom'));
      const registration = await page.evaluate(() => {
        const p = (window as unknown as { timerProbe: TimerProbe }).timerProbe;
        const [baseline, timer] = p.visibilityAdds;
        p.baseline = baseline ?? null; p.timer = timer ?? null;
        return {
          adds: p.visibilityAdds.length, removes: p.visibilityRemoves.length,
          distinct: Boolean(baseline && timer && baseline.callback !== timer.callback),
          baselinePhase: baseline?.phase ?? null, timerPhase: timer?.phase ?? null,
          baselineCallable: typeof baseline?.callback === 'function', timerCallable: typeof timer?.callback === 'function',
          baselineCapture: baseline?.capture ?? null, timerCapture: timer?.capture ?? null,
          optionsSupported: p.visibilityAdds.every(row => row.optionsSupported),
        };
      });
      expect(registration).toEqual({
        adds: 2, removes: 0, distinct: true, baselinePhase: 'empty-app', timerPhase: 'timer-dom',
        baselineCallable: true, timerCallable: true, baselineCapture: false, timerCapture: false, optionsSupported: true,
      });
      await page.getByLabel('Enable completion sound').check(); await page.getByRole('button', { name: 'Start', exact: true }).click();
      await page.getByRole('button', { name: 'Reset', exact: true }).click();
      await page.evaluate(() => { (window as unknown as { timerProbe: { resolveResume(): void } }).timerProbe.resolveResume(); });
      await page.clock.fastForward(1000); expect(await page.getByText('State: paused', { exact: true }).count()).toBe(1);
      await page.getByRole('button', { name: 'Unmount runner' }).click();
      const before = await page.evaluate(() => {
        const p = (window as unknown as { timerProbe: TimerProbe }).timerProbe;
        const baseline = p.baseline, timer = p.timer;
        if (!baseline || !timer) throw new Error('Missing observed timer listener baseline.');
        const same = (a: VisibilityPair, b: VisibilityPair) => a.callback === b.callback && a.capture === b.capture;
        return {
          frames: p.frames.size, frameCalls: p.frameCalls, closes: p.closes,
          adds: p.visibilityAdds.filter(row => same(row, timer)).length,
          removes: p.visibilityRemoves.filter(row => same(row, timer)).length,
          timerActive: p.visibilityActive.some(row => same(row, timer)),
          baselineAdds: p.visibilityAdds.filter(row => same(row, baseline)).length,
          baselineRemoves: p.visibilityRemoves.filter(row => same(row, baseline)).length,
          baselineActive: p.visibilityActive.some(row => same(row, baseline)),
          totalAdds: p.visibilityAdds.length, totalRemoves: p.visibilityRemoves.length,
          optionsSupported: p.visibilityAdds.every(row => row.optionsSupported) && p.visibilityRemoves.every(row => row.optionsSupported),
        };
      });
      expect(before).toMatchObject({ timerActive: false, baselineAdds: 1, baselineRemoves: 0, baselineActive: true, totalAdds: 2, totalRemoves: 1, optionsSupported: true });
      expect(before).toMatchObject({ frames: 0, adds: 1, removes: 1, closes: 1 }); await page.clock.fastForward(5000);
      expect(await page.evaluate(() => (window as unknown as { timerProbe: { frameCalls: number } }).timerProbe.frameCalls)).toBe(before.frameCalls);
    } finally { await page.close(); }
  }, 30000);
});
