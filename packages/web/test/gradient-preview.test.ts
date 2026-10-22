import { describe, expect, it } from 'vitest';
import { cssGradient } from '../../core/src/utilities/text-developer.js';
import {
  opaquePickerValue,
  pickerGradientParams,
  prepareGradientResult,
} from '../src/components/runners/gradientPreview';

const css = 'linear-gradient(90deg, rgba(255, 0, 0, 0.5) 10%, rgba(0, 0, 255, 1) 90%)';
describe('gradient output safety and source-preserving picker projection', () => {
  it('actual core result preserves alpha and creates opaque picker approximations', async () => {
    const result = await cssGradient({
      color1: 'color(srgb 1 0 0 / 0.5)',
      color2: '#0000ff',
      angle: 90,
      stop1: 10,
      stop2: 90,
    });
    expect(result).toEqual({ css });
    expect(prepareGradientResult(JSON.stringify(result))).toEqual({
      css,
      firstPickerHex: '#ff0000',
      secondPickerHex: '#0000ff',
    });
  });
  it('accepts actual finite exponent-form angles and stops', async () => {
    const result = await cssGradient({
      color1: '#ff0000',
      color2: '#0000ff',
      angle: 0.0000001,
      stop1: 0.0000002,
      stop2: 100,
    });
    expect(prepareGradientResult(JSON.stringify(result)).css).toBe(
      'linear-gradient(1e-7deg, rgba(255, 0, 0, 1) 2e-7%, rgba(0, 0, 255, 1) 100%)',
    );
  });
  it('explicit picker replacement preserves every other parameter and original object', () => {
    const params = {
      color1: 'color(srgb 1 0 0 / 0.5)',
      color2: 'rgba(0, 0, 255, 0.25)',
      angle: 210,
      stop1: 10,
      stop2: 90,
    };
    expect(pickerGradientParams(params, 'color1', '#00FF00')).toEqual({
      ...params,
      color1: '#00ff00',
    });
    expect(params.color1).toBe('color(srgb 1 0 0 / 0.5)');
    expect(pickerGradientParams(params, 'color2', '#008000').color1).toBe(params.color1);
  });
  it('returns only a literal opaque hex or explicit neutral default for ungenerated text', () => {
    expect(opaquePickerValue('#AAbb00')).toBe('#aabb00');
    expect(opaquePickerValue('color(display-p3 1 0 0)')).toBe('#000000');
    expect(() => pickerGradientParams({}, 'color1', 'red')).toThrow('opaque');
  });
  it.each([
    'url(https://example.com/image.png)',
    'linear-gradient(90deg, red, blue)',
    css + '; background-image:url(https://example.com/)',
    css.replace('255, 0, 0', '256, 0, 0'),
    css.replace('0, 0, 255', '0, 0, 1.5'),
    css.replace('0.5)', '1.5)'),
    css.replace('90deg', '361deg'),
    css.replace('10%', '91%'),
  ])('rejects resource syntax or invalid output components %j', (value) => {
    expect(() => prepareGradientResult(JSON.stringify({ css: value }))).toThrow();
  });
  it('rejects malformed/unknown/prototype/oversized output data', () => {
    expect(() => prepareGradientResult('{')).toThrow('JSON');
    expect(() => prepareGradientResult(JSON.stringify({ css, extra: 'url(x)' }))).toThrow('only');
    expect(() => prepareGradientResult(`{"css":${JSON.stringify(css)},"__proto__":{}}`)).toThrow(
      'only',
    );
    expect(() => prepareGradientResult('é'.repeat(16385))).toThrow('32 KiB');
    let called = false;
    const params = {
      get color1() {
        called = true;
        return '#000000';
      },
    };
    expect(() => pickerGradientParams(params, 'color1', '#000000')).toThrow();
    expect(called).toBe(false);
  });
});
