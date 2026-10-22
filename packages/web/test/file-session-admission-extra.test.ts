import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openBrowserHarness } from './browserHarness';

interface Input {
  bytes: number[];
  name: string;
  mime: string;
  failRead?: boolean;
  understatedSize?: boolean;
}
interface Probe {
  events: { status: string; original: boolean; current: boolean; name: string }[];
  slices: number[];
  pendingOperations: number;
  completedOperations: number;
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
const textInput = (body: string): Input => ({
  bytes: [...new TextEncoder().encode(body)],
  name: 'session.json',
  mime: 'application/json',
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

describe('bounded actual File session admission negatives (source bridge)', () => {
  it('admits only the replacement File after the older actual CSV parse settles', async () => {
    const page = await pageFor(
      'csv-viewer',
      {
        ...textInput('name,count\nOriginal,3'),
        name: 'original.csv',
        mime: 'text/csv',
      },
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
      await page.getByRole('button', { name: 'Replace original preload' }).click();
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
      expect(
        await page.evaluate(
          () => (window as unknown as { admissionFixture: Probe }).admissionFixture.events,
        ),
      ).toEqual([]);
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
        .toBe(2);
      await page.evaluate(() =>
        (window as unknown as { admissionFixture: Probe }).admissionFixture.releaseOperation(),
      );
      await expect
        .poll(
          () =>
            page.evaluate(
              () => (window as unknown as { admissionFixture: Probe }).admissionFixture.events,
            ),
          { timeout: 1500 },
        )
        .toEqual([{ status: 'admitted', original: false, current: true, name: 'replacement.csv' }]);
      expect(
        await page.getByRole('button', { name: 'Edit source row 2 c0', exact: true }).textContent(),
      ).toBe('Replacement');
    } finally {
      await page.close();
    }
  }, 30000);

  it('a typed edit supersedes the pending real color operation without admitting the old File', async () => {
    const page = await pageFor(
      'color-converter',
      { ...textInput('#008000'), name: 'color.txt', mime: 'text/plain' },
      '&deferred',
    );
    try {
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
      await page.getByLabel('Color string', { exact: true }).fill('#0000ff');
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
        .toBe(2);
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
      expect(
        (
          await page.evaluate(
            () => (window as unknown as { admissionFixture: Probe }).admissionFixture.events,
          )
        ).some((event) => event.status === 'admitted'),
      ).toBe(false);
      await page.evaluate(() =>
        (window as unknown as { admissionFixture: Probe }).admissionFixture.releaseOperation(),
      );
      await expect
        .poll(() => page.locator('.swatch__hex').textContent(), { timeout: 1500 })
        .toBe('#0000ff');
      expect(
        (
          await page.evaluate(
            () => (window as unknown as { admissionFixture: Probe }).admissionFixture.events,
          )
        ).some((event) => event.status === 'admitted'),
      ).toBe(false);
    } finally {
      await page.close();
    }
  }, 30000);

  it.each([
    { id: 'stopwatch', limit: 102400, body: stopwatch },
    { id: 'wedding-seating-chart-builder', limit: 1048576, body: seating },
  ])(
    'refuses actual bytes above the $id cap despite understated File size',
    async ({ id, limit, body }) => {
      const input = textInput(body.padEnd(limit + 1, ' '));
      const page = await pageFor(id, { ...input, understatedSize: true });
      try {
        await expect
          .poll(
            () =>
              page.evaluate(
                () => (window as unknown as { admissionFixture: Probe }).admissionFixture.events,
              ),
            { timeout: 1500 },
          )
          .toEqual([{ status: 'refused', original: true, current: true, name: 'session.json' }]);
        const slices = await page.evaluate(
          () => (window as unknown as { admissionFixture: Probe }).admissionFixture.slices,
        );
        expect(slices).toEqual([limit + 1]);
        await page.getByRole('alert').waitFor();
        if (id === 'stopwatch')
          expect(await page.getByLabel('Elapsed time').textContent()).toBe('00:00:00.00');
        else
          expect(
            await page.getByRole('region', { name: 'Seating chart preview' }).textContent(),
          ).not.toContain('Original guest');
      } finally {
        await page.close();
      }
    },
    30000,
  );

  it('refuses a rejected actual CSV File read without admitting data', async () => {
    const page = await pageFor('csv-viewer', {
      ...textInput('name,count\nOriginal,3'),
      name: 'original.csv',
      mime: 'text/csv',
      failRead: true,
    });
    try {
      await page.getByLabel('Input delimiter', { exact: true }).selectOption('comma');
      await page.getByRole('button', { name: 'Load CSV', exact: true }).click();
      await expect
        .poll(
          () =>
            page.evaluate(
              () => (window as unknown as { admissionFixture: Probe }).admissionFixture.events,
            ),
          { timeout: 1500 },
        )
        .toEqual([{ status: 'refused', original: true, current: true, name: 'original.csv' }]);
      await page.getByRole('alert').waitFor();
      expect(
        await page.getByRole('button', { name: 'Edit source row 2 c0', exact: true }).count(),
      ).toBe(0);
    } finally {
      await page.close();
    }
  }, 30000);

  it.each([
    {
      id: 'psd-to-png',
      name: 'invalid.psd',
      mime: 'image/vnd.adobe.photoshop',
      button: 'Convert PSD to PNG',
    },
    {
      id: 'bank-statement-to-csv',
      name: 'invalid.pdf',
      mime: 'application/pdf',
      button: 'Extract PDF text',
    },
    {
      id: 'stl-to-gcode',
      name: 'invalid.stl',
      mime: 'model/stl',
      button: 'Generate contour preview',
    },
    { id: 'mp3-to-midi', name: 'invalid.mp3', mime: 'audio/mpeg', button: 'Analyze melody' },
  ])(
    'refuses malformed $id content after its actual explicit parser operation',
    async ({ id, name, mime, button }) => {
      const page = await pageFor(id, { ...textInput('not a valid file'), name, mime });
      try {
        expect(
          await page.evaluate(
            () => (window as unknown as { admissionFixture: Probe }).admissionFixture.events,
          ),
        ).toEqual([]);
        await page.getByRole('button', { name: button, exact: true }).click();
        await expect
          .poll(
            () =>
              page.evaluate(
                () => (window as unknown as { admissionFixture: Probe }).admissionFixture.events,
              ),
            { timeout: 1500 },
          )
          .toEqual([{ status: 'refused', original: true, current: true, name }]);
        await page.getByRole('alert').waitFor();
      } finally {
        await page.close();
      }
    },
    30000,
  );

  it('restores a completed countdown without replaying a completion alert', async () => {
    const page = await pageFor(
      'countdown-timer',
      textInput(
        JSON.stringify({
          version: 1,
          kind: 'countdown',
          state: 'done',
          elapsedMs: 1000,
          durationMs: 1000,
        }),
      ),
    );
    try {
      await expect
        .poll(
          () =>
            page.evaluate(
              () => (window as unknown as { admissionFixture: Probe }).admissionFixture.events,
            ),
          { timeout: 1500 },
        )
        .toEqual([{ status: 'admitted', original: true, current: true, name: 'session.json' }]);
      expect(await page.getByText('State: done', { exact: true }).count()).toBe(1);
      expect(await page.getByLabel('Remaining time').textContent()).toBe('00:00:00.00');
      expect(await page.getByText('Countdown complete.', { exact: true }).count()).toBe(0);
      expect(await page.getByRole('button', { name: 'Resume', exact: true }).isDisabled()).toBe(
        true,
      );
    } finally {
      await page.close();
    }
  }, 30000);
});
