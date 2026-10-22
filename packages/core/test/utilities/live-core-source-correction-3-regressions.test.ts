import { afterEach, describe, expect, it, vi } from 'vitest';
import { Marked } from 'marked';
import { markdownToHtml } from '../../src/tools/markdown-to-html/index.js';
import type { MarkdownToHtmlParams } from '../../src/tools/markdown-to-html/types.js';
import { countWordText } from '../../src/tools/word-counter/index.js';
import type { ToolRunContext } from '../../src/types.js';

function context(stages: string[] = [], controller = new AbortController()): ToolRunContext {
  return {
    signal: controller.signal,
    executionId: 'independent-live-source-correction-3',
    cache: new Map(),
    onProgress: (progress) => stages.push(progress.stage),
  };
}

async function markdown(text: string, gfm = true): Promise<string> {
  const output = await markdownToHtml.run(
    [new File([text], 'actual.md', { type: 'text/markdown' })],
    { gfm },
    context(),
  );
  const blob = Array.isArray(output) ? output[0] : output;
  if (!blob) throw new Error('No actual Markdown artifact.');
  expect(blob.type).toBe('text/html');
  return blob.text();
}

class SliceProbeFile extends File {
  slices = 0;

  override slice(...args: Parameters<File['slice']>): Blob {
    this.slices++;
    return super.slice(...args);
  }
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('LIVE3 moderate shared-reference amplification admission', () => {
  it('refuses the actual 29227-byte/3500-reference expansion without an artifact or done', async () => {
    const target = 'https://example.invalid/' + 'A&amp;'.repeat(1366);
    const text = `[r]: ${target}\n\n` + '[x][r]'.repeat(3500);
    const file = new File([text], 'shared-references.md', { type: 'text/markdown' });
    expect(target.length).toBe(8220);
    expect(file.size).toBe(29227);
    // This is below token/depth/work stress; actual prior native output was 28826008 bytes.
    // The declared 64x policy independently allows at most 1870528 bytes for this input.
    expect(64 * file.size).toBe(1870528);
    const fetcher = vi.fn(() => {
      throw new Error('Local Markdown conversion must not issue network requests.');
    });
    vi.stubGlobal('fetch', fetcher);
    const stages: string[] = [];
    let error: unknown;
    let artifact: Blob | undefined;
    try {
      const output = await markdownToHtml.run([file], { gfm: true }, context(stages));
      artifact = Array.isArray(output) ? output[0] : output;
    } catch (reason) {
      error = reason;
    }
    expect.soft(error).toMatchObject({ name: 'UtilityInputError', code: 'budget' });
    expect.soft(artifact?.size).toBeUndefined();
    expect.soft(stages).not.toContain('done');
    expect(fetcher).not.toHaveBeenCalled();
  }, 15000);
});

describe('LIVE3 exact old small-input whitespace and paragraph semantics', () => {
  const cases = [
    '',
    ' ',
    '\uFEFF',
    '\u0085',
    '\uFEFF \t\r\n',
    'A\uFEFFB',
    'A\u0085B',
    'A\r\n\r\nB',
    'A\n\uFEFF \t\nB',
    'A\n\u0085\nB',
    'A\n\n\nB',
    '\n\nA\n\n',
    'A\nB',
    'a\u2028b\u2029c',
    'one\n \n\n \ntwo\n\nthree',
    '\uFEFF😀\n \n café\u0085',
    ' \u00A0\u1680\u2000\u2007\u202F\u205F\u3000 ',
  ];
  it.each(cases)('preserves legacy split/trim/replace counts for %j', (text) => {
    // The deliberately small old expressions are independent compatibility oracles
    // for the proposed allocation-free scan, not a copy of that future algorithm.
    const expected = {
      charactersNoSpaces: text.replace(/\s/g, '').length,
      lines: text === '' ? 0 : text.split('\n').length,
      paragraphs: text.split(/\n\s*\n/).filter((part) => part.trim().length > 0).length,
    };
    expect(countWordText(text)).toMatchObject(expected);
  });

  it('distinguishes FEFF whitespace from 0085 nonwhite with independent fixed counts', () => {
    expect(countWordText('\uFEFF')).toMatchObject({
      charactersNoSpaces: 0,
      lines: 1,
      paragraphs: 0,
    });
    expect(countWordText('\u0085')).toMatchObject({
      charactersNoSpaces: 1,
      lines: 1,
      paragraphs: 1,
    });
    expect(countWordText('A\n\u0085\nB')).toMatchObject({
      charactersNoSpaces: 3,
      lines: 3,
      paragraphs: 1,
    });
    expect(countWordText('A\r\n\r\nB')).toMatchObject({
      charactersNoSpaces: 2,
      lines: 3,
      paragraphs: 2,
    });
  });

  it('preserves moderate many-LF paragraph and blank-line arithmetic', () => {
    expect(countWordText(Array<string>(2048).fill('w').join('\n\n'))).toMatchObject({
      charactersNoSpaces: 2048,
      lines: 4095,
      paragraphs: 2048,
    });
    expect(countWordText('\n'.repeat(8192))).toMatchObject({
      charactersNoSpaces: 0,
      lines: 8193,
      paragraphs: 0,
    });
  });

  it('keeps unchanged HTML stripping before the whitespace counts', () => {
    const actual = countWordText('<p>A</p><b>B</b>\n\nC', {}, 'text/html');
    expect(actual).toMatchObject({ charactersNoSpaces: 3, lines: 3, paragraphs: 2 });
  });

  it('retains literal UTF16/UTF8 distinctions and 200-WPM reading arithmetic', () => {
    expect(countWordText('é😀')).toMatchObject({ characters: 3, codePoints: 2, utf8Bytes: 6 });
    expect(countWordText(Array<string>(200).fill('word').join(' ')).readingTimeMinutes).toBe(1);
    const controller = new AbortController();
    controller.abort();
    expect(() => countWordText('A\n\nB', {}, 'text/plain', controller.signal)).toThrow(/cancel/);
  });
});

describe('LIVE3 ordinary actual native Markdown byte and security controls', () => {
  it.each([
    ['plain Unicode', 'café 😀 & tea\n'],
    ['heading and inline syntax', '# Heading\n\n**bold** and `a < b`\n'],
    ['safe link and image', '[x](https://example.invalid/a?b=1&c=2 "Title") ![alt](image.png)\n'],
    ['table and task list', '| A | B |\n| - | - |\n| x | y |\n\n- [x] done\n- [ ] waiting\n'],
    ['code and quoted text', '```js\nconst x = "é & <";\n```\n\n> quoted\n'],
    ['references and entities', '[r]: /safe?a=1&amp;b=2 "café"\n\n[x][r] [x][r] &amp;\n'],
  ])('keeps native %s exact output in both GFM modes', async (_label, input) => {
    for (const gfm of [true, false]) {
      const expected = await new Marked({ gfm }).parse(input);
      expect(await markdown(input, gfm)).toBe(expected);
    }
  });

  it.each([
    ['[x](javascript&#58;alert(1))', '<p><a href="#">x</a></p>\n'],
    ['![alt](javascript&colon;alert(1))', '<p><img src="#" alt="alt"></p>\n'],
    ['[x](java&#9;script:alert(1))', '<p><a href="#">x</a></p>\n'],
    ['[x](javascript&amp;#58;alert(1))', '<p><a href="javascript&amp;#58;alert(1)">x</a></p>\n'],
    ['<script>alert(1)</script>\n', '&lt;script&gt;alert(1)&lt;/script&gt;\n'],
  ])('keeps existing one-pass security bytes for %s', async (input, expected) => {
    expect(await markdown(input)).toBe(expected);
  });

  it('refuses malformed UTF8 without done or replacement artifact', async () => {
    const stages: string[] = [];
    await expect(
      markdownToHtml.run(
        [new File([new Uint8Array([0x23, 0x20, 0xc3])], 'invalid.md')],
        {},
        context(stages),
      ),
    ).rejects.toMatchObject({ name: 'UtilityInputError', code: 'type' });
    expect(stages).not.toContain('done');
  });

  it('keeps already-aborted and invalid-GFM admission before any file slice/progress', async () => {
    const file = new SliceProbeFile(['# No read'], 'no-read.md');
    const stages: string[] = [];
    const controller = new AbortController();
    controller.abort();
    await expect(markdownToHtml.run([file], {}, context(stages, controller))).rejects.toMatchObject(
      {
        code: 'abort',
      },
    );
    const params: MarkdownToHtmlParams = {};
    Object.defineProperty(params, 'gfm', { value: 'false', enumerable: true });
    await expect(markdownToHtml.run([file], params, context(stages))).rejects.toMatchObject({
      code: 'type',
    });
    expect(file.slices).toBe(0);
    expect(stages).toEqual([]);
  });
});
