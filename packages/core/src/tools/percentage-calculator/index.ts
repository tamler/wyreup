import type { ToolModule, ToolRunContext } from '../../types.js';
import type { PercentageCalculatorParams, PercentageMode } from './types.js';

export type { PercentageCalculatorParams, PercentageMode } from './types.js';
export { defaultPercentageCalculatorParams } from './types.js';

const PercentageCalculatorComponentStub = (): unknown => null;

function formatNum(n: number): string {
  return parseFloat(n.toPrecision(10)).toString();
}

interface PercentResult {
  valid: boolean;
  mode?: PercentageMode;
  inputs?: Record<string, number>;
  result?: number;
  formatted?: string;
  error?: string;
}

function compute(params: PercentageCalculatorParams): PercentResult {
  const { mode, value, base, percent } = params;

  switch (mode) {
    case 'percent-of': {
      // "value% of base"
      if (base === undefined) return { valid: false, error: '"base" is required for percent-of mode' };
      const result = (value / 100) * base;
      return {
        valid: true,
        mode,
        inputs: { value, base },
        result,
        formatted: `${formatNum(value)}% of ${formatNum(base)} = ${formatNum(result)}`,
      };
    }

    case 'what-percent': {
      // "value is what % of base"
      if (base === undefined) return { valid: false, error: '"base" is required for what-percent mode' };
      if (base === 0) return { valid: false, error: 'Base cannot be zero' };
      const result = (value / base) * 100;
      return {
        valid: true,
        mode,
        inputs: { value, base },
        result,
        formatted: `${formatNum(value)} is ${formatNum(result)}% of ${formatNum(base)}`,
      };
    }

    case 'percent-change': {
      // percent change from value to base: (base - value) / value * 100
      if (base === undefined) return { valid: false, error: '"base" is required for percent-change mode' };
      if (value === 0) return { valid: false, error: 'Original value cannot be zero' };
      const result = ((base - value) / value) * 100;
      const direction = result >= 0 ? 'increase' : 'decrease';
      return {
        valid: true,
        mode,
        inputs: { from: value, to: base },
        result,
        formatted: `${formatNum(value)} to ${formatNum(base)} is a ${formatNum(Math.abs(result))}% ${direction}`,
      };
    }

    case 'increase-decrease': {
      // "value increased/decreased by percent%"
      if (percent === undefined) return { valid: false, error: '"percent" is required for increase-decrease mode' };
      const result = value * (1 + percent / 100);
      const direction = percent >= 0 ? 'increased' : 'decreased';
      return {
        valid: true,
        mode,
        inputs: { value, percent },
        result,
        formatted: `${formatNum(value)} ${direction} by ${formatNum(Math.abs(percent))}% = ${formatNum(result)}`,
      };
    }

    default:
      return { valid: false, error: `Unknown mode: ${String(mode)}` };
  }
}

export const percentageCalculator: ToolModule<PercentageCalculatorParams> = {
  id: 'percentage-calculator',
  slug: 'percentage-calculator',
  name: 'Percentage Calculator',
  description: 'Calculate percentages: percent of a value, percent change, or apply a percentage increase/decrease.',
  category: 'create',
  presence: 'both',
  keywords: ['percentage', 'percent', 'calculator', 'math', 'ratio', 'discount', 'change'],

  input: { accept: [], min: 0, max: 0 },
  output: { mime: 'application/json', multiple: false },

  interactive: false,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'low',

  defaults: { mode: 'percent-of', value: 50, base: 200, percent: 10 },

  paramSchema: {
    mode: {
      type: 'enum',
      label: 'mode',
      options: [
        { value: 'percent-of', label: 'Percent of value (X% of Y)' },
        { value: 'what-percent', label: 'What percent (X is what % of Y)' },
        { value: 'percent-change', label: 'Percent change (X to Y)' },
        { value: 'increase-decrease', label: 'Increase/decrease by %' },
      ],
    },
  },

  Component: PercentageCalculatorComponentStub,

   
  async run(
    _inputs: File[],
    params: PercentageCalculatorParams,
    ctx: ToolRunContext,
  ): Promise<Blob[]> {
    ctx.onProgress({ stage: 'processing', percent: 0, message: 'Calculating percentage' });

    const result = compute(params);
    const output = JSON.stringify(result, null, 2);

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [new Blob([output], { type: 'application/json' })];
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['application/json'],
  },
};
