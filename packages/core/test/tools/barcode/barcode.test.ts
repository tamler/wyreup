import { describe, it, expect } from 'vitest';
import { barcode } from '../../../src/tools/barcode/index.js';
import type { ToolRunContext } from '../../../src/types.js';

function makeCtx(): ToolRunContext {
  return {
    onProgress: () => {},
    signal: new AbortController().signal,
    cache: new Map(),
    executionId: 'test',
  };
}

async function runSvg(params: object): Promise<string> {
  const blob = (await barcode.run([], { outputFormat: 'svg', ...params } as Parameters<typeof barcode.run>[1], makeCtx())) as Blob;
  return blob.text();
}

// ── Metadata ──────────────────────────────────────────────────────────────────

describe('barcode — metadata', () => {
  it('has id barcode', () => expect(barcode.id).toBe('barcode'));
  it('is in create category', () => expect(barcode.category).toBe('create'));
  it('takes no file inputs', () => {
    expect(barcode.input.min).toBe(0);
    expect(barcode.input.max).toBe(0);
  });
  it('outputs image/svg+xml by default', () => expect(barcode.output.mime).toBe('image/svg+xml'));
  it('has paramSchema for all params', () => {
    expect(barcode.paramSchema?.data).toBeDefined();
    expect(barcode.paramSchema?.format).toBeDefined();
    expect(barcode.paramSchema?.outputFormat).toBeDefined();
    expect(barcode.paramSchema?.width).toBeDefined();
    expect(barcode.paramSchema?.height).toBeDefined();
    expect(barcode.paramSchema?.displayValue).toBeDefined();
  });
  it('defaults to code128 format', () => expect(barcode.defaults.format).toBe('code128'));
  it('defaults to svg output', () => expect(barcode.defaults.outputFormat).toBe('svg'));
});

// ── run() — SVG output (works in Node) ───────────────────────────────────────

describe('barcode — run() SVG', () => {
  it('generates valid SVG for Code 128', async () => {
    const svg = await runSvg({ data: 'HELLO123' });
    expect(svg).toContain('<svg');
    expect(svg).toContain('</svg>');
  });

  it('SVG contains rect elements (bars)', async () => {
    const svg = await runSvg({ data: '123456789' });
    expect(svg).toContain('<rect');
  });

  it('SVG shows text label when displayValue=true', async () => {
    const svg = await runSvg({ data: 'TEST', displayValue: true });
    expect(svg).toContain('<text');
    expect(svg).toContain('TEST');
  });

  it('SVG omits text label when displayValue=false', async () => {
    const svg = await runSvg({ data: 'NOTEXT', displayValue: false });
    expect(svg).not.toContain('<text');
  });

  it('applies custom foreground color', async () => {
    const svg = await runSvg({ data: 'COLOR', foregroundColor: '#FF0000' });
    expect(svg).toContain('#FF0000');
  });

  it('applies custom background color', async () => {
    const svg = await runSvg({ data: 'BG', backgroundColor: '#FFFF00' });
    expect(svg).toContain('#FFFF00');
  });

  it('generates Code 39 barcode', async () => {
    const svg = await runSvg({ data: 'ABC', format: 'code39' });
    expect(svg).toContain('<svg');
  });

  it('generates EAN-8 barcode', async () => {
    const svg = await runSvg({ data: '12345670', format: 'ean8' });
    expect(svg).toContain('<svg');
  });

  it('generates EAN-13 barcode', async () => {
    const svg = await runSvg({ data: '5901234123457', format: 'ean13' });
    expect(svg).toContain('<svg');
  });

  it('generates MSI barcode', async () => {
    const svg = await runSvg({ data: '1234', format: 'msi' });
    expect(svg).toContain('<svg');
  });

  it('output blob has image/svg+xml MIME type', async () => {
    const blob = (await barcode.run([], { data: 'hi', outputFormat: 'svg' } as Parameters<typeof barcode.run>[1], makeCtx())) as Blob;
    expect(blob.type).toBe('image/svg+xml');
  });

  it('throws if data is empty', async () => {
    await expect(
      barcode.run([], { data: '' } as Parameters<typeof barcode.run>[1], makeCtx()),
    ).rejects.toThrow(/data is required/);
  });

  it('throws if data is missing', async () => {
    await expect(
      barcode.run([], {} as Parameters<typeof barcode.run>[1], makeCtx()),
    ).rejects.toThrow(/data is required/);
  });

  it('respects width param by adjusting bar size', async () => {
    const svgNarrow = await runSvg({ data: 'W', width: 100 });
    const svgWide = await runSvg({ data: 'W', width: 800 });
    // wider SVG should have a larger viewBox width
    const getWidth = (svg: string): number => {
      const m = /width="(\d+)"/.exec(svg);
      return m ? parseInt(m[1]!, 10) : 0;
    };
    expect(getWidth(svgWide)).toBeGreaterThan(getWidth(svgNarrow));
  });
});

// ── PNG output guard (browser-only) ──────────────────────────────────────────

describe('barcode — PNG output in Node', () => {
  it('throws a clear error when requesting PNG in Node', async () => {
    await expect(
      barcode.run([], { data: 'PNGTEST', outputFormat: 'png' } as Parameters<typeof barcode.run>[1], makeCtx()),
    ).rejects.toThrow(/browser/i);
  });
});
