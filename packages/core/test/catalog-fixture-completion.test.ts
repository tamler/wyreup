import { expect, it } from 'vitest';
import {
  romanNumeral,
  htmlMinify,
  cssMinify,
  yamlValidate,
  colorHarmony,
  type ToolRunContext,
} from '../src/index.js';

const context = (): ToolRunContext => ({
  signal: new AbortController().signal,
  cache: new Map(),
  executionId: 'supplemental-independent-literals',
  onProgress() {},
});

it('supplemental roman-encode', async () => {
  const inputs: File[] = [];
  const params = { mode: 'encode', input: '4,9,2026' } as const;
  const outputs = await romanNumeral.run(inputs, params, context());
  if (!Array.isArray(outputs)) throw new Error('Expected ordered outputs.');
  expect(outputs).toHaveLength(1);
  expect(outputs[0]!.type).toBe('application/json');
  expect(JSON.parse(await outputs[0]!.text())).toEqual({
    mode: 'encode',
    results: [
      { arabic: 4, roman: 'IV' },
      { arabic: 9, roman: 'IX' },
      { arabic: 2026, roman: 'MMXXVI' },
    ],
    errors: [],
  });
});

it('supplemental roman-decode', async () => {
  const inputs: File[] = [];
  const params = { mode: 'decode', input: 'IV,IX,MMXXVI' } as const;
  const outputs = await romanNumeral.run(inputs, params, context());
  if (!Array.isArray(outputs)) throw new Error('Expected ordered outputs.');
  expect(outputs).toHaveLength(1);
  expect(outputs[0]!.type).toBe('application/json');
  expect(JSON.parse(await outputs[0]!.text())).toEqual({
    mode: 'decode',
    results: [
      { arabic: 4, roman: 'IV' },
      { arabic: 9, roman: 'IX' },
      { arabic: 2026, roman: 'MMXXVI' },
    ],
    errors: [],
  });
});

it('supplemental html-remove-comments', async () => {
  const inputs = [new File(['<p>Hello</p><!--x-->'], 'case.html', { type: 'text/html' })];
  const params = {
    removeComments: true,
    collapseWhitespace: false,
    removeRedundantAttributes: false,
    minifyCss: false,
    minifyJs: false,
    removeEmptyAttributes: false,
    useShortDoctype: false,
  };
  const outputs = await htmlMinify.run(inputs, params, context());
  if (!Array.isArray(outputs)) throw new Error('Expected ordered outputs.');
  expect(outputs).toHaveLength(2);
  expect(outputs[0]!.type).toBe('text/html');
  expect(await outputs[0]!.text()).toBe('<p>Hello</p>');
  expect(outputs[1]!.type).toBe('application/json');
  expect(JSON.parse(await outputs[1]!.text())).toEqual({
    bytesIn: 20,
    bytesOut: 12,
    reductionPercent: 40,
  });
});

it('supplemental html-preserve-comments', async () => {
  const inputs = [new File(['<p>Hello</p><!--x-->'], 'case.html', { type: 'text/html' })];
  const params = {
    removeComments: false,
    collapseWhitespace: false,
    removeRedundantAttributes: false,
    minifyCss: false,
    minifyJs: false,
    removeEmptyAttributes: false,
    useShortDoctype: false,
  };
  const outputs = await htmlMinify.run(inputs, params, context());
  if (!Array.isArray(outputs)) throw new Error('Expected ordered outputs.');
  expect(outputs).toHaveLength(2);
  expect(outputs[0]!.type).toBe('text/html');
  expect(await outputs[0]!.text()).toBe('<p>Hello</p><!--x-->');
  expect(outputs[1]!.type).toBe('application/json');
  expect(JSON.parse(await outputs[1]!.text())).toEqual({
    bytesIn: 20,
    bytesOut: 20,
    reductionPercent: 0,
  });
});

