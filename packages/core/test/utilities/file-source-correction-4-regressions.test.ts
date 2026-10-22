import { describe, expect, it, vi } from 'vitest';
import {
  bankDefaults,
  exportBankStatement,
  extractBankStatement,
  reviewBankStatement,
  type BankDocument,
  type BankParams,
  type BankPdfEnvironment,
} from '../../src/utilities/bank-statement.js';
import { createBankPdfEnvironment } from '../../src/utilities/bank-pdf.js';
import { parseCsv } from '../../src/utilities/csv-data.js';
import { buildStlContours, validateStlJobResult } from '../../src/utilities/stl-contours.js';
import {
  originalAnnotationPdf,
  originalProjectedAnnotationPdf,
  type AnnotationFixtureKind,
  type ProjectedAnnotationKind,
} from '../helpers/file4-annotation-fixtures.js';
import { asciiStl, box } from '../fixtures/catalog-files/stl-fixtures.js';

vi.mock(
  '../../src/utilities/bank-pdf-platform.js',
  async () => import('../../src/utilities/bank-pdf-node.js'),
);
const signal = () => new AbortController().signal;
async function extract(kind: AnnotationFixtureKind) {
  return extractBankStatement(
    await originalAnnotationPdf(kind),
    2,
    signal(),
    await createBankPdfEnvironment(),
  );
}
function params(document: BankDocument): BankParams {
  return {
    ...structuredClone(bankDefaults),
    opening: '1000.00',
    closing: '990.00',
    acknowledged: true,
    lineDecisions: document.lines.map((line) => ({
      id: line.id,
      decision: 'accept',
      role: line.line === 1 ? 'opening' : line.line === 3 ? 'closing' : 'transaction',
    })),
  };
}
function csvRows(document: BankDocument, value: BankParams) {
  const table = parseCsv(new TextEncoder().encode(exportBankStatement(document, value)), {
    delimiter: 'comma',
    hasHeader: true,
  });
  return table.rows.map((row) =>
    Object.fromEntries(table.columns.map((column, index) => [column.label, row.cells[index]!])),
  );
}

