import { describe, it, expect } from 'vitest';
import { xmlFormatter } from '../../../src/tools/xml-formatter/index.js';
import type { ToolRunContext } from '../../../src/types.js';
import type { XmlFormatterParams } from '../../../src/tools/xml-formatter/index.js';

function makeCtx(): ToolRunContext {
  return {
    onProgress: () => {},
    signal: new AbortController().signal,
    cache: new Map(),
    executionId: 'test',
  };
}

async function run(text: string, params: XmlFormatterParams = {}): Promise<string> {
  const file = new File([text], 'input.xml', { type: 'text/xml' });
  const [out] = await xmlFormatter.run([file], params, makeCtx()) as Blob[];
  return out!.text();
}

const SAMPLE_XML = '<?xml version="1.0"?><root><child>hello</child><other attr="x">world</other></root>';

describe('xml-formatter — metadata', () => {
  it('has id xml-formatter', () => {
    expect(xmlFormatter.id).toBe('xml-formatter');
  });

  it('is in the dev category', () => {
    expect(xmlFormatter.category).toBe('dev');
  });

  it('outputs text/xml', () => {
    expect(xmlFormatter.output.mime).toBe('text/xml');
  });
});

describe('xml-formatter — run()', () => {
  it('beautifies XML with indentation', async () => {
    const result = await run(SAMPLE_XML, { mode: 'beautify' });
    expect(result).toContain('<child>');
    expect(result).toContain('\n');
    // Each child on its own line
    expect(result.split('\n').length).toBeGreaterThan(2);
  });

  it('minifies XML removing whitespace between tags', async () => {
    const spaced = '<root>\n  <child>hello</child>\n  <other>world</other>\n</root>';
    const result = await run(spaced, { mode: 'minify' });
    expect(result).not.toContain('\n  ');
    expect(result).toBe('<root><child>hello</child><other>world</other></root>');
  });

  it('minify strips XML comments', async () => {
    const xml = '<root><!-- comment --><item>val</item></root>';
    const result = await run(xml, { mode: 'minify' });
    expect(result).not.toContain('<!--');
  });

  it('respects indent parameter for beautify', async () => {
    const result = await run(SAMPLE_XML, { mode: 'beautify', indent: 4 });
    expect(result).toContain('    ');
  });

  it('defaults to beautify mode', async () => {
    const result = await run(SAMPLE_XML);
    expect(result.split('\n').length).toBeGreaterThan(2);
  });
});
