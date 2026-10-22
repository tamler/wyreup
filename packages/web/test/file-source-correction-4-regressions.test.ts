import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import type { Page } from 'playwright';
import {
  originalAnnotationPdf,
  originalProjectedAnnotationPdf,
} from '../../core/test/helpers/file4-annotation-fixtures.js';
import { asciiStl, box } from '../../core/test/fixtures/catalog-files/stl-fixtures.js';
import { parseCsv } from '../../core/src/utilities/csv-data.js';
import { openBrowserHarness } from './browserHarness';

async function upload(page: Page, bytes: Uint8Array, name: string, mimeType: string) {
  const pending = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Drop file or click to browse', exact: true }).click();
  await (await pending).setFiles({ name, mimeType, buffer: Buffer.from(bytes) });
}
async function approveText(page: Page) {
  await page.getByLabel('Role p1-l1', { exact: true }).selectOption('opening');
  await page.getByLabel('Role p1-l3', { exact: true }).selectOption('closing');
  for (const id of ['p1-l1', 'p1-l2', 'p1-l3'])
    await page.getByLabel(`Decision ${id}`, { exact: true }).selectOption('accept');
  await page
    .getByLabel('I reviewed every candidate and visual-page exception', { exact: true })
    .check();
}
async function csv(page: Page) {
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download reviewed CSV', exact: true }).click();
  const path = await (await event).path();
  if (!path) throw new Error('Actual reviewed CSV download missing.');
  const table = parseCsv(await readFile(path), { delimiter: 'comma', hasHeader: true });
  return table.rows.map((row) =>
    Object.fromEntries(table.columns.map((column, index) => [column.label, row.cells[index]])),
  );
}

