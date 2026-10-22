import { describe, expect, it, vi } from 'vitest';
import { markdownToHtml } from '../../src/tools/markdown-to-html/index.js';
import { jsonFormatter } from '../../src/tools/json-formatter/index.js';
import { countWordText } from '../../src/tools/word-counter/index.js';
import type { ToolRunContext } from '../../src/types.js';

function context(controller = new AbortController(), stages: string[] = []): ToolRunContext {
  return {
    signal: controller.signal,
    cache: new Map(),
    executionId: 'live-source-correction-1',
    onProgress: (progress) => stages.push(progress.stage),
  };
}

class ObservedFile extends File {
  reads = 0;

  override text(): Promise<string> {
    this.reads++;
    return super.text();
  }

  override arrayBuffer(): Promise<ArrayBuffer> {
    this.reads++;
    return super.arrayBuffer();
  }

  override slice(start?: number, end?: number, contentType?: string): Blob {
    const blob = super.slice(start, end, contentType);
    const read = blob.arrayBuffer.bind(blob);
    Object.defineProperty(blob, 'arrayBuffer', {
      value: () => {
        this.reads++;
        return read();
      },
    });
    return blob;
  }
}

class DeferredReadFile extends File {
  private start: (() => void) | undefined;
  private releaseRead: (() => void) | undefined;
  readonly started = new Promise<void>((resolve) => {
    this.start = resolve;
  });
  private readonly released = new Promise<void>((resolve) => {
    this.releaseRead = resolve;
  });

  release(): void {
    this.releaseRead?.();
  }

  private async wait(): Promise<void> {
    this.start?.();
    await this.released;
  }

  override async text(): Promise<string> {
    await this.wait();
    return super.text();
  }

  override async arrayBuffer(): Promise<ArrayBuffer> {
    await this.wait();
    return super.arrayBuffer();
  }

  override slice(start?: number, end?: number, contentType?: string): Blob {
    const blob = super.slice(start, end, contentType);
    const read = blob.arrayBuffer.bind(blob);
    Object.defineProperty(blob, 'arrayBuffer', {
      value: async () => {
        await this.wait();
        return read();
      },
    });
    return blob;
  }
}

async function markdown(text: string): Promise<string> {
  const output = await markdownToHtml.run(
    [new File([text], 'probe.md', { type: 'text/markdown' })],
    {},
    context(),
  );
  const blob = Array.isArray(output) ? output[0] : output;
  if (!blob) throw new Error('Missing actual Markdown output.');
  return blob.text();
}

describe('live source correction 1 — actual Marked attribute contract', () => {
  it.each([
    'javascript&#58;alert(1)',
    'javascript&colon;alert(1)',
    'java&#9;script:alert(1)',
    'data&#58;text/html,example',
  ])('neutralizes browser-decoded executable destination %s', async (destination) => {
    expect(await markdown(`[x](${destination})`)).toContain('href="#"');
  });

  it('retains the installed renderer quote encoding rather than inventing an attribute breakout', async () => {
    for (const input of [
      '[x](http://example.com/"onmouseover="alert(1))',
      '[x](<http://example.com/"onmouseover="alert(1)>)',
    ]) {
      expect(await markdown(input)).toBe(
        '<p><a href="http://example.com/%22onmouseover=%22alert(1)">x</a></p>\n',
      );
    }
  });
});

