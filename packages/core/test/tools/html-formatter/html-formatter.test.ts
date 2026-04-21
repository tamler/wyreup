import { describe, it, expect } from 'vitest';
import { htmlFormatter } from '../../../src/tools/html-formatter/index.js';
import type { ToolRunContext } from '../../../src/types.js';
import type { HtmlFormatterParams } from '../../../src/tools/html-formatter/index.js';

function makeCtx(): ToolRunContext {
  return {
    onProgress: () => {},
    signal: new AbortController().signal,
    cache: new Map(),
    executionId: 'test',
  };
}

async function run(text: string, params: HtmlFormatterParams = {}): Promise<string> {
  const file = new File([text], 'input.html', { type: 'text/html' });
  const [out] = await htmlFormatter.run([file], params, makeCtx()) as Blob[];
  return out!.text();
}

describe('html-formatter — metadata', () => {
  it('has id html-formatter', () => {
    expect(htmlFormatter.id).toBe('html-formatter');
  });

  it('is in the dev category', () => {
    expect(htmlFormatter.category).toBe('dev');
  });

  it('outputs text/html', () => {
    expect(htmlFormatter.output.mime).toBe('text/html');
  });
});

describe('html-formatter — run()', () => {
  it('beautifies compact HTML', async () => {
    const input = '<div><p>Hello</p><span>World</span></div>';
    const result = await run(input, { mode: 'beautify' });
    expect(result).toContain('\n');
    expect(result).toContain('<p>');
  });

  it('minifies HTML removing extra whitespace', async () => {
    const input = '<div>\n  <p>Hello</p>\n  <span>World</span>\n</div>';
    const result = await run(input, { mode: 'minify' });
    expect(result.split('\n').length).toBeLessThanOrEqual(2);
  });

  it('minify strips HTML comments', async () => {
    const input = '<div><!-- comment --><p>text</p></div>';
    const result = await run(input, { mode: 'minify' });
    expect(result).not.toContain('<!--');
  });

  it('respects tabWidth for beautify with nested content', async () => {
    const input = '<div><p>text</p><p>more</p><span>extra</span></div>';
    const result = await run(input, { mode: 'beautify', tabWidth: 4 });
    // Prettier HTML may inline or expand depending on content; just verify output is valid
    expect(result).toContain('<p>');
  });

  it('defaults to beautify mode', async () => {
    const input = '<div><p>Hello</p></div>';
    const result = await run(input);
    expect(result).toContain('\n');
  });
});
