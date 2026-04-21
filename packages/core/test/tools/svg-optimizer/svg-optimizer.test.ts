import { describe, it, expect } from 'vitest';
import { svgOptimizer } from '../../../src/tools/svg-optimizer/index.js';
import type { ToolRunContext } from '../../../src/types.js';
import type { SvgOptimizerParams } from '../../../src/tools/svg-optimizer/index.js';

function makeCtx(): ToolRunContext {
  return {
    onProgress: () => {},
    signal: new AbortController().signal,
    cache: new Map(),
    executionId: 'test',
  };
}

async function run(svg: string, params: SvgOptimizerParams = {}): Promise<string> {
  const file = new File([svg], 'input.svg', { type: 'image/svg+xml' });
  const [out] = await svgOptimizer.run([file], params, makeCtx()) as Blob[];
  return out!.text();
}

const SAMPLE_SVG = '<svg xmlns="http://www.w3.org/2000/svg"><!-- comment --><circle cx="50.123456" cy="50.123456" r="50"/></svg>';

describe('svg-optimizer — metadata', () => {
  it('has id svg-optimizer', () => {
    expect(svgOptimizer.id).toBe('svg-optimizer');
  });

  it('is in the optimize category', () => {
    expect(svgOptimizer.category).toBe('optimize');
  });

  it('accepts image/svg+xml', () => {
    expect(svgOptimizer.input.accept).toContain('image/svg+xml');
  });

  it('outputs image/svg+xml', () => {
    expect(svgOptimizer.output.mime).toBe('image/svg+xml');
  });
});

describe('svg-optimizer — run()', () => {
  it('removes comments by default', async () => {
    const result = await run(SAMPLE_SVG);
    expect(result).not.toContain('<!--');
  });

  it('rounds decimal precision', async () => {
    const result = await run(SAMPLE_SVG, { precision: 2 });
    expect(result).toContain('50.12');
    expect(result).not.toContain('50.123456');
  });

  it('keeps SVG valid XML (has svg tag)', async () => {
    const result = await run(SAMPLE_SVG);
    expect(result).toContain('<svg');
    expect(result).toContain('</svg>');
  });

  it('preserves comments when removeComments=false', async () => {
    const result = await run(SAMPLE_SVG, { removeComments: false });
    expect(result).toContain('<!--');
  });

  it('handles abort signal', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const ctx: ToolRunContext = {
      onProgress: () => {},
      signal: ctrl.signal,
      cache: new Map(),
      executionId: 'test',
    };
    const file = new File([SAMPLE_SVG], 'test.svg', { type: 'image/svg+xml' });
    await expect(svgOptimizer.run([file], {}, ctx)).rejects.toThrow('Aborted');
  });

  it('output is smaller than input for comment-heavy SVG', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><!-- A very long comment that takes up space and should be removed by the optimizer --><circle r="10"/></svg>';
    const file = new File([svg], 'input.svg', { type: 'image/svg+xml' });
    const [out] = await svgOptimizer.run([file], {}, makeCtx()) as Blob[];
    expect(out!.size).toBeLessThan(svg.length);
  });
});
