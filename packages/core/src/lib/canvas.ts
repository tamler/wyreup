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
    sx: number, sy: number, sw: number, sh: number,
    dx: number, dy: number, dw: number, dh: number,
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
  return new (globalThis as unknown as { OffscreenCanvas: new (w: number, h: number) => CanvasLike }).OffscreenCanvas(width, height);
}

/**
 * Load an image blob into an object that can be passed to drawImage().
 */
export async function loadImage(blob: Blob): Promise<ImageLike> {
  if (isNode()) {
    const nc = await getNodeCanvas();
    const buffer = Buffer.from(await blob.arrayBuffer());
    return (await nc.loadImage(buffer)) as unknown as ImageLike;
  }
  // Browser: createImageBitmap is natively available.
  return (await createImageBitmap(blob)) as unknown as ImageLike;
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
    const buffer = (canvas as unknown as {
      toBuffer(mime: string, options?: { quality?: number }): Buffer;
    }).toBuffer(mime, quality !== undefined ? { quality } : undefined);
    return new Blob([new Uint8Array(buffer)], { type: mime });
  }
  return await (canvas as unknown as {
    convertToBlob(options: { type: string; quality?: number }): Promise<Blob>;
  }).convertToBlob({ type: mime, quality });
}
