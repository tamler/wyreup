import { describe, it, expect } from 'vitest';
import { cronParser } from '../../../src/tools/cron-parser/index.js';
import type { ToolRunContext } from '../../../src/types.js';
import type { CronParserResult } from '../../../src/tools/cron-parser/index.js';

function makeCtx(): ToolRunContext {
  return {
    onProgress: () => {},
    signal: new AbortController().signal,
    cache: new Map(),
    executionId: 'test',
  };
}

async function run(expression: string, nextCount?: number): Promise<CronParserResult> {
  const file = new File([expression], 'cron.txt', { type: 'text/plain' });
  const [out] = await cronParser.run([file], { nextCount }, makeCtx()) as Blob[];
  return JSON.parse(await out!.text()) as CronParserResult;
}

describe('cron-parser — metadata', () => {
  it('has id cron-parser', () => {
    expect(cronParser.id).toBe('cron-parser');
  });

  it('is in the dev category', () => {
    expect(cronParser.category).toBe('dev');
  });

  it('outputs application/json', () => {
    expect(cronParser.output.mime).toBe('application/json');
  });
});

describe('cron-parser — run()', () => {
  it('parses a valid cron expression', async () => {
    const result = await run('*/5 * * * *', 3);
    expect(result.valid).toBe(true);
    expect(result.nextRuns).toHaveLength(3);
  });

  it('next runs are valid ISO 8601 timestamps', async () => {
    const result = await run('0 0 * * *', 2);
    expect(result.valid).toBe(true);
    for (const ts of result.nextRuns) {
      expect(() => new Date(ts)).not.toThrow();
      expect(new Date(ts).toISOString()).toBe(ts);
    }
  });

  it('returns correct minute field for */5', async () => {
    const result = await run('*/5 * * * *');
    expect(result.fields.minute).toContain(0);
    expect(result.fields.minute).toContain(5);
    expect(result.fields.minute).toContain(55);
  });

  it('returns valid:false for invalid expression', async () => {
    const result = await run('invalid cron expression');
    expect(result.valid).toBe(false);
    expect(result.error).toBeTruthy();
    expect(result.nextRuns).toHaveLength(0);
  });

  it('defaults to 5 next runs', async () => {
    const result = await run('* * * * *');
    expect(result.nextRuns).toHaveLength(5);
  });

  it('stores the original expression', async () => {
    const result = await run('0 9 * * 1-5');
    expect(result.expression).toBe('0 9 * * 1-5');
  });
});