describe('FILE4 original annotation appearance regressions', () => {
  it.each(['only', 'text-only'] as const)(
    'observes %s appearance operators and display metadata through the actual locked PDF environment',
    async (kind) => {
      const env = await createBankPdfEnvironment();
      const task = env.open(await originalAnnotationPdf(kind));
      try {
        const pdf = await task.promise;
        const page = await pdf.getPage(2);
        const metadata = await page.getAnnotations({ intent: 'display' });
        expect(metadata[0]).toMatchObject({
          hasAppearance: true,
          annotationFlags: 4,
          rect: [60, 500, 260, 580],
        });
        const operators = await page.getOperatorList({ intent: 'display', annotationMode: 1 });
        const { OPS } = await import('pdfjs-dist/legacy/build/pdf.mjs');
        expect(operators.fnArray).toContain(OPS.beginAnnotation);
        expect(operators.fnArray).toContain(OPS.endAnnotation);
        expect(operators.fnArray).toContain(OPS.showText);
        page.cleanup();
      } finally {
        await task.destroy();
        await env.destroy();
      }
    },
  );
  it('classifies original visible FreeText and Stamp pages without inventing extracted money rows', async () => {
    const document = await extract('only');
    expect(document.lines.map((line) => [line.page, line.text])).toEqual([
      [1, 'Opening balance 1000.00'],
      [1, '2026-01-01 Purchase -10.00 990.00'],
      [1, 'Closing balance 990.00'],
    ]);
    expect(document.pages.map((page) => page.visual)).toEqual([
      'text',
      'nontext',
      'nontext',
      'blank',
    ]);
  });
  it('does not report reconciled or export before appearance-only pages are explicitly reviewed', async () => {
    const document = await extract('only');
    const value = params(document);
    expect(reviewBankStatement(document, value)).toMatchObject({
      status: 'pending-review',
      delta: '0.00',
      pending: 2,
    });
    expect(() => exportBankStatement(document, value)).toThrow(/decision|review/i);
  });
  it('retains included nontext page provenance and exceptions in full reopened CSV', async () => {
    const document = await extract('only');
    const value = params(document);
    value.pageDecisions = [2, 3].map((page) => ({
      page,
      decision: 'include',
      reason: `Reviewed original visible appearance on page ${page}; not converted to financial rows.`,
    }));
    expect(reviewBankStatement(document, value)).toMatchObject({
      status: 'reviewed-with-exceptions',
      acceptedSum: '-10.00',
      delta: '0.00',
    });
    const rows = csvRows(document, value);
    expect(rows).toHaveLength(5);
    const pageRows = rows.filter((row) => row.status === 'page-included');
    expect(pageRows.map((row) => [row.sourcePage, row.pageVisual, row.pageDecision])).toEqual([
      ['2', 'nontext', 'include'],
      ['3', 'nontext', 'include'],
    ]);
    expect(pageRows.every((row) => !!row.pageReviewReason && row.amount === '')).toBe(true);
    expect(rows.some((row) => row.sourcePage === '4')).toBe(false);
  });
  it('classifies selectable text plus actual Stamp appearance as mixed', async () => {
    const document = await extract('mixed');
    expect(document.pages[0]!.visual).toBe('mixed');
    const value = params(document);
    expect(reviewBankStatement(document, value).status).toBe('pending-review');
    expect(() => exportBankStatement(document, value)).toThrow(/decision|review/i);
    value.pageDecisions = [
      {
        page: 1,
        decision: 'include',
        reason: 'Inspected the original image stamp and all extracted financial movements.',
      },
    ];
    expect(reviewBankStatement(document, value)).toMatchObject({
      status: 'reconciled',
      delta: '0.00',
    });
    expect(
      csvRows(document, value).every(
        (row) =>
          row.pageVisual === 'mixed' && row.pageDecision === 'include' && !!row.pageReviewReason,
      ),
    ).toBe(true);
  });
  it('detects an appearance containing only text operators, without relying on a path or image', async () => {
    const document = await extract('text-only');
    expect(document.pages.map((page) => page.visual)).toEqual(['text', 'nontext']);
    expect(document.lines).toHaveLength(3);
    expect(reviewBankStatement(document, params(document)).status).toBe('pending-review');
  });
  it.each(['hidden', 'noview', 'invisible', 'outside', 'zero'] as const)(
    'does not invent visible-page review for the original %s control',
    async (kind) => {
      const document = await extract(kind);
      expect(document.pages.map((page) => page.visual)).toEqual(['text', 'blank']);
      expect(reviewBankStatement(document, params(document)).status).toBe('reconciled');
    },
  );
  it('keeps annotation links/actions and resources inert and cleans the actual environment', async () => {
    const input = await originalAnnotationPdf('only');
    const env = await createBankPdfEnvironment();
    const destroy = env.destroy.bind(env);
    let destroyed = 0;
    env.destroy = () => {
      destroyed++;
      return destroy();
    };
    const saved = globalThis.fetch;
    let network = 0;
    globalThis.fetch = () => {
      network++;
      return Promise.reject(new Error('Unexpected annotation network'));
    };
    try {
      const document = await extractBankStatement(input, 2, signal(), env);
      expect(document.lines).toHaveLength(3);
      expect(network).toBe(0);
      expect(destroyed).toBe(1);
      expect(Reflect.get(globalThis, '__file4AnnotationAction')).toBeUndefined();
    } finally {
      globalThis.fetch = saved;
    }
  });
});