describe('FILE4 actual mounted bank worker appearances', () => {
  let harness: Awaited<ReturnType<typeof openBrowserHarness>>;
  beforeAll(async () => {
    harness = await openBrowserHarness('./test/fixtures/BankHarness.svelte', { fileWorker: true });
  }, 30000);
  afterAll(async () => {
    await harness?.close();
  });
  it.each(['only', 'mixed'] as const)(
    'requires and preserves original %s visual-page review in actual worker CSV',
    async (kind) => {
      const page = await harness.browser.newPage();
      const unexpectedRequests: string[] = [];
      page.on('request', (request) => {
        const url = new URL(request.url());
        if (
          url.protocol !== 'blob:' &&
          url.protocol !== 'data:' &&
          url.origin !== new URL(harness.url).origin
        )
          unexpectedRequests.push(request.url());
      });
      try {
        await page.goto(harness.url);
        await page.getByLabel('Opening balance', { exact: true }).fill('1000.00');
        await page.getByLabel('Closing balance', { exact: true }).fill('990.00');
        await upload(
          page,
          await originalAnnotationPdf(kind),
          'original-annotation.pdf',
          'application/pdf',
        );
        await page.getByRole('button', { name: 'Extract PDF text', exact: true }).click();
        await page.getByLabel('Role p1-l1', { exact: true }).waitFor();
        await approveText(page);
        expect(
          await page
            .getByRole('button', { name: 'Download reviewed CSV', exact: true })
            .isDisabled(),
        ).toBe(true);
        for (const number of kind === 'only' ? [2, 3] : [1]) {
          const decision = page.getByLabel(`Page ${number} decision`, { exact: true });
          expect(await decision.count()).toBe(1);
          await decision.selectOption('include');
          expect(
            await page
              .getByLabel('I reviewed every candidate and visual-page exception', { exact: true })
              .isChecked(),
          ).toBe(false);
          expect(
            await page
              .getByRole('button', { name: 'Download reviewed CSV', exact: true })
              .isDisabled(),
          ).toBe(true);
          await page
            .getByLabel(`Page ${number} review reason`, { exact: true })
            .fill(
              `Inspected original appearance on page ${number}; visual content is not converted.`,
            );
          expect(
            await page
              .getByLabel('I reviewed every candidate and visual-page exception', { exact: true })
              .isChecked(),
          ).toBe(false);
          expect(
            await page
              .getByRole('button', { name: 'Download reviewed CSV', exact: true })
              .isDisabled(),
          ).toBe(true);
        }
        await page
          .getByLabel('I reviewed every candidate and visual-page exception', { exact: true })
          .check();
        const rows = await csv(page);
        if (kind === 'only') {
          expect(rows).toHaveLength(5);
          expect(
            rows
              .filter((row) => row.status === 'page-included')
              .map((row) => [row.sourcePage, row.pageVisual, row.pageDecision]),
          ).toEqual([
            ['2', 'nontext', 'include'],
            ['3', 'nontext', 'include'],
          ]);
          expect(rows.every((row) => row.overallStatus === 'reviewed-with-exceptions')).toBe(true);
        } else {
          expect(rows).toHaveLength(3);
          expect(
            rows.every(
              (row) =>
                row.pageVisual === 'mixed' &&
                row.pageDecision === 'include' &&
                !!row.pageReviewReason &&
                row.overallStatus === 'reconciled',
            ),
          ).toBe(true);
        }
        expect(rows.filter((row) => row.role === 'transaction').map((row) => row.amount)).toEqual([
          '-10.00',
        ]);
        expect(unexpectedRequests).toEqual([]);
        expect(
          await page.evaluate(() => {
            const action: unknown = Reflect.get(window, '__file4AnnotationAction');
            return action;
          }),
        ).toBeUndefined();
      } finally {
        await page.close();
      }
    },
    30000,
  );
  it('shows persistent scoped omission, conservative Off and hard capacity explanations before detection', async () => {
    const page = await harness.browser.newPage();
    try {
      await page.goto(harness.url);
      expect(
        await page
          .getByText(/unselected listbox labels.*rich-text-only notes.*viewer-generated stamps/)
          .isVisible(),
      ).toBe(true);
      expect(
        await page.getByText(/reconciliation does not verify its visual content/).isVisible(),
      ).toBe(true);
      expect(await page.getByText(/unchecked values such as ['‘]Off/).isVisible()).toBe(true);
      expect(await page.getByText(/1000 strings.*1\s?MiB.*10\s?MiB.*duplicate/i).isVisible()).toBe(
        true,
      );
    } finally {
      await page.close();
    }
  });
  it.each([
    'text-freetext',
    'text-widget',
    'off-empty-ap',
    'off-no-ap',
    'text-link',
    'empty-widget',
    'listbox',
  ] as const)(
    'preserves actual %s scoped classification, acknowledgment reset and full worker CSV',
    async (kind) => {
      const page = await harness.browser.newPage();
      try {
        await page.goto(harness.url);
        await page.getByLabel('Opening balance', { exact: true }).fill('1000.00');
        await page.getByLabel('Closing balance', { exact: true }).fill('990.00');
        await upload(
          page,
          await originalProjectedAnnotationPdf(kind),
          'original-projected.pdf',
          'application/pdf',
        );
        await page.getByRole('button', { name: 'Extract PDF text', exact: true }).click();
        await page.getByLabel('Role p1-l1', { exact: true }).waitFor();
        await approveText(page);
        const requiresReview = [
          'text-freetext',
          'text-widget',
          'off-empty-ap',
          'off-no-ap',
        ].includes(kind);
        const download = page.getByRole('button', { name: 'Download reviewed CSV', exact: true });
        const decision = page.getByLabel('Page 1 decision', { exact: true });
        expect(await download.isDisabled()).toBe(requiresReview);
        expect(await decision.count()).toBe(requiresReview ? 1 : 0);
        if (requiresReview) {
          await decision.selectOption('include');
          expect(
            await page
              .getByLabel('I reviewed every candidate and visual-page exception', { exact: true })
              .isChecked(),
          ).toBe(false);
          expect(await download.isDisabled()).toBe(true);
          await page
            .getByLabel('Page 1 review reason', { exact: true })
            .fill('Reviewed every original PDF field and annotation; content is not an amount.');
          expect(await download.isDisabled()).toBe(true);
          expect(
            await page
              .getByLabel('I reviewed every candidate and visual-page exception', { exact: true })
              .isChecked(),
          ).toBe(false);
          await page
            .getByLabel('I reviewed every candidate and visual-page exception', { exact: true })
            .check();
        }
        const rows = await csv(page);
        expect(rows).toHaveLength(3);
        expect(
          rows.every(
            (row) =>
              row.pageVisual === (requiresReview ? 'unknown' : 'text') &&
              row.overallStatus === (requiresReview ? 'reviewed-with-exceptions' : 'reconciled'),
          ),
        ).toBe(true);
        expect(rows.filter((row) => row.role === 'transaction').map((row) => row.amount)).toEqual([
          '-10.00',
        ]);
        if (requiresReview)
          expect(
            rows.every((row) => row.pageDecision === 'include' && !!row.pageReviewReason),
          ).toBe(true);
        expect(
          await page
            .getByText(/unselected listbox labels.*rich-text-only notes.*viewer-generated stamps/)
            .isVisible(),
        ).toBe(true);
      } finally {
        await page.close();
      }
    },
    30000,
  );
});

describe('FILE4 actual mounted STL worker boundary artifact', () => {
  let harness: Awaited<ReturnType<typeof openBrowserHarness>>;
  beforeAll(async () => {
    harness = await openBrowserHarness('./test/fixtures/StlHarness.svelte', { fileWorker: true });
  }, 30000);
  afterAll(async () => {
    await harness?.close();
  });
  it('downloads both genuine empty midpoint planes after the component top', async () => {
    const page = await harness.browser.newPage();
    try {
      await page.goto(harness.url);
      await page.getByLabel('Layer height (mm)', { exact: true }).fill('4');
      await upload(
        page,
        asciiStl([...box(0, 0, 0, 10, 10, 2), ...box(0, 0, 8, 10, 10, 10)]),
        'original-gap.stl',
        'model/stl',
      );
      await page.getByRole('button', { name: 'Generate contour preview', exact: true }).click();
      await page.waitForFunction(
        () =>
          !!document.querySelector('[role="alert"]') ||
          !!document.querySelector('a[download="contour-preview.gcode"]'),
      );
      expect(await page.getByRole('alert').allTextContents()).toEqual([]);
      expect(await page.getByRole('alert').count()).toBe(0);
      const event = page.waitForEvent('download');
      await page
        .getByRole('link', { name: 'Download all-layer contour G-code', exact: true })
        .click();
      const path = await (await event).path();
      if (!path) throw new Error('Actual contour artifact missing.');
      const text = await readFile(path, 'utf8');
      expect(text).toContain('G0 Z2\n; empty layer\n');
      expect(text).toContain('G0 Z6\n; empty layer\n');
      expect(text).not.toMatch(/^G[01] X/m);
    } finally {
      await page.close();
    }
  }, 30000);
});
