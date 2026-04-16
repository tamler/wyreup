import { describe, it, expect } from 'vitest';
import { checkIsolation } from '../check-isolation.mjs';

describe('checkIsolation', () => {
  it('passes when @wyreup/core imports nothing framework-shaped', async () => {
    const result = await checkIsolation({
      coreDir: 'packages/core/src',
      forbiddenPackages: ['astro', 'react', 'react-dom', 'preact', 'svelte', 'vue'],
    });
    expect(result.violations).toEqual([]);
    expect(result.ok).toBe(true);
  });
});
