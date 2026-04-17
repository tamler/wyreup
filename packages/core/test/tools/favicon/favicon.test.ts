import { describe, it, expect } from 'vitest';
import { favicon } from '../../../src/tools/favicon/index.js';
import type { ToolRunContext } from '../../../src/types.js';
import { loadFixture } from '../../lib/load-fixture.js';

function makeCtx(): ToolRunContext {
  return {
    onProgress: () => {},
    signal: new AbortController().signal,
    cache: new Map(),
    executionId: 'test',
  };
}

describe('favicon — metadata', () => {
  it('has id favicon', () => {
    expect(favicon.id).toBe('favicon');
  });

  it('is in the create category', () => {
    expect(favicon.category).toBe('create');
  });

  it('accepts jpeg, png, webp', () => {
    expect(favicon.input.accept).toContain('image/jpeg');
    expect(favicon.input.accept).toContain('image/png');
    expect(favicon.input.accept).toContain('image/webp');
  });

  it('allows only 1 input', () => {
    expect(favicon.input.min).toBe(1);
    expect(favicon.input.max).toBe(1);
  });

  it('outputs application/zip', () => {
    expect(favicon.output.mime).toBe('application/zip');
  });
});

describe('favicon — run()', () => {
  it('generates a zip from a PNG image', async () => {
    const input = loadFixture('graphic.png', 'image/png');
    const output = await favicon.run([input], {}, makeCtx()) as Blob;
    expect(output.type).toBe('application/zip');
    expect(output.size).toBeGreaterThan(0);
  });

  it('zip contains expected favicon PNG files', async () => {
    const input = loadFixture('graphic.png', 'image/png');
    const output = await favicon.run([input], { sizes: [16, 32, 48] }, makeCtx()) as Blob;

    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(await output.arrayBuffer());
    const files = Object.keys(zip.files);

    expect(files).toContain('favicon-16.png');
    expect(files).toContain('favicon-32.png');
    expect(files).toContain('favicon-48.png');
  });

  it('zip contains site.webmanifest', async () => {
    const input = loadFixture('graphic.png', 'image/png');
    const output = await favicon.run([input], { sizes: [192, 512] }, makeCtx()) as Blob;

    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(await output.arrayBuffer());
    expect(Object.keys(zip.files)).toContain('site.webmanifest');
  });

  it('zip contains favicon.ico when includeIco is true', async () => {
    const input = loadFixture('graphic.png', 'image/png');
    const output = await favicon.run([input], { sizes: [16, 32, 48], includeIco: true }, makeCtx()) as Blob;

    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(await output.arrayBuffer());
    expect(Object.keys(zip.files)).toContain('favicon.ico');
  });

  it('ICO starts with 0x00 0x00 0x01 0x00', async () => {
    const input = loadFixture('graphic.png', 'image/png');
    const output = await favicon.run([input], { sizes: [16, 32, 48], includeIco: true }, makeCtx()) as Blob;

    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(await output.arrayBuffer());
    const icoBuf = await zip.files['favicon.ico']!.async('arraybuffer');
    const bytes = new Uint8Array(icoBuf);

    expect(bytes[0]).toBe(0x00);
    expect(bytes[1]).toBe(0x00);
    expect(bytes[2]).toBe(0x01);
    expect(bytes[3]).toBe(0x00);
  });

  it('omits ICO when includeIco is false', async () => {
    const input = loadFixture('graphic.png', 'image/png');
    const output = await favicon.run([input], { sizes: [16, 32], includeIco: false }, makeCtx()) as Blob;

    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(await output.arrayBuffer());
    expect(Object.keys(zip.files)).not.toContain('favicon.ico');
  });
});
