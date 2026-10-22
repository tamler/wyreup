import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import type { Page } from 'playwright';
import { openBrowserHarness } from './browserHarness';

async function readDownload(page: Page, name: string): Promise<string> {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name, exact: true }).click();
  const path = await (await pending).path();
  if (!path) throw new Error('Missing actual artifact.');
  return readFile(path, 'utf8');
}

async function point(page: Page, count = 1) {
  await page.getByLabel('Pointer measurement canvas').evaluate((canvas, amount) => {
    const r = canvas.getBoundingClientRect();
    for (let i = 0; i < amount; i++)
      canvas.dispatchEvent(
        new PointerEvent('pointermove', {
          clientX: r.left + 5,
          clientY: r.top + 5,
          pointerType: 'pen',
          pressure: 0,
          bubbles: true,
        }),
      );
  }, count);
}

describe('reviewed building correction owned browser contracts', () => {
  let harness: Awaited<ReturnType<typeof openBrowserHarness>>;
  beforeAll(async () => {
    harness = await openBrowserHarness('./test/fixtures/BuildingHardwareHarness.svelte');
  }, 30000);
  afterAll(async () => {
    await harness?.close();
  });

  it.each(['timer', 'event-cap'] as const)(
    'preserves automatically %s-sealed reports after all layout events',
    async (mode) => {
      const page = await harness.browser.newPage();
      try {
        await page.clock.install();
        await page.goto(`${harness.url}?id=touchscreen-dead-zone-tester`);
        await page.getByLabel('Columns', { exact: true }).fill('2');
        await page.getByLabel('Rows', { exact: true }).fill('2');
        await page.getByRole('button', { name: 'Start', exact: true }).click();
        await point(page, mode === 'timer' ? 1 : 100000);
        if (mode === 'timer') await page.clock.fastForward(120000);
        expect(await page.getByRole('button', { name: 'Stop', exact: true }).isDisabled()).toBe(
          true,
        );
        expect(await page.getByRole('status').textContent()).toContain(
          mode === 'timer' ? '120-second' : '100000-event',
        );
        const before = await readDownload(page, 'Export JSON');
        expect(JSON.parse(before)).toMatchObject({
          status: 'measured',
          sampleCount: mode === 'timer' ? 1 : 100000,
          pointerTypeCounts: { pen: mode === 'timer' ? 1 : 100000 },
          touchedCells: 1,
          cellCoverage: [mode === 'timer' ? 1 : 100000, 0, 0, 0],
        });
        for (const kind of ['resize', 'orientationchange', 'scroll']) {
          await page.evaluate((event) => {
            document.body.style.marginTop = '100px';
            window.dispatchEvent(new Event(event));
          }, kind);
          expect(await readDownload(page, 'Export JSON')).toBe(before);
        }
        expect(await page.getByText(/Mouse or pen hover can contribute/).count()).toBe(1);
        await page.getByRole('button', { name: 'Reset', exact: true }).click();
        expect(await page.getByRole('button', { name: 'Export JSON' }).isDisabled()).toBe(true);
      } finally {
        await page.close();
      }
    },
    30000,
  );

  it('keeps a real deferred sealed export valid across orientation and scroll', async () => {
    const page = await harness.browser.newPage();
    try {
      await page.goto(`${harness.url}?id=touchscreen-dead-zone-tester&defer=1`);
      await page.getByRole('button', { name: 'Start', exact: true }).click();
      await point(page);
      await page.getByRole('button', { name: 'Stop', exact: true }).click();
      const pending = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Export JSON' }).click();
      await page.evaluate(() => {
        document.body.style.marginTop = '100px';
        window.dispatchEvent(new Event('orientationchange'));
        window.dispatchEvent(new Event('scroll'));
        const p = (window as unknown as { buildingProbe: { aborted: number; resolve(): void } })
          .buildingProbe;
        if (p.aborted) throw new Error('Stopped layout aborted the owned export.');
        p.resolve();
      });
      const path = await (await pending).path();
      if (!path) throw new Error('Missing deferred sealed artifact.');
      expect(JSON.parse(await readFile(path, 'utf8'))).toMatchObject({
        sampleCount: 1,
        pointerTypeCounts: { pen: 1 },
      });
      expect(await page.getByRole('alert').count()).toBe(0);
    } finally {
      await page.close();
    }
  }, 30000);

  it.each(['board-foot-calculator', 'gutter-size-calculator', 'generator-wattage-calculator'])(
    'shows actual %s assumptions and units outside collapsed JSON',
    async (id) => {
      const page = await harness.browser.newPage();
      try {
        await page.goto(`${harness.url}?id=${id}`);
        if (id === 'board-foot-calculator') {
          await page.getByText('Paste a JSON row array', { exact: true }).click();
          const pieces = Array.from({ length: 2 }, () => ({
            thicknessIn: 1,
            widthIn: 12,
            lengthFt: 1,
            quantity: 1,
            pricePerBoardFoot: 0.006,
          }));
          await page.getByLabel('Paste pieces', { exact: true }).fill(JSON.stringify(pieces));
          await page.getByRole('button', { name: 'Apply rows', exact: true }).click();
        }
        await page.getByRole('button', { name: 'Calculate', exact: true }).click();
        await page.getByRole('button', { name: 'Download JSON' }).waitFor();
        expect(await page.getByLabel('Result units', { exact: true }).isVisible()).toBe(true);
        expect(await page.getByLabel('Result assumptions', { exact: true }).isVisible()).toBe(true);
        expect(
          await page
            .getByText('Full JSON result', { exact: true })
            .evaluate((summary) => summary.parentElement?.hasAttribute('open')),
        ).toBe(false);
        const result = JSON.parse(await readDownload(page, 'Download JSON')) as {
          units: Record<string, string>;
          assumptions: string[];
          pieces?: { cost: number }[];
          totalCost?: number;
        };
        expect(Object.keys(result.units).length).toBeGreaterThan(0);
        for (const assumption of result.assumptions) {
          expect(
            await page
              .getByLabel('Result assumptions', { exact: true })
              .getByText(assumption, { exact: true })
              .isVisible(),
          ).toBe(true);
        }
        if (id === 'board-foot-calculator') {
          if (!result.pieces) throw new Error('Missing actual board rows.');
          expect(result.pieces.map((row: { cost: number }) => row.cost)).toEqual([0.01, 0.01]);
          expect(result.totalCost).toBe(0.01);
          expect(
            await page
              .getByLabel('pieces table', { exact: true })
              .getByRole('cell', { name: '0.01', exact: true })
              .count(),
          ).toBe(2);
          expect(
            await page.getByLabel('Result assumptions', { exact: true }).textContent(),
          ).toContain('rounded once from unrounded row costs');
        }
      } finally {
        await page.close();
      }
    },
    30000,
  );

  it('retries a denied API only on Start, keeps blank inputs invalid, and cancels stale export errors on retry', async () => {
    const page = await harness.browser.newPage();
    try {
      await page.addInitScript(() => {
        const p = { denied: true, reads: 0 };
        Object.assign(window, { ownedGamepadProbe: p });
        Object.defineProperty(navigator, 'getGamepads', {
          configurable: true,
          value: () => {
            p.reads++;
            if (p.denied) throw new DOMException('Controlled denied API', 'SecurityError');
            return [
              {
                index: 0,
                id: 'Owned recovered device',
                mapping: '',
                connected: true,
                timestamp: 1,
                axes: [0.25],
                buttons: [],
              },
            ];
          },
        });
      });
      await page.goto(`${harness.url}?id=gamepad-tester&defer=1`);
      expect(await page.getByRole('button', { name: 'Export JSON' }).isEnabled()).toBe(true);
      for (let i = 0; i < 2; i++) {
        await page.getByRole('button', { name: 'Start', exact: true }).click();
        await page.getByRole('alert').waitFor();
      }
      const reads = await page.evaluate(
        () =>
          (window as unknown as { ownedGamepadProbe: { reads: number } }).ownedGamepadProbe.reads,
      );
      expect(reads).toBe(2);
      await page.evaluate(() => {
        (window as unknown as { ownedGamepadProbe: { denied: boolean } }).ownedGamepadProbe.denied =
          false;
      });
      await page.waitForTimeout(30);
      expect(
        await page.evaluate(
          () =>
            (window as unknown as { ownedGamepadProbe: { reads: number } }).ownedGamepadProbe.reads,
        ),
      ).toBe(reads);
      await page.getByLabel('Visual dead zone').fill('');
      expect(await page.getByRole('button', { name: 'Start', exact: true }).isDisabled()).toBe(
        true,
      );
      await page.getByLabel('Visual dead zone').fill('0');
      await page.getByRole('button', { name: 'Start', exact: true }).click();
      await page
        .getByText('API slot 0; index 0: Owned recovered device', { exact: true })
        .waitFor();
      await page.getByRole('button', { name: 'Stop', exact: true }).click();
      await page.getByRole('button', { name: 'Export JSON' }).click();
      await page.getByRole('button', { name: 'Start', exact: true }).click();
      await page.evaluate(() =>
        (window as unknown as { buildingProbe: { reject(): void } }).buildingProbe.reject(),
      );
      await page.waitForTimeout(30);
      expect(await page.getByRole('alert').count()).toBe(0);
      expect(
        await page.evaluate(
          () => (window as unknown as { buildingProbe: { aborted: number } }).buildingProbe.aborted,
        ),
      ).toBe(1);
      await page.getByRole('button', { name: 'Stop', exact: true }).click();
      const pending = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Export JSON' }).click();
      await page.evaluate(() =>
        (window as unknown as { buildingProbe: { resolve(): void } }).buildingProbe.resolve(),
      );
      const path = await (await pending).path();
      if (!path) throw new Error('Missing actual recovered device report.');
      expect(JSON.parse(await readFile(path, 'utf8'))).toMatchObject({
        status: 'observed',
        deadZone: 0,
        devices: [{ descriptor: 'Owned recovered device', axes: [0.25] }],
      });
    } finally {
      await page.close();
    }
  }, 30000);
});
