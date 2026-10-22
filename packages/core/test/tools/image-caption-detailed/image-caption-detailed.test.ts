import { describe, expect, it } from 'vitest';
import { IMAGE_CAPTION_DETAILED_MODEL_ID } from '../../../src/tools/image-caption-detailed/index.js';

describe('image-caption-detailed model configuration', () => {
  it('uses the configured captioning model', () => {
    expect(IMAGE_CAPTION_DETAILED_MODEL_ID).toBe('Xenova/vit-gpt2-image-captioning');
  });
});
