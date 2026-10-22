import { describe, expect, it } from 'vitest';
import { cronFromText, generateCronFromText } from '../../../src/tools/cron-from-text/index.js';
import type { ToolRunContext } from '../../../src/types.js';

function context(): ToolRunContext {
  return {
    signal: new AbortController().signal,
    cache: new Map(),
    executionId: 'cron-source-correction-2',
    onProgress: () => {},
  };
}

class ObservedFile extends File {
  textReads = 0;
  slices: Array<[number | undefined, number | undefined]> = [];

  override text(): Promise<string> {
    this.textReads++;
    return super.text();
  }

  override slice(start?: number, end?: number, contentType?: string): Blob {
    this.slices.push([start, end]);
    return super.slice(start, end, contentType);
  }
}

describe('cron source correction 2 — never discard unsupported schedule tokens', () => {
  it.each([
    'on the 15th at 9am',
    'every day at 9am on the 15th',
    'every 15th at 9am',
    'every monday at 9',
    'every day at 9',
    'every monday at 9:300',
    "every monday at 9 o'clock",
    "every day at 9 o'clock",
  ])('refuses %s rather than emitting a different schedule', (description) => {
    expect(generateCronFromText(description).confidence).toBe('no-match');
  });

  it('retains supported complete day-of-month and time phrases', () => {
    expect(generateCronFromText('15th of the month at 9am')).toMatchObject({
      cron: '0 9 15 * *',
      confidence: 'high',
    });
    expect(generateCronFromText('every monday at 9:30am')).toMatchObject({
      cron: '30 9 * * 1',
      confidence: 'high',
    });
  });
});

describe('cron source correction 2 — actual bounded strict file bytes', () => {
  it('rejects 4097 actual bytes despite understated metadata before trimming', async () => {
    const file = new ObservedFile(['every day at 9am'.padEnd(4097, ' ')], 'schedule.txt', {
      type: 'text/plain',
    });
    Object.defineProperty(file, 'size', { value: 1 });
    await expect(cronFromText.run([file], { mode: 'text' }, context())).rejects.toThrow(
      /4096|4\s*KiB|exceed|large|limit/i,
    );
    expect(file.textReads).toBe(0);
    expect(file.slices).toEqual([[0, 4097]]);
  });

  it('rejects malformed UTF8 instead of accepting replacement text', async () => {
    const prefix = new TextEncoder().encode('every day at 9am ');
    const bytes = new Uint8Array(prefix.length + 1);
    bytes.set(prefix);
    bytes[prefix.length] = 0xc3;
    const file = new ObservedFile([bytes], 'invalid-utf8.txt', { type: 'text/plain' });
    await expect(cronFromText.run([file], { mode: 'text' }, context())).rejects.toThrow();
    expect(file.textReads).toBe(0);
    expect(file.slices).toEqual([[0, 4097]]);
  });

  it('accepts the exact 4096-byte boundary without changing the schedule', async () => {
    const file = new File(['every day at 9am'.padEnd(4096, ' ')], 'boundary.txt', {
      type: 'text/plain',
    });
    const output = await cronFromText.run([file], { mode: 'text' }, context());
    expect(Array.isArray(output)).toBe(true);
    const blob = Array.isArray(output) ? output[0] : output;
    if (!blob) throw new Error('Missing cron result.');
    const result: unknown = JSON.parse(await blob.text());
    expect(result).toMatchObject({ cron: '0 9 * * *', confidence: 'high' });
  });
});
