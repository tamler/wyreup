import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import type { Page } from 'playwright';
import { openBrowserHarness } from './browserHarness';

async function collectContact(page: Page) {
  await page.getByLabel('Columns', { exact: true }).fill('2');
  await page.getByLabel('Rows', { exact: true }).fill('2');
  await page.evaluate(() => {
    document.body.style.minHeight = '2000px';
  });
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  return page.getByLabel('Pointer measurement canvas').evaluate((canvas) => {
    const r = canvas.getBoundingClientRect();
    for (const [type, x, y] of [
      ['pointerdown', r.left + 5, r.top + 5],
      ['pointermove', r.right - 5, r.bottom - 5],
    ] as const) {
      canvas.dispatchEvent(
        new PointerEvent(type, {
          clientX: x,
          clientY: y,
          pointerType: 'mouse',
          pressure: 0.5,
          pointerId: 1,
          buttons: 1,
          bubbles: true,
        }),
      );
    }
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  });
}

async function exportReport(page: Page) {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export JSON' }).click();
  const download = await pending;
  expect(download.suggestedFilename()).toBe('touchscreen-report.json');
  const path = await download.path();
  if (!path) throw new Error('Actual touchscreen download is missing.');
  return JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
}

async function changeGeometry(page: Page, kind: 'scroll' | 'resize') {
  if (kind === 'resize') await page.setViewportSize({ width: 640, height: 700 });
  else {
    await page.evaluate(() => window.scrollTo(0, 100));
    await page.waitForFunction(() => window.scrollY === 100);
  }
  // Allow the actual window event and Svelte DOM update to finish.
  await page.waitForTimeout(30);
}

describe('independent mounted building device source regressions', () => {
  let harness: Awaited<ReturnType<typeof openBrowserHarness>>;
  beforeAll(async () => {
    harness = await openBrowserHarness('./test/fixtures/BuildingHardwareHarness.svelte');
  }, 30000);
  afterAll(async () => {
    await harness?.close();
  });

  it.each(['scroll', 'resize'] as const)(
    'preserves stopped report, captured rectangle and actual cached export after %s',
    async (kind) => {
      const page = await harness.browser.newPage({ viewport: { width: 800, height: 800 } });
      try {
        await page.goto(`${harness.url}?id=touchscreen-dead-zone-tester`);
        const capturedRect = await collectContact(page);
        await page.getByRole('button', { name: 'Stop', exact: true }).focus();
        await page.keyboard.press('Enter');
        const before = await exportReport(page);
        expect(before).toMatchObject({
          grid: { columns: 2, rows: 2 },
          rect: capturedRect,
          status: 'measured',
          sampleCount: 2,
          excludedSampleCount: 0,
          coveragePercent: 50,
          cellCoverage: [1, 0, 0, 1],
          pointerTypeCounts: { mouse: 2 },
        });
        await changeGeometry(page, kind);
        expect(await page.getByRole('button', { name: 'Export JSON' }).isEnabled()).toBe(true);
        expect(await page.getByRole('heading', { name: 'Measured coverage' }).count()).toBe(1);
        // The actual module reads the owned session cache; full equality also proves
        // the captured rectangle, duration, counts and metadata survived unchanged.
        expect(await exportReport(page)).toEqual(before);
        expect(await page.getByRole('alert').count()).toBe(0);
      } finally {
        await page.close();
      }
    },
    30000,
  );

  it.each(['scroll', 'resize'] as const)(
    'invalidates an active session after an actual %s geometry change',
    async (kind) => {
      const page = await harness.browser.newPage({ viewport: { width: 800, height: 800 } });
      try {
        await page.goto(`${harness.url}?id=touchscreen-dead-zone-tester`);
        await collectContact(page);
        expect(await page.getByRole('button', { name: 'Stop', exact: true }).isEnabled()).toBe(
          true,
        );
        await changeGeometry(page, kind);
        expect(await page.getByRole('button', { name: 'Stop', exact: true }).isDisabled()).toBe(
          true,
        );
        expect(await page.getByRole('button', { name: 'Export JSON' }).isDisabled()).toBe(true);
        expect(await page.getByRole('heading', { name: 'Measured coverage' }).count()).toBe(0);
        await page.getByRole('button', { name: 'Reset', exact: true }).click();
        expect(await page.getByRole('button', { name: 'Start', exact: true }).isEnabled()).toBe(
          true,
        );
      } finally {
        await page.close();
      }
    },
    30000,
  );

  it.each(['denied', 'nonfinite'] as const)(
    'recovers from %s gamepad readings with a visible Start/Retry gesture',
    async (initialMode) => {
      const page = await harness.browser.newPage();
      try {
        await page.addInitScript((mode) => {
          const probe = { mode: mode as string, reads: 0 };
          Object.assign(window, { independentGamepadProbe: probe });
          Object.defineProperty(navigator, 'getGamepads', {
            configurable: true,
            value: () => {
              probe.reads++;
              if (probe.mode === 'denied')
                throw new DOMException('Controlled denied API', 'SecurityError');
              return [
                {
                  index: 0,
                  id: 'Independent controlled device',
                  mapping: '',
                  connected: true,
                  timestamp: 1,
                  axes: [probe.mode === 'nonfinite' ? NaN : 0.25],
                  buttons: [],
                },
              ];
            },
          });
        }, initialMode);
        await page.goto(`${harness.url}?id=gamepad-tester`);
        const originalDeadZone = await page.getByLabel('Visual dead zone').inputValue();
        await page.getByRole('button', { name: 'Start', exact: true }).click();
        await page.getByRole('alert').waitFor();
        expect(await page.getByRole('alert').textContent()).toMatch(/denied|nonfinite/i);
        expect(await page.getByRole('button', { name: 'Stop', exact: true }).isDisabled()).toBe(
          true,
        );
        await page.evaluate(() => {
          (
            window as unknown as { independentGamepadProbe: { mode: string } }
          ).independentGamepadProbe.mode = 'valid';
        });
        const retry = page.getByRole('button', { name: /^(Start|Retry)$/ });
        expect(await retry.isEnabled()).toBe(true);
        await retry.click();
        await page
          .getByText('API slot 0; index 0: Independent controlled device', { exact: true })
          .waitFor();
        expect(await page.getByRole('alert').count()).toBe(0);
        expect(await page.getByLabel('Visual dead zone').inputValue()).toBe(originalDeadZone);
        await page.getByRole('button', { name: 'Stop', exact: true }).click();
      } finally {
        await page.close();
      }
    },
    30000,
  );
});
