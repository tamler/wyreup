import type { ToolModule, ToolRunContext } from '../../types.js';
import type { UnitConverterParams, UnitCategory } from './types.js';

export type { UnitConverterParams, UnitCategory } from './types.js';
export { defaultUnitConverterParams } from './types.js';

const UnitConverterComponentStub = (): unknown => null;

// ── Unit factor tables (all values are in SI base units) ───────────────────

// Factor tables: unit -> multiplier to convert TO base unit
// Exception: temperature handled separately.

const FACTORS: Record<UnitCategory, Record<string, number>> = {
  length: {
    m: 1, km: 1000, cm: 0.01, mm: 0.001,
    in: 0.0254, ft: 0.3048, yd: 0.9144,
    mi: 1609.344, nmi: 1852,
  },
  mass: {
    g: 1, kg: 1000, mg: 0.001,
    lb: 453.59237, oz: 28.349523125,
    ton: 907184.74, stone: 6350.29318,
  },
  area: {
    m2: 1, km2: 1e6, ft2: 0.09290304, yd2: 0.83612736,
    acre: 4046.8564224, hectare: 10000, mi2: 2589988.110336,
  },
  volume: {
    L: 1, mL: 0.001, gal: 3.785411784, qt: 0.946352946,
    pt: 0.473176473, cup: 0.2365882365, floz: 0.0295735295625,
    m3: 1000, ft3: 28.316846592,
  },
  speed: {
    'm/s': 1, 'km/h': 1 / 3.6, mph: 0.44704, kn: 0.514444, 'ft/s': 0.3048,
  },
  data: {
    B: 1, KB: 1000, MB: 1e6, GB: 1e9, TB: 1e12, PB: 1e15,
    KiB: 1024, MiB: 1048576, GiB: 1073741824, TiB: 1099511627776,
  },
  time: {
    s: 1, ms: 0.001, min: 60, h: 3600, d: 86400,
    wk: 604800, mo: 2629746, yr: 31556952,
  },
  temperature: {}, // handled separately
};

function detectCategory(unit: string): UnitCategory | undefined {
  for (const [cat, factors] of Object.entries(FACTORS) as [UnitCategory, Record<string, number>][]) {
    if (cat === 'temperature') continue;
    if (unit in factors) return cat;
  }
  // temperature units
  if (['C', 'F', 'K'].includes(unit)) return 'temperature';
  return undefined;
}

function convertTemperature(value: number, from: string, to: string): number {
  // Convert from -> Celsius first
  let celsius: number;
  switch (from) {
    case 'C': celsius = value; break;
    case 'F': celsius = (value - 32) * 5 / 9; break;
    case 'K': celsius = value - 273.15; break;
    default: throw new Error(`Unknown temperature unit: ${from}`);
  }
  // Celsius -> to
  switch (to) {
    case 'C': return celsius;
    case 'F': return celsius * 9 / 5 + 32;
    case 'K': return celsius + 273.15;
    default: throw new Error(`Unknown temperature unit: ${to}`);
  }
}

function convertUnits(value: number, from: string, to: string, category: UnitCategory): number {
  if (category === 'temperature') return convertTemperature(value, from, to);
  const table = FACTORS[category];
  const fromFactor = table[from];
  const toFactor = table[to];
  if (fromFactor === undefined) throw new Error(`Unknown unit "${from}" for category "${category}"`);
  if (toFactor === undefined) throw new Error(`Unknown unit "${to}" for category "${category}"`);
  return (value * fromFactor) / toFactor;
}

function formatNumber(n: number): string {
  if (Math.abs(n) >= 1e-4 && Math.abs(n) < 1e12) {
    // Use up to 8 significant digits, trim trailing zeros
    const s = parseFloat(n.toPrecision(8)).toString();
    return s;
  }
  return n.toExponential(6);
}

