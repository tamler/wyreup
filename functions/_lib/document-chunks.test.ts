import { describe, expect, it } from 'vitest';
import { __chunkDocumentText } from './runners';

describe('document translation chunks', () => {
  it('chunks on paragraph boundaries without losing content', () => {
    const text = `${'a'.repeat(30)}\n\n${'b'.repeat(30)}\n\n${'c'.repeat(30)}`;
    const chunks = __chunkDocumentText(text, 45);
    expect(chunks.every((chunk) => chunk.length <= 45)).toBe(true);
    expect(chunks[0]).toBe(`${'a'.repeat(30)}\n\n`);
    expect(chunks.join('')).toBe(text);
  });

  it('does not create a whitespace-only chunk at an exact hard boundary', () => {
    const text = `${'a'.repeat(45)}\n\n${'b'.repeat(60)}`;
    const chunks = __chunkDocumentText(text, 45);
    expect(chunks.every((chunk) => chunk.trim().length > 0)).toBe(true);
    expect(chunks.every((chunk) => chunk.length <= 45)).toBe(true);
    expect(chunks.join('')).toBe(text);
  });
});
