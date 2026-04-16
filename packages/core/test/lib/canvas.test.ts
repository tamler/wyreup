import { describe, it, expect } from 'vitest';
import { createCanvas, loadImage, canvasToBlob } from '../../src/lib/canvas.js';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturePath = (name: string) => join(__dirname, '..', 'fixtures', name);

describe('canvas helper', () => {
  it('createCanvas returns a canvas with expected dimensions', async () => {
    const canvas = await createCanvas(100, 50);
    expect(canvas.width).toBe(100);
    expect(canvas.height).toBe(50);
  });

  it('canvas has a 2d context', async () => {
    const canvas = await createCanvas(100, 50);
    const ctx = canvas.getContext('2d');
    expect(ctx).toBeDefined();
    expect(typeof ctx.drawImage).toBe('function');
  });

  it('loadImage loads a JPEG fixture', async () => {
    const buffer = readFileSync(fixturePath('photo.jpg'));
    const blob = new Blob([buffer], { type: 'image/jpeg' });
    const image = await loadImage(blob);
    expect(image.width).toBe(800);
    expect(image.height).toBe(600);
  });

  it('loadImage loads a PNG fixture', async () => {
    const buffer = readFileSync(fixturePath('graphic.png'));
    const blob = new Blob([buffer], { type: 'image/png' });
    const image = await loadImage(blob);
    expect(image.width).toBe(400);
    expect(image.height).toBe(400);
  });

  it('drawImage + canvasToBlob round-trips a JPEG', async () => {
    const buffer = readFileSync(fixturePath('photo.jpg'));
    const blob = new Blob([buffer], { type: 'image/jpeg' });
    const image = await loadImage(blob);
    const canvas = await createCanvas(image.width, image.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);
    const result = await canvasToBlob(canvas, 'image/png');
    expect(result.type).toBe('image/png');
    expect(result.size).toBeGreaterThan(0);
  });

  it('canvasToBlob produces a valid JPEG with quality', async () => {
    const canvas = await createCanvas(50, 50);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ff0000';
    ctx.clearRect(0, 0, 50, 50);
    const result = await canvasToBlob(canvas, 'image/jpeg', 0.8);
    expect(result.type).toBe('image/jpeg');
    expect(result.size).toBeGreaterThan(0);
    // Verify JPEG magic bytes
    const bytes = new Uint8Array(await result.arrayBuffer());
    expect(bytes[0]).toBe(0xFF);
    expect(bytes[1]).toBe(0xD8);
  });
});