describe('live source correction 1 — direct Markdown file and cancellation gates', () => {
  it('requires a file with an actionable input refusal', async () => {
    await expect(markdownToHtml.run([], {}, context())).rejects.toThrow(/file|input|select/i);
  });

  it('rejects extra files before reading either one', async () => {
    const files = [
      new ObservedFile(['# First'], 'first.md'),
      new ObservedFile(['# Second'], 'second.md'),
    ];
    await expect(markdownToHtml.run(files, {}, context())).rejects.toThrow(/file|input|one/i);
    expect(files.map((file) => file.reads)).toEqual([0, 0]);
  });

  it('rejects an accurate size over 10 MiB before reading', async () => {
    const file = new ObservedFile([new Uint8Array(10 * 1024 * 1024 + 1)], 'large.md');
    await expect(markdownToHtml.run([file], {}, context())).rejects.toThrow(/10|MiB|large|limit/i);
    expect(file.reads).toBe(0);
  });

  it('checks actual bytes even when File size metadata is understated', async () => {
    const file = new ObservedFile(['x'.repeat(10 * 1024 * 1024 + 1)], 'understated.md');
    Object.defineProperty(file, 'size', { value: 1 });
    await expect(markdownToHtml.run([file], {}, context())).rejects.toThrow(/10|MiB|large|limit/i);
  });

  it('accepts the exact 10 MiB boundary', async () => {
    const file = new File(['# Boundary\n'.padEnd(10 * 1024 * 1024, ' ')], 'boundary.md');
    const output = await markdownToHtml.run([file], {}, context());
    const blob = Array.isArray(output) ? output[0] : output;
    if (!blob) throw new Error('Missing boundary output.');
    expect(blob.type).toBe('text/html');
    expect(await blob.text()).toContain('<h1>Boundary</h1>');
  });

  it('does not read for a signal already aborted at direct entry', async () => {
    const controller = new AbortController();
    controller.abort();
    const file = new ObservedFile(['# Cancelled'], 'cancelled.md');
    await expect(markdownToHtml.run([file], {}, context(controller))).rejects.toThrow(
      /cancel|abort/i,
    );
    expect(file.reads).toBe(0);
  });

  it('rejects a read completed after cancellation without publishing done', async () => {
    const controller = new AbortController();
    const stages: string[] = [];
    const file = new DeferredReadFile(['# Delayed'], 'delayed.md');
    const running = markdownToHtml.run([file], {}, context(controller, stages));
    try {
      await file.started;
      controller.abort();
    } finally {
      file.release();
    }
    await expect(running).rejects.toThrow(/cancel|abort/i);
    expect(stages).not.toContain('done');
  });
});

describe('live source correction 1 — formatter pre-abort avoids file reads', () => {
  it('rejects before reading the JSON bytes', async () => {
    const controller = new AbortController();
    controller.abort();
    const file = new ObservedFile(['{"valid":true}'], 'cancelled.json');
    await expect(jsonFormatter.run([file], {}, context(controller))).rejects.toThrow(
      /cancel|abort/i,
    );
    expect(file.reads).toBe(0);
  });
});

