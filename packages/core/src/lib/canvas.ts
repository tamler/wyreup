/**
 * Cross-platform canvas helper. Dispatches to OffscreenCanvas in browsers
 * and @napi-rs/canvas in Node. Tools use this module to do canvas-based
 * image operations (resize, watermark, pdf rendering) without caring about
 * which environment they're in.
 *
 * Browser path uses only native Web APIs.
 * Node path lazy-loads @napi-rs/canvas on first call.
 */

import type * as NapiCanvas from '@napi-rs/canvas';
import { getCodec } from './codecs.js';

// Minimal structural types. Both OffscreenCanvas and @napi-rs/canvas's Canvas
// satisfy these shapes at runtime.
export interface CanvasLike {
  width: number;
  height: number;
  getContext(type: '2d'): CanvasContext2DLike;
}

export interface CanvasContext2DLike {
  drawImage(image: ImageLike, dx: number, dy: number): void;
  drawImage(image: ImageLike, dx: number, dy: number, dw: number, dh: number): void;
  drawImage(
    image: ImageLike,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ): void;
  fillText(text: string, x: number, y: number): void;
  measureText(text: string): { width: number };
  font: string;
  fillStyle: string;
  globalAlpha: number;
  save(): void;
  restore(): void;
  translate(x: number, y: number): void;
  rotate(radians: number): void;
  clearRect(x: number, y: number, w: number, h: number): void;
  putImageData(
    imageData: { width: number; height: number; data: Uint8ClampedArray },
    dx: number,
    dy: number,
  ): void;
}

export interface ImageLike {
  width: number;
  height: number;
}

function isNode(): boolean {
  return typeof process !== 'undefined' && typeof process.versions?.node === 'string';
}

let nodeCanvasModule: typeof NapiCanvas | null = null;

async function getNodeCanvas() {
  if (!nodeCanvasModule) {
    nodeCanvasModule = await import('@napi-rs/canvas');
  }
  return nodeCanvasModule;
}

/**
 * Create a new blank canvas of the given dimensions.
 */
export async function createCanvas(width: number, height: number): Promise<CanvasLike> {
  if (isNode()) {
    const nc = await getNodeCanvas();
    return nc.createCanvas(width, height) as unknown as CanvasLike;
  }
  return new (
    globalThis as unknown as { OffscreenCanvas: new (w: number, h: number) => CanvasLike }
  ).OffscreenCanvas(width, height);
}

/**
 * Load an image blob into an object that can be passed to drawImage().
 */
export async function loadImage(blob: Blob): Promise<ImageLike> {
  if (isNode()) {
    const nc = await getNodeCanvas();
    const buffer = Buffer.from(await blob.arrayBuffer());
    return await nc.loadImage(buffer);
  }
  // Browser: createImageBitmap is natively available.
  return await createImageBitmap(blob);
}

/**
 * Convert a canvas to a Blob of the given MIME type.
 * In Node, uses @napi-rs/canvas's toBuffer().
 * In browser, uses OffscreenCanvas's convertToBlob().
 */
export async function canvasToBlob(
  canvas: CanvasLike,
  mime: string,
  quality?: number,
): Promise<Blob> {
  if (isNode()) {
    const buffer = (
      canvas as unknown as {
        toBuffer(mime: string, options?: { quality?: number }): Buffer;
      }
    ).toBuffer(mime, quality !== undefined ? { quality } : undefined);
    return new Blob([new Uint8Array(buffer)], { type: mime });
  }
  return await (
    canvas as unknown as {
      convertToBlob(options: { type: string; quality?: number }): Promise<Blob>;
    }
  ).convertToBlob({ type: mime, quality });
}

function ownedRgba(data: Uint8ClampedArray): data is Uint8ClampedArray<ArrayBuffer> {
  return (
    data.buffer instanceof ArrayBuffer &&
    !(data.buffer as ArrayBuffer & { resizable?: boolean }).resizable
  );
}

export async function rgbaToPng(
  width: number,
  height: number,
  data: Uint8ClampedArray,
  signal?: AbortSignal,
): Promise<Blob> {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > 8192 ||
    height > 8192 ||
    width * height > 16000000 ||
    !(data instanceof Uint8ClampedArray) ||
    data.length !== width * height * 4
  )
    throw new Error('Invalid bounded RGBA image.');
  if (signal?.aborted) throw new Error('Image encoding cancelled.');
  if (!ownedRgba(data)) throw new Error('RGBA image requires an owned ArrayBuffer.');
  // The codec consumes the entire buffer; give subviews their own buffer.
  // Encode straight RGBA rather than losing low-alpha RGB through a canvas.
  const rgba =
    data.byteOffset === 0 && data.byteLength === data.buffer.byteLength
      ? data
      : new Uint8ClampedArray(data);
  const codec = await getCodec('png');
  if (signal?.aborted) throw new Error('Image encoding cancelled.');
  if (data.length !== width * height * 4 || rgba.length !== width * height * 4)
    throw new Error('RGBA image buffer was detached.');
  const encoded = await codec.encode({ data: rgba, width, height }, { bitDepth: 8 });
  if (signal?.aborted) throw new Error('Image encoding cancelled.');
  if (!(encoded instanceof ArrayBuffer) || encoded.byteLength < 33)
    throw new Error('Invalid PNG output.');
  if (encoded.byteLength > 96 * 1024 * 1024) throw new Error('PNG output exceeds 96 MiB.');
  const bytes = new Uint8Array(encoded);
  const header = new DataView(encoded);
  if (
    ![137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte) ||
    header.getUint32(8) !== 13 ||
    header.getUint32(12) !== 0x49484452 ||
    header.getUint32(16) !== width ||
    header.getUint32(20) !== height ||
    bytes[24] !== 8 ||
    ![0, 2, 4, 6].includes(bytes[25]!)
  )
    throw new Error('PNG header does not match the RGBA image.');
  return new Blob([bytes], { type: 'image/png' });
}
