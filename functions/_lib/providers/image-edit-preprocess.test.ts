import { describe, expect, it, vi } from 'vitest';
import { prepareImageForEditing } from './image-edit-preprocess';

function png(width: number, height: number): Uint8Array {
  const data = new Uint8Array(24);
  data.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
  data.set([0, 0, 0, 13, 73, 72, 68, 82], 8);
  const view = new DataView(data.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return data;
}

function mockBinding(bytes = png(320, 240)) {
  const info = vi.fn()
    .mockResolvedValueOnce({ format: 'image/jpeg', fileSize: 3, width: 640, height: 480 })
    .mockResolvedValueOnce({ format: 'image/png', fileSize: bytes.length, width: 320, height: 240 });
  const response = vi.fn(() => new Response(bytes.slice().buffer, { headers: { 'content-type': 'image/png' } }));
  const output = vi.fn(() => Promise.resolve({ response }));
  const transform = vi.fn(() => ({ output }));
  const input = vi.fn(() => ({ transform }));
  return { binding: { info, input }, info, input, transform, output, response };
}

describe('isolated Images binding preprocessor', () => {
  it('requests a bounded scale-down and still PNG, and checks returned info and header', async () => {
    const fixture = mockBinding();
    const result = await prepareImageForEditing(fixture.binding, new Uint8Array([1, 2, 3]));
    expect(result).toEqual({ bytes: png(320, 240), mime: 'image/png', width: 320, height: 240 });
    expect(fixture.info).toHaveBeenCalledTimes(2);
    expect(fixture.transform).toHaveBeenCalledWith({ width: 511, height: 511, fit: 'scale-down' });
    expect(fixture.output).toHaveBeenCalledWith({ format: 'image/png', anim: false });
  });

  it.each([
    [{ format: 'image/svg+xml' }, 'Invalid image info'],
    [{ format: 'image/gif', fileSize: 1, width: 10, height: 10 }, 'Unsupported input image'],
    [{ format: 'image/jpeg', fileSize: 1, width: 0, height: 10 }, 'Invalid image info'],
    [{ format: 'image/jpeg', fileSize: 1, width: 12001, height: 10 }, 'Unsupported input image'],
    [{ format: 'image/jpeg', fileSize: 1, width: 11000, height: 11000 }, 'Unsupported input image'],
    [{ format: 'image/jpeg', fileSize: 2, width: 10, height: 10 }, 'Invalid image info'],
  ])('rejects unsupported or out-of-range source info %# before transformation', async (source, error) => {
    const fixture = mockBinding();
    fixture.info.mockReset().mockResolvedValueOnce(source);
    await expect(prepareImageForEditing(fixture.binding, new Uint8Array([1]))).rejects.toThrow(error);
    expect(fixture.input).not.toHaveBeenCalled();
  });

  it('rejects mismatched returned dimensions and PNG header', async () => {
    const fixture = mockBinding();
    fixture.info.mockReset()
      .mockResolvedValueOnce({ format: 'image/jpeg', fileSize: 1, width: 640, height: 480 })
      .mockResolvedValueOnce({ format: 'image/png', fileSize: 24, width: 321, height: 240 });
    await expect(prepareImageForEditing(fixture.binding, new Uint8Array([1]))).rejects.toThrow('Transformed image dimensions disagree');
  });

  it('rejects a height mismatch between reported info and the PNG header', async () => {
    const fixture = mockBinding();
    fixture.info.mockReset()
      .mockResolvedValueOnce({ format: 'image/jpeg', fileSize: 1, width: 640, height: 480 })
      .mockResolvedValueOnce({ format: 'image/png', fileSize: 24, width: 320, height: 241 });
    await expect(prepareImageForEditing(fixture.binding, new Uint8Array([1]))).rejects.toThrow('Transformed image dimensions disagree');
  });

  it.each([
    [{ format: 'image/jpeg', fileSize: 24, width: 320, height: 240 }, 'Unsupported transformed image'],
    [{ format: 'image/png', fileSize: 24, width: 512, height: 240 }, 'Unsupported transformed image'],
    [{ format: 'image/png', fileSize: 25, width: 320, height: 240 }, 'Invalid image info'],
  ])('rejects invalid transformed metadata %#', async (outputInfo, error) => {
    const fixture = mockBinding();
    fixture.info.mockReset()
      .mockResolvedValueOnce({ format: 'image/jpeg', fileSize: 1, width: 640, height: 480 })
      .mockResolvedValueOnce(outputInfo);
    await expect(prepareImageForEditing(fixture.binding, new Uint8Array([1]))).rejects.toThrow(error);
  });

  it('rejects bytes with a spoofed PNG header even when output info claims a PNG', async () => {
    const bytes = png(320, 240);
    bytes[0] = 0;
    const fixture = mockBinding(bytes);
    fixture.info.mockReset()
      .mockResolvedValueOnce({ format: 'image/jpeg', fileSize: 1, width: 640, height: 480 })
      .mockResolvedValueOnce({ format: 'image/png', fileSize: bytes.length, width: 320, height: 240 });
    await expect(prepareImageForEditing(fixture.binding, new Uint8Array([1]))).rejects.toThrow('Invalid transformed PNG');
  });

  it('rejects a multi-chunk stream over the cap and cancels the reader', async () => {
    const fixture = mockBinding();
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(1024 * 1024));
        controller.enqueue(new Uint8Array(1024 * 1024 + 1));
      },
      cancel,
    });
    fixture.response.mockReturnValueOnce(new Response(stream, { headers: { 'content-type': 'image/png' } }));
    await expect(prepareImageForEditing(fixture.binding, new Uint8Array([1, 2, 3])))
      .rejects.toThrow('Transformed image exceeds limit');
    expect(fixture.info).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid input byte counts without binding work', async () => {
    const fixture = mockBinding();
    await expect(prepareImageForEditing(fixture.binding, new Uint8Array())).rejects.toThrow('Invalid input image size');
    await expect(prepareImageForEditing(fixture.binding, new Uint8Array(5 * 1024 * 1024 + 1))).rejects.toThrow('Invalid input image size');
    expect(fixture.info).not.toHaveBeenCalled();
  });

  it.each([
    [500, 'image/png', 'Invalid image transform response'],
    [200, 'image/jpeg', 'Invalid image transform response'],
  ])('rejects bad response status or content type %# and cancels its body', async (status, contentType, error) => {
    const fixture = mockBinding();
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ cancel });
    fixture.response.mockReturnValueOnce(new Response(stream, { status, headers: { 'content-type': contentType } }));
    await expect(prepareImageForEditing(fixture.binding, new Uint8Array([1, 2, 3]))).rejects.toThrow(error);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(fixture.info).toHaveBeenCalledTimes(1);
  });

  it('rejects null response body and short output with exact errors', async () => {
    const empty = mockBinding();
    empty.response.mockReturnValueOnce(new Response(null, { headers: { 'content-type': 'image/png' } }));
    await expect(prepareImageForEditing(empty.binding, new Uint8Array([1, 2, 3])))
      .rejects.toThrow('Empty image transform response');
    const short = mockBinding(new Uint8Array(23));
    await expect(prepareImageForEditing(short.binding, new Uint8Array([1, 2, 3])))
      .rejects.toThrow('Invalid transformed PNG');
  });

  it('rejects a content-length over the cap before reading and cancels the body', async () => {
    const fixture = mockBinding();
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ cancel });
    fixture.response.mockReturnValueOnce(new Response(stream, {
      headers: { 'content-type': 'image/png', 'content-length': String(2 * 1024 * 1024 + 1) },
    }));
    await expect(prepareImageForEditing(fixture.binding, new Uint8Array([1, 2, 3])))
      .rejects.toThrow('Transformed image exceeds limit');
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(fixture.info).toHaveBeenCalledTimes(1);
  });

  it('propagates binding rejections without continuing the pipeline', async () => {
    const infoFailure = mockBinding();
    infoFailure.info.mockReset().mockRejectedValueOnce(new Error('info failed'));
    await expect(prepareImageForEditing(infoFailure.binding, new Uint8Array([1])))
      .rejects.toThrow('info failed');
    expect(infoFailure.input).not.toHaveBeenCalled();
    const outputFailure = mockBinding();
    outputFailure.output.mockRejectedValueOnce(new Error('output failed'));
    await expect(prepareImageForEditing(outputFailure.binding, new Uint8Array([1, 2, 3])))
      .rejects.toThrow('output failed');
    expect(outputFailure.info).toHaveBeenCalledTimes(1);
  });

  it('accepts configured byte and dimension boundaries in the mock contract', async () => {
    const output = new Uint8Array(2 * 1024 * 1024);
    output.set(png(511, 511));
    const fixture = mockBinding(output);
    fixture.info.mockReset()
      .mockResolvedValueOnce({ format: 'image/jpeg', fileSize: 5 * 1024 * 1024, width: 12000, height: 100 })
      .mockResolvedValueOnce({ format: 'image/png', fileSize: output.length, width: 511, height: 511 });
    const result = await prepareImageForEditing(fixture.binding, new Uint8Array(5 * 1024 * 1024));
    expect(result.bytes.length).toBe(2 * 1024 * 1024);
    expect(result.width).toBe(511);
    expect(result.height).toBe(511);
  });
});
