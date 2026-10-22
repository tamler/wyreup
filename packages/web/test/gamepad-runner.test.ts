import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { openBrowserHarness } from './browserHarness';
describe('mounted actual gamepad reader with controlled browser API data', () => {
  let harness: Awaited<ReturnType<typeof openBrowserHarness>>;
  beforeAll(async () => {
    harness = await openBrowserHarness('./test/fixtures/BuildingHardwareHarness.svelte');
  }, 30000);
  afterAll(async () => {
    await harness?.close();
  });
  it('starts on gesture, preserves API slot/raw overshoots and exports actual reader data', async () => {
    const page = await harness.browser.newPage();
    try {
      await page.clock.install();
      await page.addInitScript(() => {
        const probe = {
          reads: 0,
          mapping: 'standard',
          axes: [1.2, -0.05],
          buttons: [{ value: 1.1, pressed: true, touched: true }],
          frames: new Set<number>(),
        };
        Object.assign(window, { gamepadProbe: probe });
        Object.defineProperty(navigator, 'getGamepads', {
          configurable: true,
          value: () => {
            probe.reads++;
            return [
              null,
              {
                index: 7,
                id: '<img src=x>',
                mapping: probe.mapping,
                connected: true,
                timestamp: 42,
                axes: probe.axes,
                buttons: probe.buttons,
              },
            ];
          },
        });
        const request = requestAnimationFrame.bind(window),
          cancel = cancelAnimationFrame.bind(window);
        window.requestAnimationFrame = (callback) => {
          let id = 0;
          id = request((time) => {
            probe.frames.delete(id);
            callback(time);
          });
          probe.frames.add(id);
          return id;
        };
        window.cancelAnimationFrame = (id) => {
          probe.frames.delete(id);
          cancel(id);
        };
      });
      await page.goto(`${harness.url}?id=gamepad-tester`);
      expect(
        await page.evaluate(
          () => (window as unknown as { gamepadProbe: { reads: number } }).gamepadProbe.reads,
        ),
      ).toBe(0);
      await page.getByRole('button', { name: 'Start', exact: true }).focus();
      await page.keyboard.press('Enter');
      await page.getByText('API slot 1; index 7: <img src=x>', { exact: true }).waitFor();
      expect(await page.locator('img').count()).toBe(0);
      expect(await page.getByText('Button 0: Bottom face', { exact: true }).count()).toBe(1);
      expect(
        await page.getByText('Value 1.1; pressed true; touched true', { exact: true }).count(),
      ).toBe(1);
      expect(await page.getByText('1.2', { exact: true }).count()).toBe(1);
      await page.getByLabel('Visual dead zone').fill('.2');
      const event = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Export JSON' }).click();
      const path = await (await event).path();
      if (!path) throw new Error('No report');
      expect(JSON.parse(await readFile(path, 'utf8'))).toMatchObject({
        status: 'observed',
        deadZone: 0.2,
        devices: [
          {
            slot: 1,
            index: 7,
            axes: [1.2, -0.05],
            buttons: [{ value: 1.1, pressed: true, touched: true }],
            outOfNominal: { axes: [0], buttons: [0] },
          },
        ],
      });
      await page.evaluate(() => {
        const probe = (window as unknown as { gamepadProbe: { mapping: string } }).gamepadProbe;
        probe.mapping = 'custom';
        window.dispatchEvent(new Event('gamepadconnected'));
      });
      expect(await page.getByText('Button 0', { exact: true }).count()).toBe(1);
      expect(await page.getByText(/Bottom face/).count()).toBe(0);
      await page.getByRole('button', { name: 'Stop', exact: true }).click();
      const before = await page.evaluate(
        () =>
          (window as unknown as { gamepadProbe: { reads: number; frames: Set<number> } })
            .gamepadProbe.reads,
      );
      await page.clock.fastForward(1000);
      await page.evaluate(() => window.dispatchEvent(new Event('gamepaddisconnected')));
      expect(
        await page.evaluate(
          () =>
            (window as unknown as { gamepadProbe: { reads: number; frames: Set<number> } })
              .gamepadProbe.reads,
        ),
      ).toBe(before);
      expect(
        await page.evaluate(
          () =>
            (window as unknown as { gamepadProbe: { frames: Set<number> } }).gamepadProbe.frames
              .size,
        ),
      ).toBe(0);
      await page.getByRole('button', { name: 'Start', exact: true }).click();
      await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      expect(await page.getByRole('status').textContent()).toContain('tab is hidden');
      await page.getByRole('button', { name: 'Unmount runner' }).click();
      expect(
        await page.evaluate(
          () =>
            (window as unknown as { gamepadProbe: { frames: Set<number> } }).gamepadProbe.frames
              .size,
        ),
      ).toBe(0);
    } finally {
      await page.close();
    }
  }, 30000);
  it.each(['missing', 'denied', 'empty', 'nonfinite', 'too-many'] as const)(
    'shows honest %s API status without invented success',
    async (kind) => {
      const page = await harness.browser.newPage();
      try {
        await page.addInitScript((mode) => {
          Object.defineProperty(navigator, 'getGamepads', {
            configurable: true,
            value:
              mode === 'missing'
                ? undefined
                : () => {
                    if (mode === 'denied') throw new DOMException('Denied', 'SecurityError');
                    if (mode === 'empty') return [];
                    return [
                      {
                        index: 0,
                        id: 'Controlled',
                        mapping: '',
                        connected: true,
                        timestamp: 0,
                        axes: mode === 'nonfinite' ? [NaN] : new Array(65).fill(0),
                        buttons: [],
                      },
                    ];
                  },
          });
        }, kind);
        await page.goto(`${harness.url}?id=gamepad-tester`);
        await page.getByRole('button', { name: 'Start', exact: true }).click();
        if (kind === 'empty') {
          expect(await page.getByRole('status').textContent()).toContain('No exposed device');
          expect(await page.getByRole('alert').count()).toBe(0);
        } else {
          await page.getByRole('alert').waitFor();
          expect(await page.getByRole('alert').textContent()).toMatch(
            /unavailable|denied|nonfinite|64 axes/i,
          );
          expect(await page.getByRole('button', { name: 'Stop', exact: true }).isDisabled()).toBe(
            true,
          );
        }
      } finally {
        await page.close();
      }
    },
    30000,
  );
  it('rejects blank dead zone and suppresses an unmounted deferred actual export', async () => {
    const page = await harness.browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    try {
      await page.addInitScript(() => {
        Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [] });
      });
      await page.goto(`${harness.url}?id=gamepad-tester&defer=1`);
      await page.getByLabel('Visual dead zone').fill('');
      expect(await page.getByRole('button', { name: 'Start', exact: true }).isDisabled()).toBe(
        true,
      );
      await page.getByLabel('Visual dead zone').fill('0');
      await page.getByRole('button', { name: 'Export JSON' }).click();
      await page.getByRole('button', { name: 'Unmount runner' }).click();
      await page.evaluate(() =>
        (window as unknown as { buildingProbe: { reject(): void } }).buildingProbe.reject(),
      );
      await page.waitForTimeout(30);
      expect(errors).toEqual([]);
      expect(await page.getByRole('alert').count()).toBe(0);
      expect(
        await page.evaluate(
          () => (window as unknown as { buildingProbe: { aborted: number } }).buildingProbe.aborted,
        ),
      ).toBe(1);
    } finally {
      await page.close();
    }
  }, 30000);
});
