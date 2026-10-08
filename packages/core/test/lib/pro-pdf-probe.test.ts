import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolRunContext } from '../../src/types.js';
import { chatLongPdfPro } from '../../src/tools/chat-long-pdf-pro/index.js';
import { pdfQandA } from '../../src/tools/pdf-q-and-a/index.js';
import { pdfSummarize } from '../../src/tools/pdf-summarize/index.js';
import { translateDocumentPro, defaultTranslateDocumentProParams } from '../../src/tools/translate-document-pro/index.js';

const state = vi.hoisted(() => ({ pages: 1, fail: false,
  destroy: vi.fn<() => Promise<void>>(), extract: vi.fn<() => Promise<Blob>>() }));
vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
  GlobalWorkerOptions: {},
  getDocument: () => ({
    get promise() { return state.fail ? Promise.reject(new Error('PDF load failed')) : Promise.resolve({ numPages: state.pages }); },
    destroy: state.destroy,
  }),
}));
vi.mock('../../src/tools/pdf-to-text/index.js', () => ({ pdfToText: { run: state.extract } }));
vi.mock('../../src/lib/pro-runner.js', () => ({ runPro: () => Promise.resolve({ answer: 'answer', summary: 'summary', text: 'translated' }) }));

const context: ToolRunContext = { onProgress: () => {}, signal: new AbortController().signal,
  cache: new Map(), executionId: 'pdf-probe-cleanup' };
const input = new File(['test'], 'input.pdf', { type: 'application/pdf' });
const cases = [
  { name: 'chat-long-pdf-pro', run: () => chatLongPdfPro.run([input], { question: 'Question?' }, context) },
  { name: 'pdf-q-and-a', run: () => pdfQandA.run([input], { question: 'Question?' }, context) },
  { name: 'pdf-summarize', run: () => pdfSummarize.run([input], {}, context) },
  { name: 'translate-document-pro', run: () => translateDocumentPro.run([input], defaultTranslateDocumentProParams, context) },
];

beforeEach(() => {
  state.pages = 1;
  state.fail = false;
  state.destroy.mockReset().mockResolvedValue(undefined);
  state.extract.mockReset().mockResolvedValue(new Blob(['Document text']));
});

describe.each(cases)('$name PDF loading-task cleanup', ({ run }) => {
  it('destroys the loading task before text extraction', async () => {
    state.extract.mockImplementation(() => {
      expect(state.destroy).toHaveBeenCalledOnce();
      return Promise.resolve(new Blob(['Document text']));
    });
    await run();
    expect(state.destroy).toHaveBeenCalledOnce();
  });
  it('destroys the loading task when the page budget rejects input', async () => {
    state.pages = 501;
    await expect(run()).rejects.toThrow();
    expect(state.destroy).toHaveBeenCalledOnce();
    expect(state.extract).not.toHaveBeenCalled();
  });
  it('destroys the loading task when document loading fails', async () => {
    state.fail = true;
    await expect(run()).rejects.toThrow('PDF load failed');
    expect(state.destroy).toHaveBeenCalledOnce();
    expect(state.extract).not.toHaveBeenCalled();
  });
});
