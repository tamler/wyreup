import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolRunContext } from '../src/types.js';
import type { TextStatsByParagraphResult } from '../src/tools/text-stats-by-paragraph/index.js';

// Controlled method values are UNIT field-mapping witnesses, not real score oracles.
const scoreMethods = [
  'fleschReadingEase', 'fleschKincaidGrade', 'colemanLiauIndex', 'smogIndex',
  'automatedReadabilityIndex', 'daleChallReadabilityScore', 'gunningFog', 'textStandard',
] as const;

function scorer() {
  return {
    fleschReadingEase: vi.fn((_text: string) => 11.24),
    fleschKincaidGrade: vi.fn((_text: string) => 22.36),
    colemanLiauIndex: vi.fn((_text: string) => 33.44),
    smogIndex: vi.fn((_text: string) => 44.56),
    automatedReadabilityIndex: vi.fn((_text: string) => 55.64),
    daleChallReadabilityScore: vi.fn((_text: string) => 66.76),
    gunningFog: vi.fn((_text: string) => 77.84),
    textStandard: vi.fn((_text: string) => 'UNIT_GRADE_SENTINEL'),
  };
}

function context(signal = new AbortController().signal, onProgress: ToolRunContext['onProgress'] = () => {}): ToolRunContext {
  return { onProgress, signal, cache: new Map(), executionId: 'readability-lazy-import-unit' };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function observe<T>(promise: Promise<T>) {
  return promise.then(
    (value) => ({ status: 'fulfilled' as const, value }),
    (reason: unknown) => ({ status: 'rejected' as const, reason }),
  );
}

describe('readability lazy imports — controlled UNIT witnesses', () => {
  const releases: Array<() => void> = [];
  const drains: Array<Promise<unknown>> = [];

  afterEach(async () => {
    try {
      for (const release of releases.splice(0)) release();
      await Promise.all(drains.splice(0));
    } finally {
      vi.doUnmock('text-readability');
      vi.resetModules();
      vi.restoreAllMocks();
    }
  });

  it('preserves both public metadata/defaults and actual default-registry membership', async () => {
    vi.resetModules();
    const publicSource = await import('../src/index.js');
    const registry = publicSource.createDefaultRegistry();
    expect(publicSource.textReadability.id).toBe('text-readability');
    expect(publicSource.textStatsByParagraph.id).toBe('text-stats-by-paragraph');
    expect(publicSource.textReadability.defaults).toEqual({});
    expect(publicSource.textStatsByParagraph.defaults).toEqual({ denseGradeThreshold: 14, minWordsForReadability: 30 });
    for (const tool of [publicSource.textReadability, publicSource.textStatsByParagraph]) {
      const registered = registry.toolsById.get(tool.id);
      expect(registered).toBeDefined();
      if (!registered) throw new Error('Public registered readability tool is absent.');
      for (const key of Object.keys(tool)) {
        if (key !== 'run') expect(Reflect.get(registered, key)).toEqual(Reflect.get(tool, key));
      }
      expect(typeof registered.run).toBe('function');
      expect(tool.category).toBe('text');
      expect(tool.input.accept).toContain('text/plain');
      expect(tool.output.mime).toBe('application/json');
      expect(tool.installSize).toBeUndefined();
      const controller = new AbortController();
      controller.abort();
      await expect(registered.run([new File(['A valid sentence.'], 'unit.txt', { type: 'text/plain' })], {},
        context(controller.signal))).rejects.toThrow(/^Aborted$/);
    }
  });

  it('maps all eight readability fields with original one-decimal serialization and progress', async () => {
    vi.resetModules();
    const methods = scorer();
    vi.doMock('text-readability', () => ({ default: methods }));
    const { textReadability } = await import('../src/tools/text-readability/index.js');
    const text = '  Alpha beta gamma delta epsilon.  ';
    const progress: unknown[] = [];
    const outputs = await textReadability.run([new File([text], 'unit.txt', { type: 'text/plain' })], {},
      context(undefined, (value) => { progress.push(structuredClone(value)); })) as Blob[];
    expect(outputs).toHaveLength(1);
    expect(outputs[0]!.type).toBe('application/json');
    expect(await outputs[0]!.text()).toBe(JSON.stringify({
      flesch: 11.2, fleschKincaid: 22.4, colemanLiau: 33.4, smog: 44.6,
      automatedReadability: 55.6, daleChall: 66.8, gunningFog: 77.8, gradeLevel: 'UNIT_GRADE_SENTINEL',
    }, null, 2));
    for (const name of scoreMethods) {
      expect(methods[name]).toHaveBeenCalledExactlyOnceWith(text);
      expect(methods[name].mock.contexts[0]).toBe(methods);
    }
    expect(progress).toEqual([
      { stage: 'processing', percent: 10, message: 'Analyzing text' },
      { stage: 'processing', percent: 50, message: 'Computing scores' },
      { stage: 'done', percent: 100, message: 'Done' },
    ]);
  });

  it('retains readability zero/two-file, whitespace and pre-abort errors before dependency entry', async () => {
    vi.resetModules();
    const methods = scorer();
    let factoryEntries = 0;
    vi.doMock('text-readability', () => { factoryEntries++; return { default: methods }; });
    const { textReadability } = await import('../src/tools/text-readability/index.js');
    const file = () => new File(['Valid text.'], 'unit.txt', { type: 'text/plain' });
    await expect(textReadability.run([], {}, context())).rejects.toThrow('text-readability accepts exactly one text file.');
    await expect(textReadability.run([file(), file()], {}, context())).rejects.toThrow('text-readability accepts exactly one text file.');
    for (const text of ['', ' \r\n\t '])
      await expect(textReadability.run([new File([text], 'empty.txt')], {}, context())).rejects.toThrow('Input text is empty.');
    const controller = new AbortController(), progress: unknown[] = [];
    controller.abort();
    await expect(textReadability.run([file()], {}, context(controller.signal,
      (value) => { progress.push(structuredClone(value)); }))).rejects.toThrow('Aborted');
    expect(progress).toEqual([{ stage: 'processing', percent: 10, message: 'Analyzing text' }]);
    expect(factoryEntries).toBe(0);
    for (const name of scoreMethods) expect(methods[name]).not.toHaveBeenCalled();
  });

  it('keeps paragraph trimming, eligibility boundary, two-decimal scores and inclusive density', async () => {
    vi.resetModules();
    const methods = scorer();
    methods.fleschReadingEase.mockReturnValue(12.345);
    methods.fleschKincaidGrade.mockReturnValue(6.004);
    methods.gunningFog.mockReturnValue(3.456);
    vi.doMock('text-readability', () => ({ default: methods }));
    const { textStatsByParagraph } = await import('../src/tools/text-stats-by-paragraph/index.js');
    const first = 'Alpha beta gamma delta epsilon.';
    const text = '  ' + first + '\r\n\r\n\tShort text.\n\nAnother four words here.';
    const progress: unknown[] = [];
    const inputs = () => [new File([text], 'unit.txt', { type: 'text/plain' })];
    const outputs = await textStatsByParagraph.run(inputs(), { minWordsForReadability: 5, denseGradeThreshold: 6 },
      context(undefined, (value) => { progress.push(structuredClone(value)); })) as Blob[];
    expect(outputs).toHaveLength(1);
    expect(outputs[0]!.type).toBe('application/json');
    expect(await outputs[0]!.text()).toBe(JSON.stringify({
      paragraphCount: 3, totalWords: 11, totalChars: 75, denseCount: 1, averageWordsPerParagraph: 3.67,
      paragraphs: [
        { index: 0, start: 0, preview: first, chars: 31, words: 5, sentences: 1, averageWordLength: 5.4,
          readability: { flesch: 12.35, fleschKincaid: 6, gunningFog: 3.46 }, dense: true },
        { index: 1, start: 37, preview: 'Short text.', chars: 11, words: 2, sentences: 1, averageWordLength: 5 },
        { index: 2, start: 51, preview: 'Another four words here.', chars: 24, words: 4, sentences: 1, averageWordLength: 5.25 },
      ],
    }, null, 2));
    for (const name of ['fleschReadingEase', 'fleschKincaidGrade', 'gunningFog'] as const)
      expect(methods[name]).toHaveBeenCalledExactlyOnceWith(first);
    for (const name of ['colemanLiauIndex', 'smogIndex', 'automatedReadabilityIndex', 'daleChallReadabilityScore', 'textStandard'] as const)
      expect(methods[name]).not.toHaveBeenCalled();
    expect(progress).toEqual([
      { stage: 'processing', percent: 25, message: 'Reading text' },
      { stage: 'processing', percent: 55, message: 'Splitting paragraphs' },
      { stage: 'processing', percent: 75, message: 'Scoring' },
      { stage: 'done', percent: 100, message: 'Done' },
    ]);
    for (const name of scoreMethods) methods[name].mockClear();
    for (const params of [{ minWordsForReadability: 6 }, {}]) {
      const [output] = await textStatsByParagraph.run(inputs(), params, context()) as Blob[];
      const value = JSON.parse(await output!.text()) as TextStatsByParagraphResult;
      expect(value.denseCount).toBe(0);
      expect(value.paragraphs).toHaveLength(3);
      for (const paragraph of value.paragraphs) {
        expect(Object.hasOwn(paragraph, 'readability')).toBe(false);
        expect(Object.hasOwn(paragraph, 'dense')).toBe(false);
      }
      for (const name of scoreMethods) expect(methods[name]).not.toHaveBeenCalled();
    }
  });

  it('retains paragraph zero/two-file, pre-abort, empty and short-text behavior', async () => {
    vi.resetModules();
    const methods = scorer();
    let factoryEntries = 0;
    vi.doMock('text-readability', () => { factoryEntries++; return { default: methods }; });
    const { textStatsByParagraph } = await import('../src/tools/text-stats-by-paragraph/index.js');
    const file = () => new File(['Short text.'], 'unit.txt', { type: 'text/plain' });
    await expect(textStatsByParagraph.run([], {}, context())).rejects.toThrow('text-stats-by-paragraph accepts exactly one text input.');
    await expect(textStatsByParagraph.run([file(), file()], {}, context())).rejects.toThrow('text-stats-by-paragraph accepts exactly one text input.');
    const controller = new AbortController(), progress: unknown[] = [];
    controller.abort();
    await expect(textStatsByParagraph.run([file()], {}, context(controller.signal,
      (value) => { progress.push(structuredClone(value)); }))).rejects.toThrow('Aborted');
    expect(progress).toEqual([{ stage: 'processing', percent: 25, message: 'Reading text' }]);
    expect(factoryEntries).toBe(0);
    for (const [text, expected] of [
      ['', { paragraphCount: 0, totalWords: 0, totalChars: 0, denseCount: 0, averageWordsPerParagraph: 0, paragraphs: [] }],
      ['Short text.', { paragraphCount: 1, totalWords: 2, totalChars: 11, denseCount: 0, averageWordsPerParagraph: 2,
        paragraphs: [{ index: 0, start: 0, preview: 'Short text.', chars: 11, words: 2, sentences: 1, averageWordLength: 5 }] }],
    ] as const) {
      const [output] = await textStatsByParagraph.run([new File([text], 'unit.txt')], {}, context()) as Blob[];
      expect(await output!.text()).toBe(JSON.stringify(expected, null, 2));
    }
    expect(factoryEntries).toBe(1);
    for (const name of scoreMethods) expect(methods[name]).not.toHaveBeenCalled();
  });

  it('text-readability actual pending dependency releases after abort without scoring or Blob', async () => {
    vi.resetModules();
    const entered = deferred(), release = deferred(), methods = scorer();
    releases.push(release.resolve);
    let factoryEntered = false;
    vi.doMock('text-readability', async () => {
      factoryEntered = true;
      entered.resolve();
      await release.promise;
      return { default: methods };
    });
    const loading = observe(import('../src/tools/text-readability/index.js'));
    drains.push(loading);
    try {
      const loaded = await loading;
      if (loaded.status === 'rejected') throw loaded.reason;
      expect(factoryEntered).toBe(false);
      const input = new File(['A valid sentence.'], 'unit.txt', { type: 'text/plain' });
      const blobs = vi.spyOn(globalThis, 'Blob');
      const controller = new AbortController(), progress: unknown[] = [];
      const running = observe(loaded.value.textReadability.run([input], {}, context(controller.signal,
        (value) => { progress.push(structuredClone(value)); })));
      drains.push(running);
      let settled = false;
      void running.then(() => { settled = true; });
      await entered.promise;
      expect(factoryEntered).toBe(true);
      expect(settled).toBe(false);
      expect(progress).toEqual([{ stage: 'processing', percent: 10, message: 'Analyzing text' }]);
      for (const name of scoreMethods) expect(methods[name]).not.toHaveBeenCalled();
      expect(blobs).not.toHaveBeenCalled();
      controller.abort();
      expect(settled).toBe(false);
      for (const name of scoreMethods) expect(methods[name]).not.toHaveBeenCalled();
      expect(blobs).not.toHaveBeenCalled();
      release.resolve();
      const outcome = await running;
      expect(outcome.status).toBe('rejected');
      if (outcome.status !== 'rejected') throw new Error('Expected original Aborted refusal.');
      expect(outcome.reason).toBeInstanceOf(Error);
      expect((outcome.reason as Error).message).toBe('Aborted');
      expect(progress).toEqual([{ stage: 'processing', percent: 10, message: 'Analyzing text' }]);
      for (const name of scoreMethods) expect(methods[name]).not.toHaveBeenCalled();
      expect(blobs).not.toHaveBeenCalled();
    } finally {
      release.resolve();
      await Promise.all(drains);
    }
  });

  it('text-stats-by-paragraph actual pending dependency releases after abort without scoring or Blob', async () => {
    vi.resetModules();
    const entered = deferred(), release = deferred(), methods = scorer();
    releases.push(release.resolve);
    let factoryEntered = false;
    vi.doMock('text-readability', async () => {
      factoryEntered = true;
      entered.resolve();
      await release.promise;
      return { default: methods };
    });
    const loading = observe(import('../src/tools/text-stats-by-paragraph/index.js'));
    drains.push(loading);
    try {
      const loaded = await loading;
      if (loaded.status === 'rejected') throw loaded.reason;
      expect(factoryEntered).toBe(false);
      const input = new File(['A valid sentence.'], 'unit.txt', { type: 'text/plain' });
      const blobs = vi.spyOn(globalThis, 'Blob');
      const controller = new AbortController(), progress: unknown[] = [];
      const running = observe(loaded.value.textStatsByParagraph.run([input], {}, context(controller.signal,
        (value) => { progress.push(structuredClone(value)); })));
      drains.push(running);
      let settled = false;
      void running.then(() => { settled = true; });
      await entered.promise;
      expect(factoryEntered).toBe(true);
      expect(settled).toBe(false);
      expect(progress).toEqual([{ stage: 'processing', percent: 25, message: 'Reading text' }]);
      for (const name of scoreMethods) expect(methods[name]).not.toHaveBeenCalled();
      expect(blobs).not.toHaveBeenCalled();
      controller.abort();
      expect(settled).toBe(false);
      for (const name of scoreMethods) expect(methods[name]).not.toHaveBeenCalled();
      expect(blobs).not.toHaveBeenCalled();
      release.resolve();
      const outcome = await running;
      expect(outcome.status).toBe('rejected');
      if (outcome.status !== 'rejected') throw new Error('Expected original Aborted refusal.');
      expect(outcome.reason).toBeInstanceOf(Error);
      expect((outcome.reason as Error).message).toBe('Aborted');
      expect(progress).toEqual([{ stage: 'processing', percent: 25, message: 'Reading text' }]);
      for (const name of scoreMethods) expect(methods[name]).not.toHaveBeenCalled();
      expect(blobs).not.toHaveBeenCalled();
    } finally {
      release.resolve();
      await Promise.all(drains);
    }
  });
});
