import { describe, expect, it } from 'vitest';
import { extFromMime } from '../src/server.js';

describe('MCP output file extensions', () => {
  it('names subtitle output by its format', () => {
    expect(extFromMime('application/x-subrip')).toBe('.srt');
    expect(extFromMime('text/vtt')).toBe('.vtt');
    expect(extFromMime('image/png')).toBe('.png');
    expect(extFromMime('application/x-unknown')).toBe('.bin');
  });
});