describe('live source correction 1 — owned Segmenter iteration cancellation', () => {
  it.each(['word', 'grapheme'])('stops the %s iterator after an observed abort', (target) => {
    const controller = new AbortController();
    const yields = { word: 0, grapheme: 0 };
    class ControlledSegmenter {
      constructor(
        _locale: string,
        private options: { granularity: 'word' | 'grapheme' },
      ) {}

      *segment(): Iterable<{ segment: string; isWordLike: boolean }> {
        const kind = this.options.granularity;
        const count = kind === target ? 20000 : 1;
        for (let index = 0; index < count; index++) {
          yields[kind]++;
          if (kind === target && index === 0) controller.abort();
          yield { segment: 'x', isWordLike: true };
        }
      }
    }
    vi.stubGlobal('Intl', { Segmenter: ControlledSegmenter });
    try {
      expect(() => countWordText('small text', {}, 'text/plain', controller.signal)).toThrow(
        /cancel/i,
      );
      expect(yields[target as 'word' | 'grapheme']).toBeLessThanOrEqual(1024);
      if (target === 'word') expect(yields.grapheme).toBe(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('live source correction 1 — Unicode fallback word tokens', () => {
  it.each([
    ['é', 1],
    ['hello é', 2],
    ['naïve café', 2],
    ['你好 世界', 2],
    ['😀', 0],
  ])('counts %j without ASCII-only boundaries', (text, words) => {
    vi.stubGlobal('Intl', {});
    try {
      expect(countWordText(text)).toMatchObject({
        words,
        graphemes: null,
        graphemeCounting: 'unavailable',
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('live source correction 1 — browser attribute decoding edge cases', () => {
  it.each([
    'javascript&#58alert(1)',
    'javascript&#x3A;alert(1)',
    'javascript&#x3a;alert(1)',
    'javascript&#X3A;alert(1)',
    'javascript&#0000058;alert(1)',
    'javascript&#x00003a;alert(1)',
    '&#106;avascript:alert(1)',
    '&#106;&#97;&#118;&#97;script&#58;alert(1)',
    'java&Tab;script:alert(1)',
    'java&NewLine;script:alert(1)',
    'JaVaScRiPt&#58;alert(1)',
    '&#32;javascript:alert(1)',
  ])('neutralizes a single browser decode of %s', async (destination) => {
    expect(await markdown(`[x](${destination})`)).toContain('href="#"');
  });

  it.each([
    ['![x](javascript&#58;alert(1))', 'src="#"'],
    ['[x][target]\n\n[target]: javascript&#58;alert(1)', 'href="#"'],
    ['[x](<javascript&#58;alert(1)>)', 'href="#"'],
  ])('neutralizes the actual image/reference/angle token in %j', async (input, attribute) => {
    expect(await markdown(input)).toContain(attribute);
  });

  it.each([
    ['javascript&amp;#58;alert(1)', 'javascript&amp;#58;alert(1)'],
    ['https://example.test/?a=1&amp;b=2', 'https://example.test/?a=1&amp;b=2'],
    ['&#0;javascript:alert(1)', '&#0;javascript:alert(1)'],
  ])(
    'preserves the non-executable original destination %j without recursive decoding',
    async (destination, emitted) => {
      expect(await markdown(`[x](${destination})`)).toBe(`<p><a href="${emitted}">x</a></p>\n`);
    },
  );
});

describe('live source correction 1 — early Markdown parameter and UTF8 gates', () => {
  it.each(['false', 0, null])(
    'refuses non-boolean gfm %j before reading or progress',
    async (gfm) => {
      const file = new ObservedFile(['# Must not read'], 'wrong-gfm.md');
      const stages: string[] = [];
      const params = {};
      Object.defineProperty(params, 'gfm', { value: gfm, enumerable: true });
      await expect(
        markdownToHtml.run([file], params, context(new AbortController(), stages)),
      ).rejects.toThrow(/gfm|boolean|parameter/i);
      expect(file.reads).toBe(0);
      expect(stages).toEqual([]);
    },
  );

  it('refuses actual malformed UTF8 rather than emitting replacement characters', async () => {
    const file = new File([new Uint8Array([0x23, 0x20, 0xc3])], 'malformed.md', {
      type: 'text/markdown',
    });
    const stages: string[] = [];
    await expect(
      markdownToHtml.run([file], {}, context(new AbortController(), stages)),
    ).rejects.toThrow();
    expect(stages).not.toContain('done');
  });

  it('accepts both real boolean GFM values', async () => {
    const file = new File(['| A |\n| - |\n| B |\n'], 'table.md');
    for (const gfm of [true, false]) {
      const output = await markdownToHtml.run([file], { gfm }, context());
      const blob = Array.isArray(output) ? output[0] : output;
      if (!blob) throw new Error('Missing boolean GFM output.');
      const html = await blob.text();
      if (gfm) expect(html).toContain('<table>');
      else expect(html).not.toContain('<table>');
    }
  });
});

describe('live source correction 1 — decomposed Unicode fallback control', () => {
  it('counts a letter plus combining accent as one approximate Unicode token', () => {
    vi.stubGlobal('Intl', {});
    try {
      expect(countWordText('e\u0301')).toMatchObject({
        words: 1,
        graphemes: null,
        graphemeCounting: 'unavailable',
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
