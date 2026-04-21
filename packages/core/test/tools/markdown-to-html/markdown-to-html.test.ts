import { describe, it, expect } from 'vitest';
import { markdownToHtml } from '../../../src/tools/markdown-to-html/index.js';
import type { ToolRunContext } from '../../../src/types.js';

function makeCtx(): ToolRunContext {
  return {
    onProgress: () => {},
    signal: new AbortController().signal,
    cache: new Map(),
    executionId: 'test',
  };
}

describe('markdown-to-html — metadata', () => {
  it('has id markdown-to-html', () => {
    expect(markdownToHtml.id).toBe('markdown-to-html');
  });

  it('is in the convert category', () => {
    expect(markdownToHtml.category).toBe('convert');
  });

  it('accepts text/plain and text/markdown', () => {
    expect(markdownToHtml.input.accept).toContain('text/plain');
    expect(markdownToHtml.input.accept).toContain('text/markdown');
  });

  it('defaults to gfm: true', () => {
    expect(markdownToHtml.defaults.gfm).toBe(true);
  });
});

describe('markdown-to-html — run()', () => {
  it('converts basic heading and bold', async () => {
    const md = '# Hello World\n\n**bold text**\n';
    const input = new File([md], 'test.md', { type: 'text/markdown' });
    const [out] = await markdownToHtml.run([input], { gfm: true }, makeCtx()) as Blob[];
    expect(out!.type).toBe('text/html');
    const html = await out!.text();
    expect(html).toContain('<h1>');
    expect(html).toContain('Hello World');
    expect(html).toContain('<strong>');
    expect(html).toContain('bold text');
  });

  it('converts links', async () => {
    const md = '[Visit Example](https://example.com)\n';
    const input = new File([md], 'test.md', { type: 'text/markdown' });
    const [out] = await markdownToHtml.run([input], { gfm: true }, makeCtx()) as Blob[];
    const html = await out!.text();
    expect(html).toContain('<a href="https://example.com"');
    expect(html).toContain('Visit Example');
  });

  it('converts GFM table', async () => {
    const md = '| Name | Age |\n|------|-----|\n| Alice | 30 |\n';
    const input = new File([md], 'test.md', { type: 'text/markdown' });
    const [out] = await markdownToHtml.run([input], { gfm: true }, makeCtx()) as Blob[];
    const html = await out!.text();
    expect(html).toContain('<table>');
    expect(html).toContain('<th>');
    expect(html).toContain('Alice');
  });

  it('converts code blocks', async () => {
    const md = '```js\nconst x = 1;\n```\n';
    const input = new File([md], 'test.md', { type: 'text/markdown' });
    const [out] = await markdownToHtml.run([input], { gfm: true }, makeCtx()) as Blob[];
    const html = await out!.text();
    expect(html).toContain('<pre>');
    expect(html).toContain('const x = 1;');
  });
});