export const unitConverter: ToolModule<UnitConverterParams> = {
  id: 'unit-converter',
  slug: 'unit-converter',
  name: 'Unit Converter',
  description: 'Convert between length, mass, temperature, area, volume, speed, data, and time units.',
  category: 'create',
  presence: 'both',
  keywords: ['unit', 'convert', 'measurement', 'length', 'mass', 'temperature', 'metric', 'imperial'],

  input: { accept: [], min: 0, max: 0 },
  output: { mime: 'application/json', multiple: false },

  interactive: false,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'low',

  defaults: { value: 1, from: 'km', to: 'm', category: 'length' },

  paramSchema: (() => {
    const unitsByCategory: Record<
      string,
      Array<{ value: string; label: string }>
    > = {
      length: [
        { value: 'm', label: 'm — meters' },
        { value: 'km', label: 'km — kilometers' },
        { value: 'cm', label: 'cm — centimeters' },
        { value: 'mm', label: 'mm — millimeters' },
        { value: 'in', label: 'in — inches' },
        { value: 'ft', label: 'ft — feet' },
        { value: 'yd', label: 'yd — yards' },
        { value: 'mi', label: 'mi — miles' },
        { value: 'nmi', label: 'nmi — nautical miles' },
      ],
      mass: [
        { value: 'g', label: 'g — grams' },
        { value: 'kg', label: 'kg — kilograms' },
        { value: 'mg', label: 'mg — milligrams' },
        { value: 'lb', label: 'lb — pounds' },
        { value: 'oz', label: 'oz — ounces' },
        { value: 'ton', label: 'ton — short ton' },
        { value: 'stone', label: 'stone' },
      ],
      temperature: [
        { value: 'C', label: '°C — Celsius' },
        { value: 'F', label: '°F — Fahrenheit' },
        { value: 'K', label: 'K — Kelvin' },
      ],
      area: [
        { value: 'm2', label: 'm² — square meters' },
        { value: 'km2', label: 'km² — square kilometers' },
        { value: 'ft2', label: 'ft² — square feet' },
        { value: 'yd2', label: 'yd² — square yards' },
        { value: 'acre', label: 'acre' },
        { value: 'hectare', label: 'hectare' },
        { value: 'mi2', label: 'mi² — square miles' },
      ],
      volume: [
        { value: 'L', label: 'L — liters' },
        { value: 'mL', label: 'mL — milliliters' },
        { value: 'gal', label: 'gal — US gallons' },
        { value: 'qt', label: 'qt — US quarts' },
        { value: 'pt', label: 'pt — US pints' },
        { value: 'cup', label: 'cup' },
        { value: 'floz', label: 'fl oz' },
        { value: 'm3', label: 'm³ — cubic meters' },
        { value: 'ft3', label: 'ft³ — cubic feet' },
      ],
      speed: [
        { value: 'm/s', label: 'm/s' },
        { value: 'km/h', label: 'km/h' },
        { value: 'mph', label: 'mph' },
        { value: 'kn', label: 'kn — knots' },
        { value: 'ft/s', label: 'ft/s' },
      ],
      data: [
        { value: 'B', label: 'B — bytes' },
        { value: 'KB', label: 'KB — kilobytes (1000)' },
        { value: 'MB', label: 'MB — megabytes (1000²)' },
        { value: 'GB', label: 'GB — gigabytes (1000³)' },
        { value: 'TB', label: 'TB — terabytes (1000⁴)' },
        { value: 'PB', label: 'PB — petabytes (1000⁵)' },
        { value: 'KiB', label: 'KiB — kibibytes (1024)' },
        { value: 'MiB', label: 'MiB — mebibytes (1024²)' },
        { value: 'GiB', label: 'GiB — gibibytes (1024³)' },
        { value: 'TiB', label: 'TiB — tebibytes (1024⁴)' },
      ],
      time: [
        { value: 's', label: 's — seconds' },
        { value: 'ms', label: 'ms — milliseconds' },
        { value: 'min', label: 'min — minutes' },
        { value: 'h', label: 'h — hours' },
        { value: 'd', label: 'd — days' },
        { value: 'wk', label: 'wk — weeks' },
        { value: 'mo', label: 'mo — months (30 d)' },
        { value: 'yr', label: 'yr — years (365.24 d)' },
      ],
    };
    return {
      category: {
        type: 'enum',
        label: 'category',
        options: [
          { value: 'length', label: 'length' },
          { value: 'mass', label: 'mass' },
          { value: 'temperature', label: 'temperature' },
          { value: 'area', label: 'area' },
          { value: 'volume', label: 'volume' },
          { value: 'speed', label: 'speed' },
          { value: 'data', label: 'data' },
          { value: 'time', label: 'time' },
        ],
      },
      value: {
        type: 'number',
        label: 'value',
      },
      from: {
        type: 'enum',
        label: 'from',
        options: unitsByCategory.length!,
        optionsFrom: { field: 'category', map: unitsByCategory },
      },
      to: {
        type: 'enum',
        label: 'to',
        options: unitsByCategory.length!,
        optionsFrom: { field: 'category', map: unitsByCategory },
      },
    } as const;
  })(),

  Component: UnitConverterComponentStub,

  // eslint-disable-next-line @typescript-eslint/require-await
  async run(
    _inputs: File[],
    params: UnitConverterParams,
    ctx: ToolRunContext,
  ): Promise<Blob[]> {
    ctx.onProgress({ stage: 'processing', percent: 0, message: 'Converting units' });

    const { value, from, to } = params;
    let category = params.category;

    if (category === undefined) {
      category = detectCategory(from);
      if (!category) {
        const result = { valid: false, error: `Could not determine category for unit "${from}"` };
        ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
        return [new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' })];
      }
    }

    try {
      const result = convertUnits(value, from, to, category);
      const formatted = `${value} ${from} = ${formatNumber(result)} ${to}`;
      const output = {
        valid: true,
        value,
        from,
        to,
        category,
        result,
        formatted,
      };
      ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
      return [new Blob([JSON.stringify(output, null, 2)], { type: 'application/json' })];
    } catch (err) {
      const output = { valid: false, error: err instanceof Error ? err.message : String(err) };
      ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
      return [new Blob([JSON.stringify(output, null, 2)], { type: 'application/json' })];
    }
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['application/json'],
  },
};