describe('FILE4 original manifold component endpoint regressions', () => {
  const geometry = () => asciiStl([...box(0, 0, 0, 10, 10, 2), ...box(0, 0, 8, 10, 10, 10)]);
  it('records both midpoint planes at a component top/gap as empty in the same full artifact', () => {
    const result = buildStlContours(geometry(), { layerHeightMm: 4 }, signal());
    expect(result.report).toMatchObject({ layerCount: 2, partialTopMm: 2 });
    expect(
      result.report.layers.map((layer) => [
        layer.zMm,
        layer.empty,
        layer.netAreaMm2,
        layer.perimeterMm,
        layer.contours,
      ]),
    ).toEqual([
      [2, true, 0, 0, []],
      [6, true, 0, 0, []],
    ]);
    expect(result.gcode).toContain('G0 Z2\n; empty layer\n');
    expect(result.gcode).toContain('G0 Z6\n; empty layer\n');
    expect(result.gcode).not.toMatch(/^G[01] X/m);
    expect(validateStlJobResult(result, { layerHeightMm: 4 })).toBe(result);
  });
  it('retains independent material and genuine-gap oracles for the identical manifold geometry', () => {
    const result = buildStlContours(geometry(), { layerHeightMm: 2 }, signal());
    expect(
      result.report.layers.map((layer) => [
        layer.zMm,
        layer.empty,
        layer.netAreaMm2,
        layer.perimeterMm,
      ]),
    ).toEqual([
      [1, false, 100, 40],
      [3, true, 0, 0],
      [5, true, 0, 0],
      [7, true, 0, 0],
      [9, false, 100, 40],
    ]);
  });
  it('keeps the lower endpoint inclusive when a component has material above the plane', () => {
    const input = asciiStl([
      ...box(0, 0, 0, 10, 10, 1),
      ...box(0, 0, 2, 10, 10, 4),
      ...box(0, 0, 8, 10, 10, 10),
    ]);
    const result = buildStlContours(input, { layerHeightMm: 4 }, signal());
    expect(
      result.report.layers.map((layer) => [
        layer.zMm,
        layer.empty,
        layer.netAreaMm2,
        layer.perimeterMm,
      ]),
    ).toEqual([
      [2, false, 100, 40],
      [6, true, 0, 0],
    ]);
  });
});

