import { expect, it } from 'vitest';
import {
  aspectRatioCalculator,
  hardwareTools,
  loremIpsum,
  passwordGenerator,
  planningTools,
  uuidGenerator,
  type ToolRunContext,
} from '../src/index.js';

const context = (): ToolRunContext => ({
  signal: new AbortController().signal,
  cache: new Map(),
  executionId: 'group-bc-independent-properties',
  onProgress() {},
});

function publicTool(tools: typeof hardwareTools, id: string) {
  const matches = tools.filter((tool) => tool.id === id);
  if (matches.length !== 1) throw new Error('Expected exactly one public tool.');
  return matches[0]!;
}

function close(actual: unknown, expected: number) {
  expect(typeof actual).toBe('number');
  expect(Math.abs((actual as number) - expected)).toBeLessThanOrEqual(
    1e-9 * Math.max(1, Math.abs(expected)),
  );
}

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

it('group-bc aspect-ratio-calculator', async () => {
  const inputs: File[] = [];
  const params = { width: '1920', height: '1080' };
  const outputs = await aspectRatioCalculator.run(inputs, params, context());
  if (!Array.isArray(outputs)) throw new Error('Expected ordered outputs.');
  expect(outputs).toHaveLength(1);
  expect(outputs[0]!.type).toBe('application/json');
  expect(JSON.parse(await outputs[0]!.text())).toMatchObject({ ratio: '16:9' });
});

it('group-bc tv-viewing-distance-calculator', async () => {
  const inputs: File[] = [];
  const params = { diagonalIn: 5, aspectWidth: 4, aspectHeight: 3, horizontalFovDeg: 90 };
  const outputs = await publicTool(hardwareTools, 'tv-viewing-distance-calculator').run(inputs, params, context());
  if (!Array.isArray(outputs)) throw new Error('Expected ordered outputs.');
  expect(outputs).toHaveLength(1);
  expect(outputs[0]!.type).toBe('application/json');
  const result = JSON.parse(await outputs[0]!.text()) as Record<string, unknown>;
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('Expected JSON object.');
  expect(result).toMatchObject({ widthIn: 4, heightIn: 3, referenceDistanceIn: 4.5 });
  close(result.geometricFovDistanceIn, 2);
});

it('group-bc random-number-generator', async () => {
  const inputs: File[] = [];
  const params = { min: -500, max: 499, count: 1000, unique: true };
  const outputs = await publicTool(planningTools, 'random-number-generator').run(inputs, params, context());
  if (!Array.isArray(outputs)) throw new Error('Expected ordered outputs.');
  expect(outputs).toHaveLength(1);
  expect(outputs[0]!.type).toBe('application/json');
  const result = JSON.parse(await outputs[0]!.text()) as Record<string, unknown>;
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('Expected JSON object.');
  const values = result.values as number[];
  if (!Array.isArray(values)) throw new Error('Expected values array.');
  expect([...values].sort((a, b) => a - b)).toEqual(Array.from({ length: 1000 }, (_, i) => i - 500));
});

it('group-bc dice-roller', async () => {
  const inputs: File[] = [];
  const params = { count: 100, modifier: -1 };
  const outputs = await publicTool(planningTools, 'dice-roller').run(inputs, params, context());
  if (!Array.isArray(outputs)) throw new Error('Expected ordered outputs.');
  expect(outputs).toHaveLength(1);
  expect(outputs[0]!.type).toBe('application/json');
  const result = JSON.parse(await outputs[0]!.text()) as Record<string, unknown>;
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('Expected JSON object.');
  const values = result.values as number[];
  if (!Array.isArray(values)) throw new Error('Expected values array.');
  expect(values.every((v) => Number.isInteger(v) && v >= 1 && v <= 6)).toBe(true);
  expect(result.total).toBe(values.reduce((a, b) => a + b, 0) - 1);
});

it('group-bc coin-flip', async () => {
  const inputs: File[] = [];
  const params = { count: 1000 };
  const outputs = await publicTool(planningTools, 'coin-flip').run(inputs, params, context());
  if (!Array.isArray(outputs)) throw new Error('Expected ordered outputs.');
  expect(outputs).toHaveLength(1);
  expect(outputs[0]!.type).toBe('application/json');
  const result = JSON.parse(await outputs[0]!.text()) as Record<string, unknown>;
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('Expected JSON object.');
  expect(Number(result.heads) + Number(result.tails)).toBe(1000);
  expect(result.values).toHaveLength(1000);
  expect(typeof result.longestStreak).toBe('number');
  expect(result.longestStreak).toBeGreaterThan(0);
});

it('group-bc lorem-ipsum', async () => {
  const inputs: File[] = [];
  const params = { paragraphs: 1 };
  const outputs = await loremIpsum.run(inputs, params, context());
  if (!Array.isArray(outputs)) throw new Error('Expected ordered outputs.');
  expect(outputs).toHaveLength(1);
  expect(outputs[0]!.type).toBe('text/plain');
  const text = await outputs[0]!.text();
  const paragraphs = text.split('\n\n').filter((p) => p.trim().length > 0);
  expect(paragraphs.length).toBe(1);
});

it('group-bc password-generator', async () => {
  const inputs: File[] = [];
  const params = { length: 24 };
  const outputs = await passwordGenerator.run(inputs, params, context());
  if (!Array.isArray(outputs)) throw new Error('Expected ordered outputs.');
  expect(outputs).toHaveLength(1);
  expect(outputs[0]!.type).toBe('text/plain');
  const password = await outputs[0]!.text();
  expect(password.length).toBe(24);
});

it('group-bc uuid-generator', async () => {
  const inputs: File[] = [];
  const params = { version: 4, count: 1 } as const;
  const outputs = await uuidGenerator.run(inputs, params, context());
  if (!Array.isArray(outputs)) throw new Error('Expected ordered outputs.');
  expect(outputs).toHaveLength(1);
  expect(outputs[0]!.type).toBe('text/plain');
  const uuid = (await outputs[0]!.text()).trim();
  expect(uuid).toMatch(UUID_V4_RE);
});
