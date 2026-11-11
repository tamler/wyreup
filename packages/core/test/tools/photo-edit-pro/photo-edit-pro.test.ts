import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { createDefaultRegistry } from '../../../src/default-registry.js';
import {
  buildPhotoEditPrompt,
  photoEditPro,
  PHOTO_EDIT_INPUT_SIDE,
} from '../../../src/tools/photo-edit-pro/index.js';
import type { ToolRunContext } from '../../../src/types.js';

function makeCtx(): ToolRunContext {
  return {
    onProgress: () => {},
    signal: new AbortController().signal,
    cache: new Map(),
    executionId: 'photo-edit-pro-test',
    apiKey: 'wk_test_fake',
    proOrigin: 'https://example.test',
  };
}

function photo(width: number, height: number, type: 'image/png' | 'image/jpeg'): File {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, width, height);
  const buf = type === 'image/png' ? canvas.toBuffer('image/png') : canvas.toBuffer('image/jpeg');
  return new File([new Uint8Array(buf)], type === 'image/png' ? 'in.png' : 'in.jpg', { type });
}

afterEach(() => vi.unstubAllGlobals());

describe('photo-edit-pro', () => {
  it('is registered as a one-credit image tool', () => {
    const tool = createDefaultRegistry().toolsById.get('photo-edit-pro');
    expect(tool?.cost).toBe('credit');
    expect(tool?.creditCost).toBe(1);
    expect(tool?.input.accept).toEqual(['image/jpeg', 'image/png', 'image/webp']);
  });

  it('builds prompts from quick actions', () => {
    expect(buildPhotoEditPrompt({ edit: 'remove', prompt: 'the red car' })).toMatch(
      /^Remove the red car from the photo\./,
    );
    expect(buildPhotoEditPrompt({ edit: 'colorize' })).toMatch(/^Colorize this black and white/);
    expect(buildPhotoEditPrompt({ edit: 'restore', prompt: 'the coat is navy' })).toMatch(
      /the coat is navy$/,
    );
    expect(buildPhotoEditPrompt({ edit: 'custom', prompt: '  make it snow  ' })).toBe(
      'make it snow',
    );
  });

  it('requires text for remove and custom, and caps its length', () => {
    expect(() => buildPhotoEditPrompt({ edit: 'remove', prompt: ' ' })).toThrow(/what to remove/);
    expect(() => buildPhotoEditPrompt({ edit: 'custom' })).toThrow(/Describe the edit/);
    expect(() => buildPhotoEditPrompt({ edit: 'custom', prompt: 'x'.repeat(601) })).toThrow(
      /under 600/,
    );
  });

  it('keeps every built prompt within the server cap', () => {
    for (const edit of ['remove', 'colorize', 'restore', 'custom'] as const) {
      expect(buildPhotoEditPrompt({ edit, prompt: 'x'.repeat(600) }).length).toBeLessThanOrEqual(
        1000,
      );
    }
  });

  it.each([
    [2000, 1000, 'image/jpeg', 512, 256],
    [300, 900, 'image/png', 171, 512],
    [200, 100, 'image/jpeg', 200, 100],
  ] as const)(
    'scales a %ix%i %s to fit 512 before upload',
    async (w, h, type, expectW, expectH) => {
      let sent: { toolId: string; input: { imageBase64: string; prompt: string } } | undefined;
      vi.stubGlobal(
        'fetch',
        vi.fn((_url: string, init: RequestInit) => {
          sent = JSON.parse(init.body as string) as typeof sent;
          return Promise.resolve(
            new Response(
              JSON.stringify({ result: { contentType: 'image/jpeg', base64: btoa('jpegbytes') } }),
              { status: 200, headers: { 'content-type': 'application/json' } },
            ),
          );
        }),
      );
      const out = (await photoEditPro.run(
        [photo(w, h, type)],
        { edit: 'colorize', prompt: '' },
        makeCtx(),
      )) as Blob;
      expect(out.type).toBe('image/jpeg');
      expect(sent?.toolId).toBe('photo-edit-pro');
      const uploaded = await loadImage(Buffer.from(sent!.input.imageBase64, 'base64'));
      expect(Math.max(uploaded.width, uploaded.height)).toBeLessThanOrEqual(PHOTO_EDIT_INPUT_SIDE);
      expect([uploaded.width, uploaded.height]).toEqual([expectW, expectH]);
    },
  );
});
