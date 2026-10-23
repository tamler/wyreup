import { describe, expect, it } from 'vitest';
import { stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { WHISPER_DTYPE } from '../../../src/tools/transcribe/index.js';

describe('transcribe model configuration', () => {
  it('pins both encoder names and preserves the merged decoder dtype', () => {
    expect(WHISPER_DTYPE).toEqual({
      model: 'q8',
      encoder_model: 'q8',
      decoder_model_merged: 'fp32',
    });
  });

  it('selects matching registry and runtime dtypes with the installed helper', async () => {
    const entry = createRequire(import.meta.url).resolve('@huggingface/transformers');
    const dtypePath = resolve(dirname(entry), '../src/utils/dtypes.js');
    expect((await stat(dtypePath)).isFile()).toBe(true);
    const { selectDtype } = (await import(pathToFileURL(dtypePath).href)) as {
      selectDtype: (dtype: typeof WHISPER_DTYPE, fileName: string, device: string) => string;
    };

    for (const device of ['cpu', 'wasm', 'webgpu']) {
      expect
        .soft(selectDtype(WHISPER_DTYPE, 'model', device), `registry encoder (${device})`)
        .toBe('q8');
      expect
        .soft(selectDtype(WHISPER_DTYPE, 'encoder_model', device), `runtime encoder (${device})`)
        .toBe('q8');
      expect
        .soft(selectDtype(WHISPER_DTYPE, 'decoder_model_merged', device), `decoder (${device})`)
        .toBe('fp32');
    }
  });
});