describe('FILE4 settled original projected annotation controls', () => {
  async function original(kind: ProjectedAnnotationKind) {
    return extractBankStatement(
      await originalProjectedAnnotationPdf(kind),
      2,
      signal(),
      await createBankPdfEnvironment(),
    );
  }
  it.each([
    ['freetext-only', ['unknown']],
    ['text-freetext', ['unknown']],
    ['state-freetext', ['unknown']],
    ['noap-widget', ['unknown']],
    ['text-widget', ['unknown']],
    ['off-empty-ap', ['unknown']],
    ['off-no-ap', ['unknown']],
    ['generated-widget', ['nontext']],
    ['empty-widget', ['text']],
    ['empty-freetext', ['text']],
    ['empty-state', ['text']],
    ['clip-state', ['text']],
    ['link-only', ['blank']],
    ['text-link', ['text']],
    ['shared-link', ['text', 'blank']],
    ['listbox', ['text']],
  ] as const)('pins %s to exact settled classification %j', async (kind, visuals) => {
    const document = await original(kind);
    expect(document.pages.map((page) => page.visual)).toEqual(visuals);
    expect(document.lines.some((line) => line.text.includes('-25.00'))).toBe(false);
    if (!['freetext-only', 'noap-widget', 'generated-widget', 'link-only'].includes(kind))
      expect(document.lines).toHaveLength(3);
  });
  it.each(['text-freetext', 'text-widget', 'off-empty-ap', 'off-no-ap'] as const)(
    'keeps %s permanent exceptions and full original rows after reasoned include',
    async (kind) => {
      const document = await original(kind);
      const value = params(document);
      expect(reviewBankStatement(document, value).status).toBe('pending-review');
      expect(() => exportBankStatement(document, value)).toThrow(/review|decision/i);
      value.pageDecisions = [
        {
          page: 1,
          decision: 'include',
          reason: 'Reviewed the original PDF including available annotation/form presence.',
        },
      ];
      const review = reviewBankStatement(document, value);
      expect(review).toMatchObject({
        status: 'reviewed-with-exceptions',
        acceptedSum: '-10.00',
        delta: '0.00',
      });
      const rows = csvRows(document, value);
      expect(rows).toHaveLength(3);
      expect(
        rows.every(
          (row) =>
            row.pageVisual === 'unknown' &&
            row.pageDecision === 'include' &&
            !!row.pageReviewReason &&
            row.overallStatus === 'reviewed-with-exceptions',
        ),
      ).toBe(true);
      expect(rows.filter((row) => row.role === 'transaction').map((row) => row.amount)).toEqual([
        '-10.00',
      ]);
    },
  );
  it.each([
    'empty-widget',
    'empty-freetext',
    'empty-state',
    'clip-state',
    'text-link',
    'shared-link',
    'listbox',
  ] as const)(
    'retains actual original text CSV for %s; listbox options are explicitly outside projection',
    async (kind) => {
      const document = await original(kind);
      expect(reviewBankStatement(document, params(document))).toMatchObject({
        status: 'reconciled',
        delta: '0.00',
      });
      const rows = csvRows(document, params(document));
      expect(rows).toHaveLength(3);
      expect(rows.filter((row) => row.role === 'transaction').map((row) => row.amount)).toEqual([
        '-10.00',
      ]);
    },
  );
  it('observes generated-widget exact showText, empty-widget exact state-only output, and available no-AP FreeText', async () => {
    const { OPS } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    for (const kind of ['generated-widget', 'empty-widget', 'text-freetext', 'listbox'] as const) {
      const env = await createBankPdfEnvironment();
      const task = env.open(await originalProjectedAnnotationPdf(kind));
      try {
        const pdf = await task.promise;
        const page = await pdf.getPage(1);
        const metadata = await page.getAnnotations({ intent: 'display' });
        const ops = await page.getOperatorList({ intent: 'display', annotationMode: 1 });
        if (kind === 'generated-widget') {
          expect(metadata[0]).toMatchObject({
            hasAppearance: true,
            fieldValue: 'Transaction -25.00',
          });
          expect(ops.fnArray.filter((op) => op === OPS.beginAnnotation)).toHaveLength(1);
          expect(ops.fnArray).toContain(OPS.showText);
        } else if (kind === 'empty-widget') {
          expect(metadata[0]).toMatchObject({ fieldValue: '', hasAppearance: true });
          const start = ops.fnArray.indexOf(OPS.beginAnnotation);
          const end = ops.fnArray.indexOf(OPS.endAnnotation);
          expect(ops.fnArray.slice(start + 1, end)).toEqual([
            OPS.beginMarkedContent,
            OPS.save,
            OPS.restore,
            OPS.endMarkedContent,
          ]);
        } else {
          expect(ops.fnArray).not.toContain(OPS.beginAnnotation);
          if (kind === 'text-freetext')
            expect(metadata[0]).toMatchObject({
              hasAppearance: false,
              contentsObj: { str: 'Transaction -25.00' },
              textContent: ['Transaction -25.00'],
            });
          else
            expect(metadata[0]).toMatchObject({
              hasAppearance: false,
              fieldValue: [],
              options: [
                { displayValue: 'Transaction -25.00', exportValue: 'Transaction -25.00' },
                { displayValue: 'Original option B', exportValue: 'Original option B' },
              ],
            });
        }
        page.cleanup();
      } finally {
        await task.destroy();
        await env.destroy();
      }
    }
  });
});

