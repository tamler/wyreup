import { describe, expect, it } from 'vitest';
import { WHISPER_DTYPE } from '../../../src/tools/transcribe/index.js';

describe('transcribe model configuration', () => {
  it('addresses the Seq2Seq encoder by its Transformers.js session key', () => {
    expect(WHISPER_DTYPE).toEqual({
      model: 'q8',
      decoder_model_merged: 'fp32',
    });
    expect(WHISPER_DTYPE).not.toHaveProperty('encoder_model');
  });
});
