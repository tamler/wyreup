import { expect, it } from 'vitest';
import { createDefaultRegistry } from '@wyreup/core';
import { mergeToolParams, toolParamHelp } from '../src/lib/tool-params.js';
import { admitToolParams, projectToolParamsSchema } from '../../mcp/src/param-schema.js';

it('documents and executes the actual slash-relative redirect destination on both adapters', async () => {
  const tool = createDefaultRegistry().toolsById.get('nginx-redirect-generator');
  if (!tool) throw new Error('Actual public redirect generator missing.');
  const schema = projectToolParamsSchema(tool);
  const properties = schema.properties as Record<string, { description: string }>;
  for (const help of [toolParamHelp(tool, 'redirectsJson'), properties.redirectsJson?.description])
    expect(help).toContain('slash-leading relative path');
  const provided = { redirectsJson: '[{"source":"/old","destination":"/new","status":301}]' };
  for (const params of [mergeToolParams(tool, provided, [], {}), admitToolParams(tool, provided)]) {
    const result = await tool.run([], params, {
      signal: new AbortController().signal, cache: new Map(),
      executionId: 'documented-relative-redirect', onProgress() {},
    });
    const outputs = Array.isArray(result) ? result : [result];
    expect(outputs).toHaveLength(1);
    const output = outputs[0];
    if (!output) throw new Error('Actual redirect output missing.');
    expect(output.type).toBe('text/plain');
    expect(await output.text()).toBe('location = /old { return 301 "/new"; }\n');
  }
});
