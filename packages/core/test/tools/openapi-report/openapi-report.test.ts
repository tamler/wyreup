import { describe, it, expect } from 'vitest';
import { openapiReport } from '../../../src/tools/openapi-report/index.js';
import type { ToolRunContext } from '../../../src/types.js';

function makeCtx(): ToolRunContext {
  return {
    onProgress: () => {},
    signal: new AbortController().signal,
    cache: new Map(),
    executionId: 'test',
  };
}

const MINIMAL_SPEC = JSON.stringify({
  openapi: '3.0.0',
  info: { title: 'Test API', version: '1.0.0' },
  paths: {
    '/ping': {
      get: { responses: { '200': { description: 'ok' } } },
    },
  },
});

describe('openapi-report — metadata', () => {
  it('has id openapi-report and is free', () => {
    expect(openapiReport.id).toBe('openapi-report');
    expect(openapiReport.cost).toBe('free');
  });
});

describe('openapi-report — run()', () => {
  it('produces a Markdown report with result and stats', async () => {
    const file = new File([MINIMAL_SPEC], 'spec.json', { type: 'application/json' });
    const [md] = (await openapiReport.run([file], { strict: false }, makeCtx())) as Blob[];
    const text = await md!.text();
    expect(text).toContain('# OpenAPI Validation Report');
    expect(text).toContain('**Result:**');
    expect(text).toContain('**Paths:** 1');
  });

  it('rejects unparseable JSON', async () => {
    const file = new File(['{ not json'], 'spec.json', { type: 'application/json' });
    await expect(openapiReport.run([file], { strict: false }, makeCtx())).rejects.toThrow(/parse/i);
  });

  it('replaces carriage returns in Markdown table cells', async () => {
    const spec = JSON.stringify({
      openapi: '3.0.0',
      info: { title: 'Test API', version: '1.0.0' },
      paths: { 'bad\rpath': {} },
    });
    const file = new File([spec], 'spec.json', { type: 'application/json' });
    const [md] = (await openapiReport.run([file], { strict: false }, makeCtx())) as Blob[];
    const text = await md!.text();
    expect(text).toContain("$.paths['bad path']");
    expect(text).not.toContain('\r');
  });
});
