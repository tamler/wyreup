import { describe, it, expect } from 'vitest';
import { loremIpsum } from '../../../src/tools/lorem-ipsum/index.js';
import type { ToolRunContext } from '../../../src/types.js';

function makeCtx(): ToolRunContext {
  return {
    onProgress: () => {},
    signal: new AbortController().signal,
    cache: new Map(),
    executionId: 'test',
  };
}

async function generate(params: Parameters<typeof loremIpsum.run>[1]): Promise<string> {
  const [out] = await loremIpsum.run([], params, makeCtx());
  return out!.text();
}

describe('lorem-ipsum — metadata', () => {
  it('has id lorem-ipsum', () => {
    expect(loremIpsum.id).toBe('lorem-ipsum');
  });

  it('is in the create category', () => {
    expect(loremIpsum.category).toBe('create');
  });

  it('requires no file input (min 0)', () => {
    expect(loremIpsum.input.min).toBe(0);
  });
});

describe('lorem-ipsum — run()', () => {
  it('generates the correct number of paragraphs (default 3)', async () => {
    const text = await generate({});
    const paragraphs = text.split('\n\n').filter((p) => p.trim().length > 0);
    expect(paragraphs.length).toBe(3);
  });

  it('generates custom paragraph count', async () => {
    const text = await generate({ paragraphs: 5 });
    const paragraphs = text.split('\n\n').filter((p) => p.trim().length > 0);
    expect(paragraphs.length).toBe(5);
  });

  it('starts with "Lorem ipsum" when startWithLorem is true (default)', async () => {
    const text = await generate({ startWithLorem: true });
    expect(text.startsWith('Lorem ipsum')).toBe(true);
  });

  it('does NOT start with "Lorem ipsum" when startWithLorem is false', async () => {
    // Run several times to account for randomness
    for (let i = 0; i < 3; i++) {
      const text = await generate({ startWithLorem: false });
      expect(text.startsWith('Lorem ipsum dolor sit amet, consectetur adipiscing elit.')).toBe(false);
    }
  });

  it('output MIME type is text/plain', async () => {
    const [out] = await loremIpsum.run([], {}, makeCtx());
    expect(out!.type).toBe('text/plain');
  });

  it('generates non-empty output', async () => {
    const text = await generate({ paragraphs: 1, sentencesPerParagraph: 3 });
    expect(text.trim().length).toBeGreaterThan(0);
  });

  it('generates 1 paragraph when requested', async () => {
    const text = await generate({ paragraphs: 1 });
    const paragraphs = text.split('\n\n').filter((p) => p.trim().length > 0);
    expect(paragraphs.length).toBe(1);
  });

  it('throws when paragraphs > 1000', async () => {
    await expect(loremIpsum.run([], { paragraphs: 1001 }, makeCtx())).rejects.toThrow('paragraphs must be between');
  });

  it('throws when sentencesPerParagraph > 100', async () => {
    await expect(loremIpsum.run([], { sentencesPerParagraph: 101 }, makeCtx())).rejects.toThrow('sentencesPerParagraph must be between');
  });

  it('throws when wordsPerSentence max > 100', async () => {
    await expect(loremIpsum.run([], { wordsPerSentence: [5, 101] }, makeCtx())).rejects.toThrow('wordsPerSentence max must be <= 100');
  });
});
