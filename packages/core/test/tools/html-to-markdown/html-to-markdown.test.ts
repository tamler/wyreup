import { describe, it, expect } from 'vitest';
import { htmlToMarkdown } from '../../../src/tools/html-to-markdown/index.js';
import type { ToolRunContext } from '../../../src/types.js';

function makeCtx(): ToolRunContext {
  return {
    onProgress: () => {},
    signal: new AbortController().signal,
    cache: new Map(),
    executionId: 'test',
  };
}

describe('html-to-markdown — metadata', () => {
  it('has id html-to-markdown', () => {
    expect(htmlToMarkdown.id).toBe('html-to-markdown');
  });

  it('is in the convert category', () => {
    expect(htmlToMarkdown.category).toBe('convert');
  });

  it('accepts text/html and text/plain', () => {
    expect(htmlToMarkdown.input.accept).toContain('text/html');
    expect(htmlToMarkdown.input.accept).toContain('text/plain');
  });

  it('defaults to atx heading style', () => {
    expect(htmlToMarkdown.defaults.headingStyle).toBe('atx');
  });
});

describe('html-to-markdown — run()', () => {
  it('converts h1 to # heading', async () => {
    const html = '<h1>Hello World</h1>';
    const input = new File([html], 'test.html', { type: 'text/html' });
    const [out] = await htmlToMarkdown.run([input], { headingStyle: 'atx' }, makeCtx()) as Blob[];
    expect(out!.type).toBe('text/plain');
    const md = await out!.text();
    expect(md).toContain('# Hello World');
  });

  it('converts paragraphs and anchors', async () => {
    const html = '<p>Visit <a href="https://example.com">Example</a></p>';
    const input = new File([html], 'test.html', { type: 'text/html' });
    const [out] = await htmlToMarkdown.run([input], { headingStyle: 'atx' }, makeCtx()) as Blob[];
    const md = await out!.text();
    expect(md).toContain('[Example](https://example.com)');
  });

  it('preserves image alt text', async () => {
    const html = '<img src="photo.jpg" alt="A photo">';
    const input = new File([html], 'test.html', { type: 'text/html' });
    const [out] = await htmlToMarkdown.run([input], { headingStyle: 'atx' }, makeCtx()) as Blob[];
    const md = await out!.text();
    expect(md).toContain('A photo');
  });

  it('handles nested lists', async () => {
    const html = '<ul><li>Item 1</li><li>Item 2<ul><li>Sub item</li></ul></li></ul>';
    const input = new File([html], 'test.html', { type: 'text/html' });
    const [out] = await htmlToMarkdown.run([input], { headingStyle: 'atx' }, makeCtx()) as Blob[];
    const md = await out!.text();
    expect(md).toContain('Item 1');
    expect(md).toContain('Item 2');
    expect(md).toContain('Sub item');
  });
});
