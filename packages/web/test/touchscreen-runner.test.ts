import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { openBrowserHarness } from './browserHarness';
describe('mounted actual pointer measurement and owned cache exports', () => {
  let harness: Awaited<ReturnType<typeof openBrowserHarness>>;
  beforeAll(async () => {
    harness = await openBrowserHarness('./test/fixtures/BuildingHardwareHarness.svelte');
  }, 30000);
  afterAll(async () => {
    await harness?.close();
  });
  it('rejects fractional grid, collects CSS far-edge/outside points, labels types and reopens exact JSON', async () => {
    const page = await harness.browser.newPage();
    try {
      await page.goto(`${harness.url}?id=touchscreen-dead-zone-tester`);
      expect(await page.getByRole('button', { name: 'Export JSON' }).isDisabled()).toBe(true);
      await page.getByLabel('Columns', { exact: true }).fill('2.5');
      expect(await page.getByRole('button', { name: 'Start', exact: true }).isDisabled()).toBe(
        true,
      );
      expect(await page.getByRole('alert').textContent()).toContain('columns');
      await page.getByLabel('Columns', { exact: true }).fill('2');
      await page.getByLabel('Rows', { exact: true }).fill('2');
      await page.getByRole('button', { name: 'Start', exact: true }).focus();
      await page.keyboard.press('Enter');
      await page.getByLabel('Pointer measurement canvas').evaluate((canvas) => {
        const r = canvas.getBoundingClientRect();
        for (const [type, x, y, kind] of [
          ['pointerdown', r.left, r.top, 'mouse'],
          ['pointermove', r.right, r.bottom, 'pen'],
          ['pointermove', r.left - 1, r.top, 'mouse'],
          ['pointercancel', r.left + r.width / 2, r.top + r.height / 2, 'touch'],
        ] as const)
          canvas.dispatchEvent(
            new PointerEvent(type, {
              clientX: x,
              clientY: y,
              pointerType: kind,
              pressure: 0.5,
              pointerId: 1,
              bubbles: true,
            }),
          );
      });
      await page.getByRole('button', { name: 'Stop', exact: true }).click();
      expect(await page.getByText('mouse: 2 observed samples', { exact: true }).count()).toBe(1);
      expect(await page.getByText('pen: 1 observed samples', { exact: true }).count()).toBe(1);
      const event = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Export JSON' }).click();
      const path = await (await event).path();
      if (!path) throw new Error('No report');
      const report = JSON.parse(await readFile(path, 'utf8')) as { rect: { width: number } };
      expect(report).toMatchObject({
        status: 'measured',
        sampleCount: 2,
        excludedSampleCount: 1,
        coveragePercent: 50,
        cellCoverage: [1, 0, 0, 1],
        pointerTypeCounts: { mouse: 2, pen: 1 },
      });
      expect(report.rect.width).toBeGreaterThan(0);
      expect(report).not.toHaveProperty('samples');
      await page.getByLabel('Columns', { exact: true }).fill('3');
      expect(await page.getByRole('button', { name: 'Export JSON' }).isDisabled()).toBe(true);
      expect(await page.getByRole('heading', { name: 'Measured coverage' }).count()).toBe(0);
    } finally {
      await page.close();
    }
  }, 30000);
  it('empty stop is not measured; timer stops excluded-only data at120 seconds', async () => {
    const page = await harness.browser.newPage();
    try {
      await page.clock.install();
      await page.goto(`${harness.url}?id=touchscreen-dead-zone-tester`);
      await page.getByRole('button', { name: 'Start', exact: true }).click();
      await page.getByRole('button', { name: 'Stop', exact: true }).click();
      expect(await page.getByRole('alert').textContent()).toContain(
        'Record at least one actual accepted/excluded sample',
      );
      expect(await page.getByRole('button', { name: 'Export JSON' }).isDisabled()).toBe(true);
      await page.getByRole('button', { name: 'Reset', exact: true }).click();
      await page.getByRole('button', { name: 'Start', exact: true }).click();
      await page.getByLabel('Pointer measurement canvas').evaluate((canvas) => {
        const r = canvas.getBoundingClientRect();
        canvas.dispatchEvent(
          new PointerEvent('pointermove', {
            clientX: r.left - 1,
            clientY: r.top,
            pointerType: 'mouse',
            pressure: 0,
            bubbles: true,
          }),
        );
      });
      await page.clock.fastForward(120000);
      expect(await page.getByRole('status').textContent()).toContain('120-second');
      expect(await page.getByRole('button', { name: 'Export JSON' }).isEnabled()).toBe(true);
      expect(await page.getByText(/0 touched cells/).count()).toBe(1);
    } finally {
      await page.close();
    }
  }, 30000);
  it.each(['resize', 'orientation', 'scroll'] as const)(
    'invalidates active coordinates/cache on %s and preserves a new stopped artifact',
    async (kind) => {
      const page = await harness.browser.newPage();
      try {
        await page.goto(`${harness.url}?id=touchscreen-dead-zone-tester`);
        await page.getByRole('button', { name: 'Start', exact: true }).click();
        await page.getByLabel('Pointer measurement canvas').evaluate((canvas) => {
          const r = canvas.getBoundingClientRect();
          canvas.dispatchEvent(
            new PointerEvent('pointermove', {
              clientX: r.left + 5,
              clientY: r.top + 5,
              pointerType: 'touch',
              pressure: 0.5,
              bubbles: true,
            }),
          );
        });
        expect(await page.getByRole('button', { name: 'Stop', exact: true }).isEnabled()).toBe(
          true,
        );
        await page.evaluate((mode) => {
          if (mode === 'scroll') {
            document.body.style.marginTop = '50px';
            window.dispatchEvent(new Event('scroll'));
          } else
            window.dispatchEvent(
              new Event(mode === 'orientation' ? 'orientationchange' : 'resize'),
            );
        }, kind);
        expect(await page.getByRole('button', { name: 'Export JSON' }).isDisabled()).toBe(true);
        expect(await page.getByRole('heading', { name: 'Measured coverage' }).count()).toBe(0);
        await page.getByRole('button', { name: 'Reset', exact: true }).click();
        await page.getByRole('button', { name: 'Start', exact: true }).click();
        await page.getByLabel('Pointer measurement canvas').evaluate((canvas) => {
          const r = canvas.getBoundingClientRect();
          canvas.dispatchEvent(
            new PointerEvent('pointermove', {
              clientX: r.left + 5,
              clientY: r.top + 5,
              pointerType: 'pen',
              pressure: 0,
              bubbles: true,
            }),
          );
        });
        await page.getByRole('button', { name: 'Stop', exact: true }).click();
        const beforeEvent = page.waitForEvent('download');
        await page.getByRole('button', { name: 'Export JSON' }).click();
        const beforePath = await (await beforeEvent).path();
        if (!beforePath) throw new Error('Missing stopped report.');
        const before = await readFile(beforePath, 'utf8');
        expect(JSON.parse(before)).toMatchObject({
          sampleCount: 1,
          excludedSampleCount: 0,
          pointerTypeCounts: { pen: 1 },
        });
        await page.evaluate((mode) => {
          document.body.style.marginTop = '100px';
          window.dispatchEvent(new Event(mode === 'orientation' ? 'orientationchange' : mode));
        }, kind);
        expect(await page.getByRole('button', { name: 'Export JSON' }).isEnabled()).toBe(true);
        expect(await page.getByRole('heading', { name: 'Measured coverage' }).count()).toBe(1);
        const afterEvent = page.waitForEvent('download');
        await page.getByRole('button', { name: 'Export JSON' }).click();
        const afterPath = await (await afterEvent).path();
        if (!afterPath) throw new Error('Missing preserved report.');
        expect(await readFile(afterPath, 'utf8')).toBe(before);
      } finally {
        await page.close();
      }
    },
    30000,
  );
  it('unmount cancels a pending real export and timer without late status/errors', async () => {
    const page = await harness.browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    try {
      await page.clock.install();
      await page.goto(`${harness.url}?id=touchscreen-dead-zone-tester&defer=1`);
      await page.getByRole('button', { name: 'Start', exact: true }).click();
      await page.getByLabel('Pointer measurement canvas').evaluate((canvas) => {
        const r = canvas.getBoundingClientRect();
        canvas.dispatchEvent(
          new PointerEvent('pointermove', {
            clientX: r.left + 5,
            clientY: r.top + 5,
            pointerType: 'touch',
            pressure: 0.5,
            bubbles: true,
          }),
        );
      });
      await page.getByRole('button', { name: 'Stop', exact: true }).click();
      await page.getByRole('button', { name: 'Export JSON' }).click();
      await page.getByRole('button', { name: 'Unmount runner' }).click();
      await page.evaluate(() =>
        (window as unknown as { buildingProbe: { reject(): void } }).buildingProbe.reject(),
      );
      await page.clock.fastForward(130000);
      expect(await page.getByRole('alert').count()).toBe(0);
      expect(errors).toEqual([]);
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
