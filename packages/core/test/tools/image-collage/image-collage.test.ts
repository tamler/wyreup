import { describe, it, expect } from 'vitest';
import { imageCollage } from '../../../src/tools/image-collage/index.js';
import type { ImageCollageParams } from '../../../src/tools/image-collage/types.js';
import type { ToolRunContext } from '../../../src/types.js';
import { getCodec } from '../../../src/lib/codecs.js';
import { loadFixture } from '../../lib/load-fixture.js';

function makeCtx(): ToolRunContext {
  return {
    onProgress: () => {},
    signal: new AbortController().signal,
    cache: new Map(),
    executionId: 'test',
  };
}

function params(overrides: Partial<ImageCollageParams> = {}): ImageCollageParams {
  return {
    layout: 'grid',
    columns: 2,
    spacing: 8,
    background: '#ffffff',
    format: 'png',
    quality: 90,
    ...overrides,
  };
}

describe('image-collage — metadata', () => {
  it('declares the collage input and output contract', () => {
    expect(imageCollage.id).toBe('image-collage');
    expect(imageCollage.slug).toBe('image-collage');
    expect(imageCollage.category).toBe('edit');
    expect(imageCollage.input.accept).toEqual([
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/webp',
    ]);
    expect(imageCollage.input.min).toBe(2);
    expect(imageCollage.input.max).toBe(20);
    expect(imageCollage.cost).toBe('free');
  });
});

describe('image-collage — run()', () => {
  it('collages two fixtures horizontally into one image wider than either input', async () => {
    const photo = loadFixture('photo.jpg', 'image/jpeg');
    const graphic = loadFixture('graphic.png', 'image/png');
    const jpegCodec = await getCodec('jpeg');
    const pngCodec = await getCodec('png');
    const [photoImage, graphicImage] = await Promise.all([
      jpegCodec.decode(await photo.arrayBuffer()),
      pngCodec.decode(await graphic.arrayBuffer()),
    ]);

    const output = (await imageCollage.run(
      [photo, graphic],
      params({ layout: 'horizontal', spacing: 8 }),
      makeCtx(),
    )) as Blob;
    const collage = await pngCodec.decode(await output.arrayBuffer());

    expect(output.type).toBe('image/png');
    expect(collage.width).toBeGreaterThan(photoImage.width);
    expect(collage.width).toBeGreaterThan(graphicImage.width);
  });

  it('lays out three images in a two-column grid', async () => {
    const photo = loadFixture('photo.jpg', 'image/jpeg');
    const graphic = loadFixture('graphic.png', 'image/png');
    const output = (await imageCollage.run(
      [photo, graphic, photo],
      params({ layout: 'grid', columns: 2, spacing: 0 }),
      makeCtx(),
    )) as Blob;
    const collage = await (await getCodec('png')).decode(await output.arrayBuffer());

    expect(collage.width).toBe(1600);
    expect(collage.height).toBe(1600);
  });

  it('fills spacing gaps with the selected background color', async () => {
    const photo = loadFixture('photo.jpg', 'image/jpeg');
    const graphic = loadFixture('graphic.png', 'image/png');
    const output = (await imageCollage.run(
      [photo, graphic],
      params({ layout: 'horizontal', spacing: 10, background: '#123456' }),
      makeCtx(),
    )) as Blob;
    const collage = await (await getCodec('png')).decode(await output.arrayBuffer());
    const gapOffset = (Math.floor(collage.height / 2) * collage.width + 805) * 4;

    expect(Array.from(collage.data.slice(gapOffset, gapOffset + 4))).toEqual([18, 52, 86, 255]);
  });

  it('throws when fewer than two inputs are provided', async () => {
    const photo = loadFixture('photo.jpg', 'image/jpeg');

    await expect(imageCollage.run([photo], params(), makeCtx())).rejects.toThrow(/2.*20|two/i);
  });
});
