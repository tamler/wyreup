import { expect, it } from 'vitest';
import { createDefaultRegistry } from '@wyreup/core';
import { admitToolParams, projectToolParamsSchema } from '../src/param-schema.js';

it('describes custom conditional validation without promising inactive values are ignored', async () => {
  const tool = createDefaultRegistry().toolsById.get('date-calculator');
  if (!tool) throw new Error('Actual date calculator missing.');
  const provided = {
    mode: 'add',
    date1: '2024-01-01',
    amount: 1,
    unit: 'days',
    weekend: 'invalid',
  };
  const params = admitToolParams(tool, provided);
  expect(params.weekend).toBe('invalid');
  const result = await tool.run([], params, {
    signal: new AbortController().signal,
    cache: new Map(),
    executionId: 'conditional-validation-help',
    onProgress() {},
  });
  const outputs = Array.isArray(result) ? result : [result];
  expect(outputs).toHaveLength(1);
  const output = outputs[0];
  if (!output) throw new Error('Actual date result missing.');
  expect(JSON.parse(await output.text()) as unknown).toMatchObject({
    error: 'Weekend weekdays must be unique ISO numbers from 1 to 7.',
  });
  const schema = projectToolParamsSchema(tool);
  const properties = schema.properties as Record<string, { description: string }>;
  expect(properties.weekend?.description).not.toContain('inactive values are ignored');
  expect(properties.weekend?.description).toContain(
    'core may still validate values in other modes',
  );
});

it('retains the shared validator inactive-field omission contract', () => {
  const tool = createDefaultRegistry().toolsById.get('paypal-fee-calculator');
  if (!tool) throw new Error('Actual fee calculator missing.');
  const params = admitToolParams(tool, {
    capEnabled: false,
    cap: { ignored: true },
    percent: 0,
    fixed: 0,
  });
  expect(params).not.toHaveProperty('cap');
  const schema = projectToolParamsSchema(tool);
  const properties = schema.properties as Record<string, { description: string }>;
  expect(properties.cap?.description).toContain('inactive values are ignored by core');
});
