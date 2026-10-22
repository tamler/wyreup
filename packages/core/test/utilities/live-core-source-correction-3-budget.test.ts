import { afterEach, describe, expect, it, vi } from 'vitest';
import { Marked } from 'marked';
import { markdownToHtml } from '../../src/tools/markdown-to-html/index.js';
import type { ToolRunContext } from '../../src/types.js';

const ctx = (stages: string[] = []): ToolRunContext => ({
  signal: new AbortController().signal,
  cache: new Map(),
  executionId: 'live3-budget',
  onProgress(progress) {
    stages.push(progress.stage);
  },
});

async function convert(text: string, stages: string[] = []) {
  const output = await markdownToHtml.run(
    [new File([text], 'budget.md', { type: 'text/markdown' })],
    { gfm: true },
    ctx(stages),
  );
  const blob = Array.isArray(output) ? output[0] : output;
  if (!blob) throw new Error('No Markdown artifact.');
  return blob;
}

afterEach(() => vi.restoreAllMocks());

describe('LIVE3 native producer budget boundaries', () => {
  it('matches actual native 10MiB literal success or gives exact typed capacity refusal', async () => {
    const text = 'a'.repeat(10 * 1024 * 1024);
    let native: string | undefined;
    try {
      native = await new Marked({ gfm: true }).parse(text);
    } catch (cause) {
      if (!(cause instanceof RangeError)) throw cause;
    }
    const stages: string[] = [];
    if (native !== undefined) {
      const blob = await convert(text, stages);
      expect(blob.size).toBe(text.length + 8);
      expect(await blob.text()).toBe(native);
      expect(native).toBe(`<p>${text}</p>\n`);
      expect(stages).toContain('done');
    } else {
      await expect(convert(text, stages)).rejects.toMatchObject({
        name: 'UtilityInputError',
        field: '$input',
        code: 'budget',
        message:
          '$input: Markdown exceeds native parser capacity for this document. Use a smaller or simpler document.',
      });
      expect(stages).not.toContain('done');
    }
  }, 30000);

  it('keeps actual native/core 1MiB literal exact success without assuming a larger threshold', async () => {
    const text = 'a'.repeat(1024 * 1024);
    const native = await new Marked({ gfm: true }).parse(text);
    const blob = await convert(text);
    expect(native).toBe(`<p>${text}</p>\n`);
    expect(blob.size).toBe(1024 * 1024 + 8);
    expect(await blob.text()).toBe(native);
  }, 30000);

  it('observes both installed prototype seams in a real accepted conversion', async () => {
    const lexer = vi.spyOn(Marked.prototype, 'lexer');
    const parser = vi.spyOn(Marked.prototype, 'parser');
    expect(await (await convert('accepted **bold**')).text()).toBe(
      '<p>accepted <strong>bold</strong></p>\n',
    );
    expect(lexer).toHaveBeenCalledTimes(1);
    expect(parser).toHaveBeenCalledTimes(1);
  });

  it.each(['lexer', 'parser'] as const)(
    'maps only a %s RangeError to typed capacity refusal without artifact or done',
    async (boundary) => {
      vi.spyOn(Marked.prototype, boundary).mockImplementationOnce(() => {
        throw new RangeError('Controlled native-call capacity');
      });
      const stages: string[] = [];
      let artifact: Blob | undefined;
      let error: unknown;
      try {
        artifact = await convert('accepted small document', stages);
      } catch (cause) {
        error = cause;
      }
      expect(error).toMatchObject({
        name: 'UtilityInputError',
        field: '$input',
        code: 'budget',
        message:
          '$input: Markdown exceeds native parser capacity for this document. Use a smaller or simpler document.',
      });
      expect(artifact).toBeUndefined();
      expect(stages).not.toContain('done');
    },
  );

  it.each(['lexer', 'parser'] as const)(
    'preserves a %s non-RangeError object identity without artifact or done',
    async (boundary) => {
      const sentinel = Object.freeze({ tag: 'Exact original non-RangeError', boundary });
      vi.spyOn(Marked.prototype, boundary).mockImplementationOnce(() => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- Verify arbitrary non-RangeError identity is preserved.
        throw sentinel;
      });
      const stages: string[] = [];
      let artifact: Blob | undefined;
      let error: unknown;
      try {
        artifact = await convert('accepted small document', stages);
      } catch (cause) {
        error = cause;
      }
      expect(error).toBe(sentinel);
      expect(artifact).toBeUndefined();
      expect(stages).not.toContain('done');
    },
  );

  it('refuses token visits before native rendering, independently of the HTML allowance', async () => {
    const text = '[x](/)'.repeat(50001);
    const parser = vi.spyOn(Marked.prototype, 'parser');
    await expect(convert(text)).rejects.toMatchObject({ code: 'budget' });
    expect(parser).not.toHaveBeenCalled();
  }, 30000);

  it('refuses post-lexer parser depth before rendering and preserves moderate nested output', async () => {
    const accepted = '> '.repeat(32) + 'literal\n';
    expect(await (await convert(accepted)).text()).toBe(
      await new Marked({ gfm: true }).parse(accepted),
    );
    const parser = vi.spyOn(Marked.prototype, 'parser');
    await expect(convert('> '.repeat(130) + 'literal\n')).rejects.toMatchObject({ code: 'budget' });
    expect(parser).not.toHaveBeenCalled();
  });

  it('refuses uncached long-reference scan work before rendering', async () => {
    // Each key is larger than the 1MiB cache allowance. Twelve 2MiB targets
    // would stay below 50MiB HTML, but exceed the declared charged scan quota.
    const target = 'https://example.invalid/' + 'a'.repeat(2 * 1024 * 1024);
    const text = `[r]: ${target}\n\n` + '[x][r]'.repeat(12);
    const parser = vi.spyOn(Marked.prototype, 'parser');
    await expect(convert(text)).rejects.toMatchObject({ code: 'budget' });
    expect(parser).not.toHaveBeenCalled();
  }, 30000);

  it('refuses the independent 50MiB HTML ceiling before rendering', async () => {
    // A cached half-MiB target repeated 101 times exceeds 50MiB even though
    // the input's 64x allowance is raised by nonrendered definition data.
    const target = 'https://example.invalid/' + 'a'.repeat(512 * 1024);
    const padding = `[unused]: https://example.invalid/${'a'.repeat(512 * 1024)}\n`;
    const text = `[r]: ${target}\n${padding}\n` + '[x][r]'.repeat(101);
    const parser = vi.spyOn(Marked.prototype, 'parser');
    await expect(convert(text)).rejects.toMatchObject({ code: 'budget' });
    expect(parser).not.toHaveBeenCalled();
  }, 30000);

  it('keeps cached hrefs and loose task/table wrappers byte-identical to native output', async () => {
    const text =
      '[r]: /safe?x=é&y=😀 "Title & café"\n\n' +
      '[link][r] ![alt][r] '.repeat(256) +
      '\n\n- [x] **done**\n\n  > body\n\n- [ ] waiting\n\n' +
      '| A | B |\n| - | - |\n| **one** | `two` |\n';
    expect(await (await convert(text)).text()).toBe(await new Marked({ gfm: true }).parse(text));
  });
});
