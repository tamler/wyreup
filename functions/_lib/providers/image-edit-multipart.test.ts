import { describe, expect, it } from 'vitest';
import { encodeImageEditMultipart } from './image-edit-multipart';

describe('image editing multipart preparation', () => {
  it('encodes exactly one image and a fixed-size candidate request without contacting a provider', async () => {
    const image = new Uint8Array([1, 2, 3]);
    const encoded = encodeImageEditMultipart({ image, mime: 'image/png', prompt: 'Remove the chair' });
    expect(encoded.contentType).toMatch(/^multipart\/form-data; boundary=/);
    const form = await new Response(encoded.body, { headers: { 'content-type': encoded.contentType } }).formData();
    const keys: string[] = [];
    form.forEach((_value, key) => keys.push(key));
    expect(keys.sort()).toEqual(['height', 'input_image_0', 'prompt', 'width']);
    expect(form.get('prompt')).toBe('Remove the chair');
    expect(form.get('width')).toBe('512');
    expect(form.get('height')).toBe('512');
    const file = form.get('input_image_0');
    expect(file).toBeInstanceOf(File);
    if (!(file instanceof File)) throw new Error('Missing image part');
    expect(file.name).toBe('image');
    expect(file.type).toBe('image/png');
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(image);
  });

  it('rejects empty and oversize input and instructions', () => {
    expect(() => encodeImageEditMultipart({ image: new Uint8Array(), mime: 'image/png', prompt: 'edit' })).toThrow();
    expect(() => encodeImageEditMultipart({ image: new Uint8Array(5 * 1024 * 1024 + 1), mime: 'image/png', prompt: 'edit' })).toThrow();
    expect(() => encodeImageEditMultipart({ image: new Uint8Array([1]), mime: 'image/png', prompt: ' ' })).toThrow();
    expect(() => encodeImageEditMultipart({ image: new Uint8Array([1]), mime: 'image/png', prompt: '龘'.repeat(334) })).toThrow();
  });
});
