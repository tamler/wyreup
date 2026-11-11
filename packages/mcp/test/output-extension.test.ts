import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { extFromMime } from '../src/server.js';
import { isInlineTextMime, workerExtFromMime } from '../src/output-types.js';

describe('MCP inline text and worker output names', () => {
  it('returns SRT inline like other text instead of refusing it after a paid run', () => {
    expect(isInlineTextMime('application/x-subrip')).toBe(true);
    expect(isInlineTextMime('text/vtt')).toBe(true);
    expect(isInlineTextMime('application/json')).toBe(true);
    expect(isInlineTextMime('image/png')).toBe(false);
  });

  it('names worker output_dir files by subtitle format', () => {
    expect(workerExtFromMime('application/x-subrip')).toBe('.srt');
    expect(workerExtFromMime('text/vtt')).toBe('.vtt');
    expect(workerExtFromMime('image/png')).toBe('.png');
    expect(workerExtFromMime('application/x-unknown')).toBe('.bin');
  });

  it('is what the worker and the in-process chain actually use', () => {
    const worker = readFileSync(new URL('../src/worker.ts', import.meta.url), 'utf8');
    expect(worker).toMatch(/isInlineTextMime\(/);
    expect(worker).toMatch(/workerExtFromMime\(/);
    const server = readFileSync(new URL('../src/server.ts', import.meta.url), 'utf8');
    expect(server).toMatch(/isInlineTextMime\(/);
    expect(server).not.toMatch(/blob\.type\.startsWith\('text\/'\) \|\| blob\.type === 'application\/json'/);
  });
});

describe('MCP output file extensions', () => {
  it('names subtitle output by its format', () => {
    expect(extFromMime('application/x-subrip')).toBe('.srt');
    expect(extFromMime('text/vtt')).toBe('.vtt');
    expect(extFromMime('image/png')).toBe('.png');
    expect(extFromMime('application/x-unknown')).toBe('.bin');
  });
});