// Controlled public-provider seam is restricted to post-SDK malformed shapes and classifier limits.
// Positive real-PDF extraction/worker controls above use the actual pinned environment.
interface ProviderPage {
  metadata: unknown;
  fnArray?: unknown;
  argsArray?: unknown;
  annotationError?: Error;
  operatorError?: Error;
}
function provider(pages: ProviderPage[]) {
  const calls = {
    annotations: [] as unknown[],
    operators: [] as unknown[],
    cleanup: 0,
    destroy: 0,
    taskDestroy: 0,
  };
  const env = {
    paintOps: [20, 22, 91],
    imageOps: [85],
    open() {
      return {
        promise: Promise.resolve({
          numPages: pages.length,
          getPage(number: number) {
            const value = pages[number - 1]!;
            return Promise.resolve({
              rotate: 0,
              view: [0, 0, 600, 800],
              getViewport() {
                return { width: 600, height: 800 };
              },
              getTextContent() {
                return Promise.resolve({ items: [] });
              },
              getAnnotations(options: unknown) {
                calls.annotations.push(options);
                if (value.annotationError) return Promise.reject(value.annotationError);
                return Promise.resolve(value.metadata);
              },
              getOperatorList(options: unknown) {
                calls.operators.push(options);
                if (value.operatorError) return Promise.reject(value.operatorError);
                return Promise.resolve({
                  fnArray: value.fnArray ?? [],
                  argsArray: value.argsArray ?? [],
                });
              },
              cleanup() {
                calls.cleanup++;
              },
            });
          },
          async cleanup() {},
        }),
        destroy() {
          calls.taskDestroy++;
          return Promise.resolve();
        },
      };
    },
    destroy() {
      calls.destroy++;
    },
  } as unknown as BankPdfEnvironment;
  return { env, calls };
}
const projected = (overrides: Record<string, unknown> = {}) => ({
  id: 'original-id',
  annotationFlags: 4,
  rect: [60, 500, 260, 580],
  hasAppearance: false,
  subtype: 'Widget',
  ...overrides,
});
const group = (operations: number[] = [10, 11], id = 'original-id') => ({
  fnArray: [80, ...operations, 81],
  argsArray: [[id], ...operations.map(() => undefined), undefined],
});
async function controlled(pages: ProviderPage[]) {
  const fixture = provider(pages);
  const document = await extractBankStatement(
    new TextEncoder().encode('%PDF-original-provider'),
    2,
    signal(),
    fixture.env,
  );
  expect(fixture.calls.destroy).toBe(1);
  expect(fixture.calls.taskDestroy).toBe(1);
  expect(fixture.calls.cleanup).toBe(pages.length);
  return document;
}
async function hardRefusal(pages: ProviderPage[]) {
  const fixture = provider(pages);
  await expect(
    extractBankStatement(
      new TextEncoder().encode('%PDF-original-provider'),
      2,
      signal(),
      fixture.env,
    ),
  ).rejects.toThrow(/annotation|metadata|content|budget|limit|byte|field/i);
  expect(fixture.calls.destroy).toBe(1);
  expect(fixture.calls.taskDestroy).toBe(1);
}

