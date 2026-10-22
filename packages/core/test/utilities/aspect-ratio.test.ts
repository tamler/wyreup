import { expect, it } from 'vitest';
import { calculateAspectRatio } from '../../src/utilities/aspect-ratio.js';

it('reduces exact decimal dimensions without floating point GCD', () => {
  expect(calculateAspectRatio({ width: '1920', height: '1080' })).toMatchObject({ ratio: '16:9' });
  expect(calculateAspectRatio({ width: '2.5', height: '1' })).toMatchObject({ ratio: '5:2' });
});
it('computes missing dimensions with declared exact or rounded output', () => {
  expect(calculateAspectRatio({ mode: 'missingWidth', height: '900', ratioWidth: '16', ratioHeight: '9' }))
    .toMatchObject({ width: '1600', approximate: false });
  expect(calculateAspectRatio({ mode: 'missingHeight', width: '300', ratioWidth: '3', ratioHeight: '2' }))
    .toMatchObject({ height: '200', approximate: false });
  expect(calculateAspectRatio({ mode: 'missingHeight', width: '1', ratioWidth: '3', ratioHeight: '1' }))
    .toMatchObject({ height: '0.333333', approximate: true });
  expect(calculateAspectRatio({ mode: 'missingHeight', width: '0.000001', ratioWidth: '2', ratioHeight: '1' }))
    .toMatchObject({ height: '0.000001', approximate: true });
});
it('rejects invalid, over-bound, lossy or unknown input fields', () => {
  for (const params of [{ height: '0' }, { width: '1000000000000.000001' },
    { width: '1.0000001' }, { width: '1e3' }, { width: 100 }, { unknown: '1' }])
    expect(() => calculateAspectRatio(params)).toThrow();
});
it('rejects a positive missing dimension that cannot remain positive at six-digit precision', () => {
  expect(() => calculateAspectRatio({
    mode: 'missingHeight', width: '0.000001', ratioWidth: '3', ratioHeight: '1',
  })).toThrow('precision');
});
