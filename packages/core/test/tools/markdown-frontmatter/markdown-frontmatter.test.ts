import { describe, it, expect } from 'vitest';
import { extractFrontmatter } from '../../../src/tools/markdown-frontmatter/index.js';

describe('markdown-frontmatter — extractFrontmatter()', () => {
  it('strips a pathological TOML comment in under one second', async () => {
    const input = `+++\n${'#'.repeat(100_000)}\n+++\nbody`;
    const start = performance.now();
    const result = await extractFrontmatter(input, 'toml');

    expect(result.frontmatter).toEqual({});
    expect(result.body).toBe('body');
    expect(performance.now() - start).toBeLessThan(1_000);
  });
});
