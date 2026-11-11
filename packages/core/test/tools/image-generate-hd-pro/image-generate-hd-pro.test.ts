import { describe, expect, it } from 'vitest';
import { createDefaultRegistry } from '../../../src/default-registry.js';
import {
  defaultImageGenerateHdProParams,
  imageGenerateHdPro,
} from '../../../src/tools/image-generate-hd-pro/index.js';
import type { ToolRunContext } from '../../../src/types.js';

function makeCtx(): ToolRunContext {
  return {
    onProgress: () => {},
    signal: new AbortController().signal,
    cache: new Map(),
    executionId: 'image-generate-hd-pro-test',
  };
}

describe('image-generate-hd-pro', () => {
  it('is registered as a two-credit text prompt tool beside the 1-credit generator', () => {
    const registry = createDefaultRegistry();
    const tool = registry.toolsById.get('image-generate-hd-pro');

    expect(tool).toBeDefined();
    expect(tool?.cost).toBe('credit');
    expect(tool?.creditCost).toBe(2);
    expect(tool?.input.accept).toEqual(['text/plain']);
    expect(registry.toolsById.get('image-generate-pro')?.creditCost).toBe(1);
  });

  it('offers only the four sizes the server accepts, square by default', () => {
    const aspect = imageGenerateHdPro.paramSchema?.aspect;
    expect(aspect?.type).toBe('enum');
    const values = aspect && aspect.type === 'enum' ? aspect.options.map((o) => o.value) : [];
    expect(values).toEqual(['square', 'landscape', 'portrait', 'wide']);
    expect(defaultImageGenerateHdProParams.aspect).toBe('square');
  });

  it('keeps its copy honest about cost and limits, with no em dashes', () => {
    expect(imageGenerateHdPro.description).toContain('Uses 2 credits per run.');
    expect(imageGenerateHdPro.description).toContain('2,000 characters');
    expect(imageGenerateHdPro.description).not.toMatch(/[—–]/);
  });

  it('rejects an empty prompt before any hosted call', async () => {
    const input = new File(['   '], 'prompt.txt', { type: 'text/plain' });
    await expect(
      imageGenerateHdPro.run([input], defaultImageGenerateHdProParams, makeCtx()),
    ).rejects.toThrow('Prompt is empty.');
  });

  it('rejects a prompt over 2,000 characters before any hosted call', async () => {
    const input = new File(['a'.repeat(2001)], 'prompt.txt', { type: 'text/plain' });
    await expect(
      imageGenerateHdPro.run([input], defaultImageGenerateHdProParams, makeCtx()),
    ).rejects.toThrow('Prompt is too long');
  });
});