it('supplemental css-level-one', async () => {
  const inputs = [new File(['a { color: red; }'], 'case.css', { type: 'text/css' })];
  const params = { level: 1, inlineImports: false } as const;
  const outputs = await cssMinify.run(inputs, params, context());
  if (!Array.isArray(outputs)) throw new Error('Expected ordered outputs.');
  expect(outputs).toHaveLength(2);
  expect(outputs[0]!.type).toBe('text/css');
  expect(await outputs[0]!.text()).toBe('a{color:red}');
  expect(outputs[1]!.type).toBe('application/json');
  expect(JSON.parse(await outputs[1]!.text())).toEqual({
    bytesIn: 17,
    bytesOut: 12,
    reductionPercent: 29.41,
    warnings: [],
    errors: [],
  });
});

it('supplemental yaml-core', async () => {
  const inputs = [new File(['a: 1\n'], 'case.yaml', { type: 'text/yaml' })];
  const params = { schema: 'core', rejectDuplicateKeys: true } as const;
  const outputs = await yamlValidate.run(inputs, params, context());
  if (!Array.isArray(outputs)) throw new Error('Expected ordered outputs.');
  expect(outputs).toHaveLength(1);
  expect(outputs[0]!.type).toBe('application/json');
  expect(JSON.parse(await outputs[0]!.text())).toEqual({
    valid: true,
    parsed: { a: 1 },
    summary: { type: 'object', topKeys: ['a'] },
  });
});

it('supplemental yaml-json', async () => {
  const inputs = [new File(['a: 1\n'], 'case.yaml', { type: 'text/yaml' })];
  const params = { schema: 'json', rejectDuplicateKeys: true } as const;
  const outputs = await yamlValidate.run(inputs, params, context());
  if (!Array.isArray(outputs)) throw new Error('Expected ordered outputs.');
  expect(outputs).toHaveLength(1);
  expect(outputs[0]!.type).toBe('application/json');
  expect(JSON.parse(await outputs[0]!.text())).toEqual({
    valid: true,
    parsed: { a: 1 },
    summary: { type: 'object', topKeys: ['a'] },
  });
});

it('supplemental yaml-failsafe', async () => {
  const inputs = [new File(['a: 1\n'], 'case.yaml', { type: 'text/yaml' })];
  const params = { schema: 'failsafe', rejectDuplicateKeys: true } as const;
  const outputs = await yamlValidate.run(inputs, params, context());
  if (!Array.isArray(outputs)) throw new Error('Expected ordered outputs.');
  expect(outputs).toHaveLength(1);
  expect(outputs[0]!.type).toBe('application/json');
  expect(JSON.parse(await outputs[0]!.text())).toEqual({
    valid: true,
    parsed: { a: '1' },
    summary: { type: 'object', topKeys: ['a'] },
  });
});

it('supplemental harmony-black', async () => {
  const inputs: File[] = [];
  const params = { color: '#000' };
  const outputs = await colorHarmony.run(inputs, params, context());
  if (!Array.isArray(outputs)) throw new Error('Expected ordered outputs.');
  expect(outputs).toHaveLength(1);
  expect(outputs[0]!.type).toBe('application/json');
  expect(JSON.parse(await outputs[0]!.text())).toEqual({
    base: '#000000',
    schemes: {
      complementary: ['#000000', '#000000'],
      analogous: ['#000000', '#000000', '#000000'],
      triadic: ['#000000', '#000000', '#000000'],
      tetradic: ['#000000', '#000000', '#000000', '#000000'],
      'split-complementary': ['#000000', '#000000', '#000000'],
      monochromatic: ['#000000', '#000000', '#000000', '#262626', '#4d4d4d'],
    },
  });
});

it('supplemental harmony-red-partial', async () => {
  const inputs: File[] = [];
  const params = { color: '#ff0000' };
  const outputs = await colorHarmony.run(inputs, params, context());
  if (!Array.isArray(outputs)) throw new Error('Expected ordered outputs.');
  expect(outputs).toHaveLength(1);
  expect(outputs[0]!.type).toBe('application/json');
  expect(JSON.parse(await outputs[0]!.text())).toMatchObject({
    base: '#ff0000',
    schemes: { complementary: ['#ff0000', '#00ffff'] },
  });
});
