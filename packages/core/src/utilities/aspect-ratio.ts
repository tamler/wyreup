import type { ParamFieldSchema } from '../types.js';
import {
  createUtility,
  UtilityInputError,
  validateUtilityParams,
  type UtilityParams,
  type UtilityResult,
} from './common.js';

const scale = 1000000n;
const maximum = 1000000000000n * scale;
const defaults = {
  mode: 'ratio',
  width: '1920',
  height: '1080',
  ratioWidth: '16',
  ratioHeight: '9',
};
const decimal = (label: string): ParamFieldSchema => ({
  type: 'string',
  label,
  maxLength: 20,
  help: 'Positive decimal, at most 1 trillion, with up to six fractional digits. No scientific notation.',
});
const schema: Record<string, ParamFieldSchema> = {
  mode: {
    type: 'enum',
    label: 'Calculation',
    options: [
      { value: 'ratio', label: 'Reduce width and height' },
      { value: 'missingWidth', label: 'Find width from height and ratio' },
      { value: 'missingHeight', label: 'Find height from width and ratio' },
    ],
  },
  width: decimal('Width'),
  height: decimal('Height'),
  ratioWidth: decimal('Ratio width'),
  ratioHeight: decimal('Ratio height'),
};
const visualSchema: Record<string, ParamFieldSchema> = {
  ...schema,
  width: { ...schema.width!, showWhen: { field: 'mode', in: ['ratio', 'missingHeight'] } },
  height: { ...schema.height!, showWhen: { field: 'mode', in: ['ratio', 'missingWidth'] } },
  ratioWidth: {
    ...schema.ratioWidth!,
    showWhen: { field: 'mode', in: ['missingWidth', 'missingHeight'] },
  },
  ratioHeight: {
    ...schema.ratioHeight!,
    showWhen: { field: 'mode', in: ['missingWidth', 'missingHeight'] },
  },
};
function units(value: unknown, field: string): bigint {
  if (typeof value !== 'string' || !/^\d{1,13}(?:\.\d{1,6})?$/.test(value))
    throw new UtilityInputError(
      `$.${field}`,
      'type',
      'Enter a positive decimal with up to six fractional digits.',
    );
  const [integer, fraction = ''] = value.split('.');
  const result = BigInt(integer!) * scale + BigInt(fraction.padEnd(6, '0'));
  if (result <= 0n || result > maximum)
    throw new UtilityInputError(
      `$.${field}`,
      'bounds',
      'Value must be greater than zero and at most 1 trillion.',
    );
  return result;
}
function display(value: bigint): string {
  const integer = value / scale,
    fraction = (value % scale).toString().padStart(6, '0').replace(/0+$/, '');
  return integer.toString() + (fraction ? '.' + fraction : '');
}
function ratio(a: bigint, b: bigint): string {
  let x = a,
    y = b;
  while (y !== 0n) {
    const remainder = x % y;
    x = y;
    y = remainder;
  }
  return `${a / x}:${b / x}`;
}
export function calculateAspectRatio(provided: UtilityParams): UtilityResult {
  const p = validateUtilityParams(defaults, schema, provided);
  let width = p.mode === 'missingWidth' ? 0n : units(p.width, 'width'),
    height = p.mode === 'missingHeight' ? 0n : units(p.height, 'height');
  const rw = p.mode === 'ratio' ? 0n : units(p.ratioWidth, 'ratioWidth'),
    rh = p.mode === 'ratio' ? 0n : units(p.ratioHeight, 'ratioHeight');
  let approximate = false;
  if (p.mode !== 'ratio') {
    const numerator = p.mode === 'missingWidth' ? height * rw : width * rh;
    const denominator = p.mode === 'missingWidth' ? rh : rw;
    if (numerator > maximum * denominator)
      throw new UtilityInputError('$result', 'bounds', 'Calculated dimension exceeds 1 trillion.');
    const quotient = numerator / denominator,
      remainder = numerator % denominator;
    const rounded = quotient + (remainder * 2n >= denominator ? 1n : 0n);
    if (rounded <= 0n)
      throw new UtilityInputError(
        '$result',
        'bounds',
        'Calculated dimension is below the positive six-digit precision limit.',
      );
    approximate = remainder !== 0n;
    if (p.mode === 'missingWidth') width = rounded;
    else height = rounded;
  }
  return {
    mode: p.mode as string,
    width: display(width),
    height: display(height),
    ratio: p.mode === 'ratio' ? ratio(width, height) : ratio(rw, rh),
    approximate,
    rounding: 'Missing dimensions use six fractional digits, rounded half up.',
  };
}
export const aspectRatioCalculator = createUtility({
  id: 'aspect-ratio-calculator',
  name: 'Aspect Ratio Calculator',
  description:
    'Reduce decimal dimensions to an exact aspect ratio, or find a missing width or height. Calculated dimensions show when six-digit rounding loses precision.',
  category: 'design',
  keywords: ['aspect', 'ratio', 'width', 'height', 'dimensions'],
  defaults,
  paramSchema: visualSchema,
  calculate: calculateAspectRatio,
});