describe('FILE4 bounded post-SDK projection and correlation contracts', () => {
  it('performs exactly one display metadata and ENABLE call on the normal successful path', async () => {
    const fixture = provider([{ metadata: [] }]);
    const document = await extractBankStatement(
      new TextEncoder().encode('%PDF-original-provider'),
      2,
      signal(),
      fixture.env,
    );
    expect(document.pages[0]!.visual).toBe('blank');
    expect(fixture.calls.annotations).toEqual([{ intent: 'display' }]);
    expect(fixture.calls.operators).toEqual([{ intent: 'display', annotationMode: 1 }]);
    expect(fixture.calls.destroy).toBe(1);
  });
  it('short-circuits SDK metadata operational rejection as unknown with no operator call', async () => {
    const fixture = provider([
      { metadata: [], annotationError: new Error('Original SDK operational refusal') },
    ]);
    const document = await extractBankStatement(
      new TextEncoder().encode('%PDF-original-provider'),
      2,
      signal(),
      fixture.env,
    );
    expect(document.pages[0]!.visual).toBe('unknown');
    expect(fixture.calls.annotations).toEqual([{ intent: 'display' }]);
    expect(fixture.calls.operators).toEqual([]);
    expect(fixture.calls.cleanup).toBe(1);
    expect(fixture.calls.destroy).toBe(1);
  });
  it('retains operational operator refusal as unknown without retry', async () => {
    const document = await controlled([
      { metadata: [], operatorError: new Error('Original operator refusal') },
    ]);
    expect(document.pages[0]!.visual).toBe('unknown');
  });
  it.each([
    ['empty no-AP Widget', projected({ fieldValue: '' }), {}, 'blank'],
    [
      'empty no-AP FreeText',
      projected({ subtype: 'FreeText', contentsObj: { str: '' }, textContent: [] }),
      {},
      'blank',
    ],
    ['data-only Link', projected({ subtype: 'Link' }), {}, 'blank'],
    ['declared missing group', projected({ hasAppearance: true }), {}, 'unknown'],
    ['available Widget', projected({ fieldValue: 'Off' }), {}, 'unknown'],
    [
      'available FreeText Contents',
      projected({ subtype: 'FreeText', contentsObj: { str: 'Transaction -25.00' } }),
      {},
      'unknown',
    ],
    [
      'available FreeText derived content',
      projected({ subtype: 'FreeText', textContent: ['Transaction -25.00'] }),
      {},
      'unknown',
    ],
    [
      'empty state-only Widget',
      projected({ hasAppearance: true, fieldValue: '' }),
      group(),
      'blank',
    ],
    [
      'nonempty state-only Widget',
      projected({ hasAppearance: true, fieldValue: 'Off' }),
      group(),
      'unknown',
    ],
    [
      'empty state-only FreeText',
      projected({
        subtype: 'FreeText',
        hasAppearance: true,
        contentsObj: { str: '' },
        textContent: [''],
      }),
      group(),
      'blank',
    ],
    [
      'nonempty state-only FreeText',
      projected({ subtype: 'FreeText', hasAppearance: true, textContent: ['value'] }),
      group(),
      'unknown',
    ],
    ['annotation showText', projected({ hasAppearance: true }), group([44]), 'nontext'],
    ['unsupported annotation op', projected({ hasAppearance: true }), group([63]), 'unknown'],
  ] as const)(
    '%s follows exact drawing/presence classification',
    async (_name, annotation, operators, expected) => {
      expect((await controlled([{ metadata: [annotation], ...operators }])).pages[0]!.visual).toBe(
        expected,
      );
    },
  );
  it.each([1, 2, 32])('excludes flag %s while consuming its drawing group', async (flag) => {
    const document = await controlled([
      {
        metadata: [projected({ annotationFlags: flag, hasAppearance: true, fieldValue: 'value' })],
        ...group([44]),
      },
    ]);
    expect(document.pages[0]!.visual).toBe('blank');
  });
  it.each(
    [
      [700, 500, 900, 580],
      [60, 500, 60, 580],
    ].map((rect) => [rect] as const),
  )('excludes rectangle %j while consuming its drawing group', async (rect) => {
    expect(
      (
        await controlled([
          {
            metadata: [projected({ rect, hasAppearance: true, fieldValue: 'value' })],
            ...group([44]),
          },
        ])
      ).pages[0]!.visual,
    ).toBe('blank');
  });
  it('matches ids per page; the same id on separate pages is permitted', async () => {
    expect(
      (
        await controlled([
          { metadata: [projected({ subtype: 'Link' })] },
          { metadata: [projected({ subtype: 'Link' })] },
        ])
      ).pages.map((page) => page.visual),
    ).toEqual(['blank', 'blank']);
  });
  it('hard-refuses duplicate metadata ids within a page', async () =>
    hardRefusal([{ metadata: [projected(), projected()] }]));
  it.each([
    { fnArray: [80, 11, 81], argsArray: [['missing'], undefined, undefined] },
    {
      fnArray: [80, 80, 81, 81],
      argsArray: [['original-id'], ['original-id'], undefined, undefined],
    },
    {
      fnArray: [80, 81, 80, 81],
      argsArray: [['original-id'], undefined, ['original-id'], undefined],
    },
    { fnArray: [80, 10], argsArray: [['original-id'], undefined] },
    { fnArray: [81], argsArray: [undefined] },
    { fnArray: [80, 81], argsArray: [[], undefined] },
    { fnArray: [80, 91, 81], argsArray: [['original-id'], [999], undefined] },
    { fnArray: [80, 91, 81], argsArray: [['original-id'], undefined, undefined] },
    { fnArray: [80, NaN, 81], argsArray: [['original-id'], undefined, undefined] },
    { fnArray: [80, 81], argsArray: [['original-id']] },
  ])('marks malformed/unmatched operator structure unknown: %j', async (operators) => {
    expect(
      (await controlled([{ metadata: [projected({ hasAppearance: true })], ...operators }]))
        .pages[0]!.visual,
    ).toBe('unknown');
  });
  it('treats annotation constructPath/endPath as state, preserving depth-zero existing paint behavior', async () => {
    const state = { fnArray: [80, 91, 81], argsArray: [['original-id'], [28, [], []], undefined] };
    expect(
      (await controlled([{ metadata: [projected({ hasAppearance: true })], ...state }])).pages[0]!
        .visual,
    ).toBe('blank');
    expect(
      (await controlled([{ metadata: [], fnArray: [91], argsArray: [[28, [], []]] }])).pages[0]!
        .visual,
    ).toBe('nontext');
    expect(
      (await controlled([{ metadata: [], fnArray: [63], argsArray: [undefined] }])).pages[0]!
        .visual,
    ).toBe('blank');
  });
  it.each([
    null,
    {},
    [null],
    [projected({ id: '' })],
    [projected({ annotationFlags: NaN })],
    [projected({ rect: [0, 0, Infinity, 1] })],
    [projected({ hasAppearance: 1 })],
    [projected({ subtype: 1 })],
    [projected({ fieldValue: 0 })],
    [projected({ fieldValue: ['value', 1] })],
    [projected({ fieldValue: [['value']] })],
    [projected({ subtype: 'FreeText', contentsObj: { str: 1 } })],
    [projected({ subtype: 'FreeText', contentsObj: [] })],
    [projected({ subtype: 'FreeText', textContent: 'value' })],
    [projected({ subtype: 'FreeText', textContent: [null] })],
  ])('hard-refuses malformed metadata shape %j', async (metadata) => hardRefusal([{ metadata }]));
  it('rejects sparse content arrays and accessors without invoking them', async () => {
    const sparse = new Array<string>(2);
    sparse[1] = 'value';
    await hardRefusal([{ metadata: [projected({ fieldValue: sparse })] }]);
    let reads = 0;
    const annotation = projected();
    Object.defineProperty(annotation, 'fieldValue', {
      get() {
        reads++;
        return 'value';
      },
      enumerable: true,
    });
    await hardRefusal([{ metadata: [annotation] }]);
    expect(reads).toBe(0);
    const content = Object.create({ str: 'inherited' }) as Record<string, unknown>;
    await hardRefusal([{ metadata: [projected({ subtype: 'FreeText', contentsObj: content })] }]);
  });
  it('rejects a FreeText str accessor, inherited Widget value, sparse metadata, and oversized Widget array', async () => {
    let reads = 0;
    const content = {};
    Object.defineProperty(content, 'str', {
      get() {
        reads++;
        return 'value';
      },
      enumerable: true,
    });
    await hardRefusal([{ metadata: [projected({ subtype: 'FreeText', contentsObj: content })] }]);
    expect(reads).toBe(0);
    const inherited = Object.assign(
      Object.create({ fieldValue: 'value' }) as Record<string, unknown>,
      projected(),
    );
    await hardRefusal([{ metadata: [inherited] }]);
    await hardRefusal([{ metadata: new Array(1) }]);
    await hardRefusal([
      { metadata: [projected({ fieldValue: Array.from({ length: 1001 }, () => '') })] },
    ]);
  });
  it('retains the hard 100000-operator cap and refuses sparse outer arrays as unknown', async () => {
    await hardRefusal([
      {
        metadata: [],
        fnArray: Array.from({ length: 100001 }, () => 10),
        argsArray: Array.from({ length: 100001 }, () => undefined),
      },
    ]);
    const sparse = new Array<number>(1);
    expect(
      (await controlled([{ metadata: [], fnArray: sparse, argsArray: [undefined] }])).pages[0]!
        .visual,
    ).toBe('unknown');
  });
  it('accepts 1000 dense content strings but refuses 1001 even on a hidden record', async () => {
    const valid = projected({
      subtype: 'FreeText',
      annotationFlags: 2,
      textContent: Array.from({ length: 1000 }, () => ''),
    });
    expect((await controlled([{ metadata: [valid] }])).pages[0]!.visual).toBe('blank');
    await hardRefusal([
      {
        metadata: [
          projected({
            subtype: 'FreeText',
            annotationFlags: 2,
            textContent: Array.from({ length: 1001 }, () => ''),
          }),
        ],
      },
    ]);
  });
  it('enforces per-page and document metadata count limits before duplicate filtering', async () => {
    const thousand = () =>
      Array.from({ length: 1000 }, (_, i) => projected({ id: `id-${i}`, subtype: 'Link' }));
    expect(
      (await controlled(Array.from({ length: 10 }, () => ({ metadata: thousand() })))).pages,
    ).toHaveLength(10);
    await hardRefusal([
      {
        metadata: Array.from({ length: 1001 }, (_, i) =>
          projected({ id: `id-${i}`, subtype: 'Link' }),
        ),
      },
    ]);
    await hardRefusal(Array.from({ length: 11 }, () => ({ metadata: thousand() })));
  });
  it('charges duplicate FreeText representations to shared 1 MiB record boundary, including hidden/outcrop', async () => {
    const half = 'a'.repeat(512 * 1024);
    const valid = projected({
      subtype: 'FreeText',
      contentsObj: { str: half },
      textContent: [half],
    });
    expect((await controlled([{ metadata: [valid] }])).pages[0]!.visual).toBe('unknown');
    for (const excluded of [{ annotationFlags: 2 }, { rect: [700, 500, 900, 580] }])
      await hardRefusal([
        { metadata: [projected({ ...valid, ...excluded, textContent: [half + 'a'] })] },
      ]);
  });
  it('counts actual UTF8 and replacement surrogates, not just code units', async () => {
    const boundary = 'é'.repeat(512 * 1024);
    expect(
      (await controlled([{ metadata: [projected({ fieldValue: boundary })] }])).pages[0]!.visual,
    ).toBe('unknown');
    await hardRefusal([{ metadata: [projected({ fieldValue: boundary + 'a' })] }]);
    const replacement = '\ud800'.repeat(349525);
    expect(
      (await controlled([{ metadata: [projected({ fieldValue: replacement + 'a' })] }])).pages[0]!
        .visual,
    ).toBe('unknown');
    await hardRefusal([{ metadata: [projected({ fieldValue: replacement + 'aa' })] }]);
  });
  it('shares 10 MiB document presence budget across Widget and FreeText records and pages', async () => {
    const megabyte = 'a'.repeat(1024 * 1024),
      half = 'a'.repeat(512 * 1024);
    const pages = Array.from({ length: 10 }, (_, i) => ({
      metadata: [
        i % 2
          ? projected({ subtype: 'FreeText', contentsObj: { str: half }, textContent: [half] })
          : projected({ fieldValue: megabyte }),
      ],
    }));
    expect((await controlled(pages)).pages.map((page) => page.visual)).toEqual(
      Array.from({ length: 10 }, () => 'unknown'),
    );
    await hardRefusal([
      ...pages,
      { metadata: [projected({ annotationFlags: 2, fieldValue: 'a' })] },
    ]);
  });
  it('does not inspect omitted listbox options, RC or Stamp content as a projected guarantee', async () => {
    for (const annotation of [
      projected({ fieldValue: [], options: [{ displayValue: 'Transaction -25.00' }] }),
      projected({
        subtype: 'FreeText',
        contentsObj: { str: '' },
        textContent: [],
        richText: 'Transaction -25.00',
      }),
      projected({ subtype: 'Stamp', contentsObj: { str: 'Transaction -25.00' } }),
    ]) {
      expect((await controlled([{ metadata: [annotation] }])).pages[0]!.visual).toBe('blank');
    }
  });
});
