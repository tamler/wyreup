import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../env';
import {
  editPhoto,
  imageDimensions,
  photoEditOutputSize,
  PHOTO_EDIT_MODEL,
} from './photo-edit-models';
import { prepareProRun, runPro } from '../runners';

function png(width: number, height: number): Uint8Array {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13], 0);
  b.set([0x49, 0x48, 0x44, 0x52], 12);
  new DataView(b.buffer).setUint32(16, width);
  new DataView(b.buffer).setUint32(20, height);
  return b;
}

function jpeg(width: number, height: number): Uint8Array {
  // SOI, APP0 (length 16), SOF0 (length 17) with height then width.
  const zeros = (n: number): number[] => Array.from({ length: n }, () => 0);
  const app0 = [0xff, 0xe0, 0x00, 0x10, ...zeros(14)];
  const sof = [0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 255, width >> 8, width & 255];
  return new Uint8Array([0xff, 0xd8, ...app0, ...sof, ...zeros(12)]);
}

function webpVp8x(width: number, height: number): Uint8Array {
  const b = new Uint8Array(30);
  b.set(
    [...'RIFF'].map((c) => c.charCodeAt(0)),
    0,
  );
  b.set(
    [...'WEBPVP8X'].map((c) => c.charCodeAt(0)),
    8,
  );
  const w = width - 1;
  const h = height - 1;
  b.set([w & 255, (w >> 8) & 255, (w >> 16) & 255, h & 255, (h >> 8) & 255, (h >> 16) & 255], 24);
  return b;
}

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const OUTPUT_JPEG_B64 = b64(jpeg(1024, 768));

function aiEnv(result: unknown) {
  return mockAi(result).env;
}

function mockAi(result: unknown) {
  const run = vi.fn().mockResolvedValue(result);
  return { env: { AI: { run } } as unknown as Env, run };
}

describe('imageDimensions', () => {
  it('reads PNG, JPEG and WebP headers', () => {
    expect(imageDimensions(png(640, 480))).toEqual({ width: 640, height: 480 });
    expect(imageDimensions(jpeg(300, 200))).toEqual({ width: 300, height: 200 });
    expect(imageDimensions(webpVp8x(512, 384))).toEqual({ width: 512, height: 384 });
  });

  it('returns null for unreadable bytes', () => {
    expect(imageDimensions(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(
      imageDimensions(new Uint8Array([0xff, 0xd8, 0x00, 0x00, 0, 0, 0, 0, 0, 0, 0])),
    ).toBeNull();
  });
});

describe('photoEditOutputSize', () => {
  it.each([
    [
      { width: 512, height: 512 },
      { width: 1024, height: 1024 },
    ],
    [
      { width: 512, height: 384 },
      { width: 1024, height: 768 },
    ],
    [
      { width: 300, height: 512 },
      { width: 608, height: 1024 },
    ],
    [
      { width: 1, height: 1 },
      { width: 1024, height: 1024 },
    ],
    [
      { width: 512, height: 10 },
      { width: 1024, height: 256 },
    ],
  ])('maps %o to %o within 1024 and multiples of 16', (input, expected) => {
    const out = photoEditOutputSize(input);
    expect(out).toEqual(expected);
    expect(out.width % 16).toBe(0);
    expect(out.height % 16).toBe(0);
  });
});

describe('editPhoto', () => {
  it('sends one reference image and the output size as multipart form data', async () => {
    const { env, run } = mockAi({ image: OUTPUT_JPEG_B64 });
    const out = await editPhoto(env, { image: png(512, 384), prompt: 'Colorize this photo' });
    expect(out).toEqual({
      contentType: 'image/jpeg',
      base64: OUTPUT_JPEG_B64,
      width: 1024,
      height: 768,
    });
    expect(run).toHaveBeenCalledTimes(1);
    const [model, payload] = run.mock.calls[0] as [
      string,
      { multipart: { body: ReadableStream; contentType: string } },
    ];
    expect(model).toBe(PHOTO_EDIT_MODEL);
    expect(payload.multipart.contentType).toMatch(/^multipart\/form-data; boundary=/);
    const form = await new Response(payload.multipart.body, {
      headers: { 'content-type': payload.multipart.contentType },
    }).formData();
    expect(form.get('prompt')).toBe('Colorize this photo');
    expect(form.get('width')).toBe('1024');
    expect(form.get('height')).toBe('768');
    expect(form.get('input_image_0')).toBeInstanceOf(Blob);
    expect(form.has('input_image_1')).toBe(false);
  });

  it('rejects a model response without an image', async () => {
    await expect(editPhoto(aiEnv({}), { image: png(64, 64), prompt: 'x' })).rejects.toThrow(
      'returned no image',
    );
    await expect(
      editPhoto(aiEnv({ image: 'AAAAAAAAAAAAAAAAAAAA' }), { image: png(64, 64), prompt: 'x' }),
    ).rejects.toThrow('unrecognized image format');
  });
});

describe('photo-edit-pro runner', () => {
  it('rejects an image over 512px before provider work', () => {
    const { env, run } = mockAi({ image: OUTPUT_JPEG_B64 });
    expect(() =>
      prepareProRun('photo-edit-pro', { imageBase64: b64(png(513, 200)), prompt: 'x' }, env),
    ).toThrow('at most 512px');
    expect(() =>
      prepareProRun('photo-edit-pro', { imageBase64: b64(jpeg(200, 1024)), prompt: 'x' }, env),
    ).toThrow('at most 512px');
    expect(run).not.toHaveBeenCalled();
  });

  it('rejects a missing or overlong prompt before provider work', () => {
    const { env, run } = mockAi({ image: OUTPUT_JPEG_B64 });
    const imageBase64 = b64(png(256, 256));
    expect(() => prepareProRun('photo-edit-pro', { imageBase64, prompt: '  ' }, env)).toThrow();
    expect(() =>
      prepareProRun('photo-edit-pro', { imageBase64, prompt: 'x'.repeat(1001) }, env),
    ).toThrow('exceeds 1000');
    expect(run).not.toHaveBeenCalled();
  });

  it('returns the edited image', async () => {
    const env = aiEnv({ image: OUTPUT_JPEG_B64 });
    const out = await runPro(
      'photo-edit-pro',
      { imageBase64: b64(png(512, 512)), prompt: 'Remove the lamp post' },
      env,
    );
    expect(out).toMatchObject({ contentType: 'image/jpeg', width: 1024, height: 1024 });
  });
});
