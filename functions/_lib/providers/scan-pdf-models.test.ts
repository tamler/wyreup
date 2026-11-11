import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../env';
import {
  buildScanPdfRequest,
  prepareScanPdfQandA,
  readScanPdfInput,
  scanPdfWorstCaseUsd,
  SCAN_PDF_MAX_IMAGE_BYTES,
  SCAN_PDF_MAX_OUTPUT_TOKENS,
  SCAN_PDF_MAX_PAGES,
  SCAN_PDF_MODEL,
} from './scan-pdf-models';

const JPEG =
  'data:image/jpeg;base64,' +
  btoa(String.fromCharCode(255, 216, 255, 224, 0, 16, 74, 70, 73, 70, 0, 1));
const PNG =
  'data:image/png;base64,' +
  btoa(String.fromCharCode(137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13));

function page(n: number, image = JPEG) {
  return { page: n, image };
}

const aiRun = vi.fn();

function mockEnv(result: unknown): Env {
  aiRun.mockReset().mockResolvedValue(result);
  return { AI: { run: aiRun } } as unknown as Env;
}

describe('readScanPdfInput', () => {
  it('accepts a question and labelled JPEG or PNG pages', () => {
    const input = readScanPdfInput({ question: ' When? ', pages: [page(1), page(3, PNG)] });
    expect(input.question).toBe('When?');
    expect(input.pages.map((p) => p.page)).toEqual([1, 3]);
  });

  it('rejects a missing or oversized question', () => {
    expect(() => readScanPdfInput({ pages: [page(1)] })).toThrow(/question/);
    expect(() => readScanPdfInput({ question: 'x'.repeat(2_001), pages: [page(1)] })).toThrow(
      /2000 characters/,
    );
  });

  it(`rejects zero pages and more than ${SCAN_PDF_MAX_PAGES}`, () => {
    expect(() => readScanPdfInput({ question: 'q', pages: [] })).toThrow(/pages/);
    const tooMany = Array.from({ length: SCAN_PDF_MAX_PAGES + 1 }, (_, i) => page(i + 1));
    expect(() => readScanPdfInput({ question: 'q', pages: tooMany })).toThrow(/At most 10/);
  });

  it('rejects duplicate pages, bad page numbers and non-image data', () => {
    expect(() => readScanPdfInput({ question: 'q', pages: [page(2), page(2)] })).toThrow(/twice/);
    expect(() => readScanPdfInput({ question: 'q', pages: [page(0)] })).toThrow(/page number/);
    expect(() =>
      readScanPdfInput({
        question: 'q',
        pages: [{ page: 1, image: 'data:text/plain;base64,aGk=' }],
      }),
    ).toThrow(/PNG, JPEG or WebP/);
    expect(() =>
      readScanPdfInput({ question: 'q', pages: [{ page: 1, image: 'https://example.com/a.jpg' }] }),
    ).toThrow(/data URL/);
  });

  it('rejects bytes that do not match the declared format', () => {
    const lie = 'data:image/png;base64,' + JPEG.split(',')[1];
    expect(() => readScanPdfInput({ question: 'q', pages: [page(1, lie)] })).toThrow(
      /do not match/,
    );
  });

  it('rejects a page image over the size cap', () => {
    const big =
      'data:image/jpeg;base64,' +
      '/9j/'.padEnd(Math.ceil(SCAN_PDF_MAX_IMAGE_BYTES / 3) * 4 + 4, 'A');
    expect(() => readScanPdfInput({ question: 'q', pages: [page(1, big)] })).toThrow(/under 2 MB/);
  });
});

describe('buildScanPdfRequest', () => {
  it('labels each page, caps output, and makes one request', () => {
    const req = buildScanPdfRequest(readScanPdfInput({ question: 'Total?', pages: [page(4)] }));
    expect(req.max_completion_tokens).toBe(SCAN_PDF_MAX_OUTPUT_TOKENS);
    const user = req.messages[1].content;
    expect(user).toEqual([
      { type: 'text', text: 'Page 4:' },
      { type: 'image_url', image_url: { url: JPEG } },
      { type: 'text', text: 'Question: Total?' },
    ]);
  });
});

describe('prepareScanPdfQandA', () => {
  it('validates before dispatch and calls the model once', async () => {
    const env = mockEnv({ choices: [{ message: { content: ' 30 days (page 2) ' } }] });
    const run = prepareScanPdfQandA({ question: 'Notice?', pages: [page(1), page(2)] }, env);
    expect(aiRun).not.toHaveBeenCalled();
    await expect(run()).resolves.toEqual({ answer: '30 days (page 2)', pages: [1, 2] });
    expect(aiRun).toHaveBeenCalledTimes(1);
    expect(aiRun.mock.calls[0]?.[0]).toBe(SCAN_PDF_MODEL);
  });

  it('accepts a legacy response field', async () => {
    const env = mockEnv({ response: 'yes' });
    await expect(
      prepareScanPdfQandA({ question: 'q', pages: [page(1)] }, env)(),
    ).resolves.toMatchObject({
      answer: 'yes',
    });
  });

  it('throws on an empty answer so the run is refunded', async () => {
    const env = mockEnv({ choices: [{ message: { content: '  ' } }] });
    await expect(prepareScanPdfQandA({ question: 'q', pages: [page(1)] }, env)()).rejects.toThrow(
      /no answer/,
    );
  });

  it('is the runner registered for pdf-scan-q-and-a-pro', async () => {
    const { prepareProRun } = await import('../runners');
    const env = mockEnv({ choices: [{ message: { content: 'ok' } }] });
    await expect(
      prepareProRun('pdf-scan-q-and-a-pro', { question: 'q', pages: [page(1)] }, env)(),
    ).resolves.toEqual({ answer: 'ok', pages: [1] });
  });

  it('does not call the model on invalid input', () => {
    const env = mockEnv({});
    expect(() => prepareScanPdfQandA({ question: 'q', pages: [] }, env)).toThrow();
    expect(aiRun).not.toHaveBeenCalled();
  });
});

describe('scanPdfWorstCaseUsd', () => {
  it('bounds 10 pages at 2,048 tokens each plus text and 2,048 output tokens', () => {
    // 10 * 2048 image tokens + ceil(chars / 3) text + 500 template, at $0.10/M in,
    // and 2048 output tokens at $0.30/M.
    const usd = scanPdfWorstCaseUsd();
    expect(usd).toBeGreaterThan((10 * 2048 * 0.1 + 2048 * 0.3) / 1e6);
    expect(usd).toBeLessThan(0.003);
  });
});
