import { describe, it, expect } from 'vitest';
import { htmlRedact } from '../../../src/tools/html-redact/index.js';
import type { ToolRunContext } from '../../../src/types.js';

function makeCtx(): ToolRunContext {
  return {
    onProgress: () => {},
    signal: new AbortController().signal,
    cache: new Map(),
    executionId: 'test',
  };
}

describe('html-redact — metadata', () => {
  it('has id html-redact and is free', () => {
    expect(htmlRedact.id).toBe('html-redact');
    expect(htmlRedact.cost).toBe('free');
  });
});

describe('html-redact — run()', () => {
  it('redacts an email in text content but keeps the tags', async () => {
    const html = '<p>Contact joe@example.com today</p>';
    const file = new File([html], 'f.html', { type: 'text/html' });
    const [out] = (await htmlRedact.run(
      [file],
      { presets: ['email'], replacement: '[REDACTED]' },
      makeCtx(),
    )) as Blob[];
    const text = await out!.text();
    expect(text).toContain('<p>');
    expect(text).toContain('[REDACTED]');
    expect(text).not.toContain('joe@example.com');
  });

  it('does not touch values inside a tag/attribute', async () => {
    const html = '<a href="mailto:joe@example.com">email me</a>';
    const file = new File([html], 'f.html', { type: 'text/html' });
    const [out] = (await htmlRedact.run([file], { presets: ['email'] }, makeCtx())) as Blob[];
    expect(await out!.text()).toContain('mailto:joe@example.com');
  });

  it('does not redact inside <script>', async () => {
    const html = '<script>const e = "joe@example.com";</script>';
    const file = new File([html], 'f.html', { type: 'text/html' });
    const [out] = (await htmlRedact.run([file], { presets: ['email'] }, makeCtx())) as Blob[];
    expect(await out!.text()).toContain('joe@example.com');
  });

  it('reports redaction counts', async () => {
    const html = '<div>a@b.com and c@d.com</div>';
    const file = new File([html], 'f.html', { type: 'text/html' });
    const [, statsBlob] = (await htmlRedact.run(
      [file],
      { presets: ['email'] },
      makeCtx(),
    )) as Blob[];
    const stats = JSON.parse(await statsBlob!.text()) as { totalRedactions: number };
    expect(stats.totalRedactions).toBe(2);
  });
});
