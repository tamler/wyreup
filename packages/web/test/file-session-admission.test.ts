import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import type { Page } from 'playwright';
import { openBrowserHarness } from './browserHarness';
import { asciiStl, box } from '../../core/test/fixtures/catalog-files/stl-fixtures';

interface Input {
  bytes: number[];
  name: string;
  mime: string;
  delayedRead?: boolean;
  failRead?: boolean;
  understatedSize?: boolean;
}
interface Probe {
  events: { status: string; original: boolean; current: boolean; name: string }[];
  reads: number;
  completedReads: number;
  pendingOperations: number;
  completedOperations: number;
  slices: number[];
  releaseRead(): void;
  releaseOperation(): void;
}
let harness: Awaited<ReturnType<typeof openBrowserHarness>>;
beforeAll(async () => {
  harness = await openBrowserHarness('./test/fixtures/FileSessionAdmissionHarness.svelte', {
    fileWorker: true,
  });
}, 30000);
afterAll(async () => {
  await harness?.close();
});
async function pageFor(id: string, input: Input, query = '') {
  const page = await harness.browser.newPage();
  await page.addInitScript((raw) => {
    Object.assign(window, { admissionFixtureInput: raw });
  }, input);
  await page.goto(`${harness.url}?id=${id}${query}`);
  await page.getByRole('button', { name: 'Unmount admission runner' }).waitFor();
  return page;
}
async function events(page: Page) {
  return page.evaluate(
    () => (window as unknown as { admissionFixture: Probe }).admissionFixture.events,
  );
}
async function admitted(page: Page, name: string) {
  await expect
    .poll(() => events(page), { timeout: 1500 })
    .toEqual([{ status: 'admitted', original: true, current: true, name }]);
}
const textInput = (body: string, name = 'session.json', mime = 'application/json'): Input => ({
  bytes: [...new TextEncoder().encode(body)],
  name,
  mime,
});
const stopwatch = JSON.stringify({
  version: 1,
  kind: 'stopwatch',
  state: 'running',
  elapsedMs: 3000,
  laps: [],
});
const seating = JSON.stringify({
  version: 1,
  kind: 'seating',
  guests: [{ id: 'g1', name: 'Original guest' }],
  tables: [{ id: 't1', name: 'Original table', capacity: 2 }],
  assignments: [{ guestId: 'g1', tableId: 't1' }],
});

