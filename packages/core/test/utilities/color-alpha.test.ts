import { expect, it } from 'vitest';
import { colorConverter } from '../../src/tools/color-converter/index.js';
const convert = async (text: string) => {
  const artifacts = await colorConverter.run([new File([text], 'color.txt')], {}, {
    signal: new AbortController().signal, cache: new Map(), executionId: 'color-alpha', onProgress() {},
  });
  return JSON.parse(await (Array.isArray(artifacts) ? artifacts[0]! : artifacts).text()) as Record<string, unknown>;
};
it('retains alpha in numeric fields and the advanced CSS source', async () => {
  const result = await convert('rgba(255, 0, 0, 0.5)');
  expect(result).toMatchObject({ alpha: 0.5, rgb: { a: 0.5 }, hsl: { a: 0.5 }, opaquePickerHex: '#ff0000' });
  expect(result.oklchString).toMatch(/\/ 0\.5\)/);
  expect(result.input).toBe('rgba(255, 0, 0, 0.5)');
});
it('labels wide-gamut approximation separately from the original input', async () => {
  const result = await convert('color(display-p3 1 0 0)');
  expect(result).toMatchObject({ valid: true, gamut: 'outside-srgb', alpha: 1,
    input: 'color(display-p3 1 0 0)' });
  expect(result.opaquePickerHex).toMatch(/^#[0-9a-f]{6}$/);
});
