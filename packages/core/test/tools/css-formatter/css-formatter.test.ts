import { describe, it, expect } from 'vitest';
import { cssFormatter } from '../../../src/tools/css-formatter/index.js';
import type { ToolRunContext } from '../../../src/types.js';
import type { CssFormatterParams } from '../../../src/tools/css-formatter/index.js';

function makeCtx(): ToolRunContext {
  return {
    onProgress: () => {},
    signal: new AbortController().signal,
    cache: new Map(),
    executionId: 'test',
  };
}

async function run(text: string, params: CssFormatterParams = {}): Promise<string> {
  const file = new File([text], 'styles.css', { type: 'text/css' });
  const [out] = await cssFormatter.run([file], params, makeCtx()) as Blob[];
  return out!.text();
}

describe('css-formatter — metadata', () => {
  it('has id css-formatter', () => {
    expect(cssFormatter.id).toBe('css-formatter');
  });

  it('is in the dev category', () => {
    expect(cssFormatter.category).toBe('dev');
  });

  it('outputs text/css', () => {
    expect(cssFormatter.output.mime).toBe('text/css');
  });
});

describe('css-formatter — run()', () => {
  it('beautifies compact CSS', async () => {
    const input = '.foo{color:red;font-size:14px;}';
    const result = await run(input, { mode: 'beautify' });
    expect(result).toContain('\n');
    expect(result).toContain('color');
  });

  it('minifies CSS removing whitespace', async () => {
    const input = '.foo {\n  color: red;\n  font-size: 14px;\n}';
    const result = await run(input, { mode: 'minify' });
    expect(result).not.toContain('\n');
    expect(result).toContain('.foo');
    expect(result).toContain('color:red');
  });

  it('minify strips CSS comments', async () => {
    const input = '/* a comment */ .foo { color: red; }';
    const result = await run(input, { mode: 'minify' });
    expect(result).not.toContain('/*');
  });

  it('respects tabWidth for beautify', async () => {
    const input = '.foo{color:red;}';
    const result = await run(input, { mode: 'beautify', tabWidth: 4 });
    expect(result).toContain('    ');
  });

  it('defaults to beautify mode', async () => {
    const input = '.foo{color:red;}';
    const result = await run(input);
    expect(result).toContain('\n');
  });
});