describe('actual expanded runner File admission (source bridge, not production routing)', () => {
  it('acknowledges CSV only after actual parsing, with the original file data', async () => {
    const page = await pageFor(
      'csv-viewer',
      textInput('name,count\nOriginal,3', 'original.csv', 'text/csv'),
    );
    try {
      expect(await events(page)).toEqual([]);
      await page.getByLabel('Input delimiter', { exact: true }).selectOption('comma');
      await page.getByRole('button', { name: 'Load CSV', exact: true }).click();
      await admitted(page, 'original.csv');
      expect(
        await page.getByRole('button', { name: 'Edit source row 2 c0', exact: true }).textContent(),
      ).toBe('Original');
    } finally {
      await page.close();
    }
  }, 30000);
  it.each([
    {
      id: 'psd-to-png',
      name: 'original.psd',
      mime: 'image/vnd.adobe.photoshop',
      path: '../../core/test/fixtures/catalog-composite.psd',
      button: 'Convert PSD to PNG',
    },
    {
      id: 'bank-statement-to-csv',
      name: 'original.pdf',
      mime: 'application/pdf',
      path: '../../core/test/fixtures/catalog-files/bank-known.pdf',
      button: 'Extract PDF text',
    },
    {
      id: 'mp3-to-midi',
      name: 'original.mp3',
      mime: 'audio/mpeg',
      path: '../../core/test/fixtures/catalog-files/melody-220-440.mp3',
      button: 'Analyze melody',
    },
  ])(
    'acknowledges $id only after its real current operation',
    async ({ id, name, mime, path, button }) => {
      const bytes = await readFile(new URL(path, import.meta.url));
      const page = await pageFor(id, { bytes: [...bytes], name, mime });
      try {
        expect(await events(page)).toEqual([]);
        await page.getByRole('button', { name: button, exact: true }).click({ timeout: 1500 });
        await admitted(page, name);
        if (id === 'psd-to-png') await page.getByRole('link', { name: 'Download PNG' }).waitFor();
        if (id === 'mp3-to-midi')
          await page.getByRole('region', { name: 'Detected melody' }).waitFor();
        if (id === 'bank-statement-to-csv')
          expect(await page.locator('tbody tr').count()).toBeGreaterThan(0);
      } finally {
        await page.close();
      }
    },
    30000,
  );
  it('acknowledges STL after real worker contours and current preview commit', async () => {
    const page = await pageFor('stl-to-gcode', {
      bytes: [...asciiStl(box())],
      name: 'original.stl',
      mime: 'model/stl',
    });
    try {
      expect(await events(page)).toEqual([]);
      await page.getByRole('button', { name: 'Generate contour preview' }).click();
      await admitted(page, 'original.stl');
      expect(await page.locator('polygon').getAttribute('points')).toBe('0,0 10,0 10,10 0,10');
    } finally {
      await page.close();
    }
  }, 30000);
  it('restores a validated stopwatch paused before acknowledging, with exact saved elapsed time', async () => {
    const page = await pageFor('stopwatch', textInput(stopwatch));
    try {
      await admitted(page, 'session.json');
      expect(await page.getByText('State: paused', { exact: true }).count()).toBe(1);
      expect(await page.getByLabel('Elapsed time').textContent()).toBe('00:00:03.00');
      const download = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Save session JSON' }).click();
      const path = await (await download).path();
      if (!path) throw new Error('Session download missing.');
      expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({
        version: 1,
        kind: 'stopwatch',
        state: 'paused',
        elapsedMs: 3000,
        laps: [],
      });
    } finally {
      await page.close();
    }
  }, 30000);
  it('restores and acknowledges the actual seating plan with unchanged assignments', async () => {
    const page = await pageFor('wedding-seating-chart-builder', textInput(seating));
    try {
      await admitted(page, 'session.json');
      expect(
        await page.getByRole('region', { name: 'Seating chart preview' }).textContent(),
      ).toContain('Original guest');
      const download = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Save plan JSON' }).click();
      const path = await (await download).path();
      if (!path) throw new Error('Plan download missing.');
      expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(JSON.parse(seating));
    } finally {
      await page.close();
    }
  }, 30000);
  it('acknowledges color only after actual valid parsing and retains invalid-result semantics', async () => {
    const page = await pageFor('color-converter', textInput('#008000', 'color.txt', 'text/plain'));
    try {
      await admitted(page, 'color.txt');
      expect(await page.getByText('#008000', { exact: true }).count()).toBeGreaterThan(0);
    } finally {
      await page.close();
    }
    const invalid = await pageFor(
      'color-converter',
      textInput('not-a-color', 'bad-color.txt', 'text/plain'),
    );
    try {
      await expect
        .poll(() => events(invalid), { timeout: 1500 })
        .toEqual([{ status: 'refused', original: true, current: true, name: 'bad-color.txt' }]);
      expect(
        await invalid.getByRole('button', { name: 'Download JSON', exact: true }).count(),
      ).toBe(0);
    } finally {
      await invalid.close();
    }
  }, 30000);
  it.each(['stopwatch', 'wedding-seating-chart-builder'])(
    'refuses malformed UTF-8 for %s without admitting or replacing state',
    async (id) => {
      const page = await pageFor(id, {
        bytes: [123, 34, 120, 34, 58, 34, 255, 34, 125],
        name: 'bad.json',
        mime: 'application/json',
      });
      try {
        await expect
          .poll(() => events(page), { timeout: 1500 })
          .toEqual([{ status: 'refused', original: true, current: true, name: 'bad.json' }]);
        await page.getByRole('alert').waitFor();
      } finally {
        await page.close();
      }
    },
    30000,
  );
  it('invalidates late timer restore on Reset rather than overwriting the user gesture', async () => {
    const page = await pageFor('stopwatch', { ...textInput(stopwatch), delayedRead: true });
    try {
      await expect
        .poll(
          () =>
            page.evaluate(
              () => (window as unknown as { admissionFixture: Probe }).admissionFixture.reads,
            ),
          { timeout: 1500 },
        )
        .toBe(1);
      await page.getByRole('button', { name: 'Reset', exact: true }).click();
      await page.evaluate(() =>
        (window as unknown as { admissionFixture: Probe }).admissionFixture.releaseRead(),
      );
      await expect
        .poll(
          () =>
            page.evaluate(
              () =>
                (window as unknown as { admissionFixture: Probe }).admissionFixture.completedReads,
            ),
          { timeout: 1500 },
        )
        .toBe(1);
      expect((await events(page)).some((event) => event.status === 'admitted')).toBe(false);
      expect(await page.getByLabel('Elapsed time').textContent()).toBe('00:00:00.00');
    } finally {
      await page.close();
    }
  }, 30000);
  it('ignores late CSV parse after unmount without acknowledging the old file', async () => {
    const page = await pageFor(
      'csv-viewer',
      textInput('name,count\nOriginal,3', 'original.csv', 'text/csv'),
      '&deferred',
    );
    try {
      await page.getByLabel('Input delimiter', { exact: true }).selectOption('comma');
      await page.getByRole('button', { name: 'Load CSV', exact: true }).click();
      await expect
        .poll(
          () =>
            page.evaluate(
              () =>
                (window as unknown as { admissionFixture: Probe }).admissionFixture
                  .pendingOperations,
            ),
          { timeout: 1500 },
        )
        .toBe(1);
      await page.getByRole('button', { name: 'Unmount admission runner' }).click();
      await page.evaluate(() =>
        (window as unknown as { admissionFixture: Probe }).admissionFixture.releaseOperation(),
      );
      await expect
        .poll(
          () =>
            page.evaluate(
              () =>
                (window as unknown as { admissionFixture: Probe }).admissionFixture
                  .completedOperations,
            ),
          { timeout: 1500 },
        )
        .toBe(1);
      expect(await events(page)).toEqual([]);
    } finally {
      await page.close();
    }
  }, 30000);
});
