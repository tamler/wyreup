import { describe, expect, it } from 'vitest';
import { buildingTools, constructionEstimateGenerator } from '../../src/utilities/building.js';
import { hardwareTools } from '../../src/utilities/hardware.js';
import type { ToolRunContext } from '../../src/types.js';

async function wallpaper(rollLengthM: number, patternRepeatM = 0) {
  const tool = buildingTools.find((entry) => entry.id === 'wallpaper-roll-calculator');
  if (!tool) throw new Error('Actual wallpaper tool is unavailable.');
  const ctx: ToolRunContext = {
    signal: new AbortController().signal,
    executionId: 'independent-single-strip-boundary',
    cache: new Map(),
    onProgress() {},
  };
  const output = await tool.run(
    [],
    {
      wallPerimeterM: 1,
      rollWidthM: 0.5,
      heightM: 0.1,
      trimEachEndM: 0.1,
      rollLengthM,
      patternRepeatM,
      extraRolls: 0,
    },
    ctx,
  );
  const blob = Array.isArray(output) ? output[0] : output;
  if (!blob) throw new Error('No wallpaper artifact.');
  return JSON.parse(await blob.text()) as Record<string, unknown>;
}

describe('reviewed wallpaper single-strip boundary', () => {
  it.each([0, 0.1])('admits the exact 300mm cut in 300mm roll with repeat %s', async (repeat) => {
    expect(await wallpaper(0.3, repeat)).toMatchObject({
      strips: 2,
      stripsPerRoll: 1,
      baseRolls: 2,
      rolls: 2,
    });
  });

  it.each([0, 0.1])('fits two exact 300mm strips in 600mm with repeat %s', async (repeat) => {
    expect(await wallpaper(0.6, repeat)).toMatchObject({
      strips: 2,
      stripsPerRoll: 2,
      baseRolls: 1,
      rolls: 1,
    });
  });

  it.each([0, 0.1])('refuses a genuinely short 299.9mm roll with repeat %s', async (repeat) => {
    await expect(wallpaper(0.2999, repeat)).rejects.toMatchObject({
      field: 'rollLengthM',
      code: 'bounds',
      message: 'rollLengthM: No full-height strip fits this roll.',
    });
  });
});

describe('reviewed continuation output retains every original body line', () => {
  it.each(['W'.repeat(120), `${'W'.repeat(100)}\n${'X'.repeat(19)}`, ` \n${'W'.repeat(118)}`])(
    'reopens bounded one-line continuation for %j without dropping title or rows',
    async (title) => {
      const ctx = (): ToolRunContext => ({
        signal: new AbortController().signal,
        executionId: 'full-pdf-body-reopen',
        cache: new Map(),
        onProgress() {},
      });
      const params = {
        format: 'pdf',
        title,
        customer: 'Original customer',
        notes: 'Original note retained.',
        materials: Array.from({ length: 100 }, (_, i) => ({
          description: `Original line ${i + 1} ${'W'.repeat(75)}`,
          quantity: 1,
          unit: 'each',
          unitPrice: 1,
        })),
        labor: [],
      };
      const first = await constructionEstimateGenerator.run([], params, ctx());
      const second = await constructionEstimateGenerator.run([], params, ctx());
      const blob = Array.isArray(first) ? first[0] : first;
      const same = Array.isArray(second) ? second[0] : second;
      if (!blob || !same) throw new Error('Missing real PDF.');
      const bytes = new Uint8Array(await blob.arrayBuffer());
      expect(new Uint8Array(await same.arrayBuffer())).toEqual(bytes);
      const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
      const loading = pdfjs.getDocument({ data: Uint8Array.from(bytes), useSystemFonts: false });
      try {
        const pdf = await loading.promise;
        expect(pdf.numPages).toBeGreaterThan(1);
        const texts: string[] = [];
        for (let index = 1; index <= pdf.numPages; index++) {
          const page = await pdf.getPage(index);
          const content = await page.getTextContent();
          const items = content.items.flatMap((item) => ('str' in item ? [item] : []));
          texts.push(items.map((item) => item.str).join(''));
          if (index > 1) {
            const header = items.find((item) => item.str.length > 0);
            if (!header) throw new Error('Missing continuation.');
            expect(header.str).toContain('... | USD | Line items / totals');
            expect(header.width).toBeLessThanOrEqual(510);
            expect(Number(header.transform[5])).toBe(790);
            for (const item of items.slice(items.indexOf(header) + 1)) {
              if (item.str) expect(Number(item.transform[5])).toBeLessThanOrEqual(770);
            }
            if (!title.split('\n')[0]!.trim())
              expect(header.str).toBe('... | USD | Line items / totals');
          }
        }
        for (const originalLine of title.split('\n')) {
          if (originalLine.trim()) expect(texts[0]).toContain(originalLine);
        }
        const full = texts.join('');
        for (let i = 1; i <= 100; i++) expect(full).toContain(`Original line ${i} `);
        expect(full).toContain('Original customer');
        expect(full).toContain('Original note retained.');
      } finally {
        await loading.destroy();
      }
    },
    30000,
  );
});

describe('reviewed actual result units and preserved board cost policy', () => {
  const unitGroups = [
    ['pixels/inch', 'ppi'],
    ['millimetres/pixel', 'pixelPitchMm'],
    ['inches', 'widthIn heightIn referenceDistanceIn geometricFovDistanceIn'],
    ['volts', 'voltageV dropV loadV actualDropV headroomV actualSeriesV'],
    ['amperes', 'currentA'],
    ['ohms', 'resistanceOhm oneWayResistanceOhm idealResistanceOhm selectedResistanceOhm'],
    [
      'watts',
      'powerW lineLossW totalDrawW rawContinuousW rawPeakW headroomContinuousW headroomPeakW nominalW totalResistorPowerW',
    ],
    ['ohm mm²/metre', 'resistivityOhmMm2M'],
    ['percent', 'dropPercent actualDropPercent'],
    ['square millimetres', 'minimumAreaMm2 selectedAreaMm2'],
    ['American Wire Gauge index (0,-1,-2,-3 denote1/0..4/0)', 'awg'],
    ['watt-hours', 'nominalWh usableWh requiredNominalWh actualNominalWh actualUsableWh'],
    ['hours', 'runtimeHours'],
    ['dimensionless height multiplier', 'referenceMultiplier'],
    ['metres', 'imageHeightM imageDiagonalM minDistanceM maxDistanceM'],
    ['volt-amperes', 'rawContinuousVA rawPeakVA headroomContinuousVA headroomPeakVA'],
    ['kilowatt-hours/day', 'dailyKwh'],
    ['kilowatt-hours', 'totalKwh'],
    ['days', 'days'],
    ['milliamperes/string', 'actualCurrentPerStringMa'],
    ['milliamperes', 'totalCurrentMa'],
    [
      'watts/string',
      'resistorPowerPerStringW minimumPowerRatingPerStringW selectedPowerRatingPerStringW',
    ],
    ['resistors', 'resistorCount'],
    ['minutes', 'runtimeMinutes'],
    ['ampere-hours', 'requiredAh'],
    ['batteries/string', 'series'],
    ['parallel strings', 'parallel'],
    ['batteries', 'totalBatteries'],
    ['centimetres', 'innerWidthCm innerHeightCm innerDepthCm'],
    ['litres', 'grossL netL'],
    ['cubic feet', 'grossFt3 netFt3'],
  ] as const;
  const expectedUnits = Object.fromEntries(
    unitGroups.flatMap(([unit, fields]) => fields.split(' ').map((field) => [field, unit])),
  );
  const expected = [
    ['screen-ppi-calculator', 'ppi pixelPitchMm widthIn heightIn'],
    ['ohms-law-calculator', 'voltageV currentA resistanceOhm powerW'],
    [
      'voltage-drop-calculator',
      'resistivityOhmMm2M oneWayResistanceOhm dropV loadV dropPercent lineLossW',
    ],
    ['wire-size-calculator', 'minimumAreaMm2 selectedAreaMm2 actualDropV actualDropPercent awg'],
    ['battery-runtime-calculator', 'nominalWh usableWh totalDrawW runtimeHours'],
    [
      'tv-viewing-distance-calculator',
      'widthIn heightIn referenceDistanceIn geometricFovDistanceIn referenceMultiplier',
    ],
    [
      'projector-throw-distance-calculator',
      'imageHeightM imageDiagonalM minDistanceM maxDistanceM',
    ],
    [
      'generator-wattage-calculator',
      'rawContinuousW rawPeakW headroomContinuousW headroomPeakW rawContinuousVA rawPeakVA headroomContinuousVA headroomPeakVA',
    ],
    ['solar-panel-output-calculator', 'nominalW dailyKwh totalKwh days'],
    [
      'led-resistor-calculator',
      'headroomV idealResistanceOhm selectedResistanceOhm actualCurrentPerStringMa totalCurrentMa resistorPowerPerStringW minimumPowerRatingPerStringW selectedPowerRatingPerStringW totalResistorPowerW resistorCount',
    ],
    ['ups-runtime-calculator', 'nominalWh usableWh totalDrawW runtimeHours runtimeMinutes'],
    [
      'solar-battery-bank-calculator',
      'requiredNominalWh actualNominalWh actualUsableWh requiredAh actualSeriesV series parallel totalBatteries',
    ],
    [
      'speaker-box-volume-calculator',
      'innerWidthCm innerHeightCm innerDepthCm grossL netL grossFt3 netFt3',
    ],
  ] as const;
  it.each(expected)('attaches only meaningful unit fields for %s', async (id, keys) => {
    const tool = hardwareTools.find((entry) => entry.id === id);
    if (!tool) throw new Error(`Missing actual ${id}`);
    const output = await tool.run(
      [],
      {},
      {
        signal: new AbortController().signal,
        executionId: 'actual-unit-record',
        cache: new Map(),
        onProgress() {},
      },
    );
    const blob = Array.isArray(output) ? output[0] : output;
    if (!blob) throw new Error('Missing actual result.');
    const result = JSON.parse(await blob.text()) as Record<string, unknown>;
    const units = result.units as Record<string, string>;
    expect(Object.keys(units).sort()).toEqual(keys.split(' ').sort());
    for (const key of keys.split(' ')) {
      expect(Object.hasOwn(result, key)).toBe(true);
      expect(units[key]).toBe(expectedUnits[key]);
    }
    expect(units).not.toHaveProperty('cost');
    expect(units).not.toHaveProperty('mass');
    if (id === 'ohms-law-calculator')
      expect(units).toEqual({
        voltageV: 'volts',
        currentA: 'amperes',
        resistanceOhm: 'ohms',
        powerW: 'watts',
      });
    if (id === 'generator-wattage-calculator') {
      expect(result.headroomPeakW).toBe(750);
      expect(units.headroomPeakW).toBe('watts');
      expect(units.headroomPeakVA).toBe('volt-amperes');
    }
  });

  it('preserves individually displayed .01 rows and aggregate-once .01 total with explicit units', async () => {
    const tool = buildingTools.find((entry) => entry.id === 'board-foot-calculator');
    if (!tool) throw new Error('Missing actual board tool.');
    const output = await tool.run(
      [],
      {
        pieces: Array.from({ length: 2 }, () => ({
          thicknessIn: 1,
          widthIn: 12,
          lengthFt: 1,
          quantity: 1,
          pricePerBoardFoot: 0.006,
        })),
      },
      {
        signal: new AbortController().signal,
        executionId: 'board-aggregate-known-answer',
        cache: new Map(),
        onProgress() {},
      },
    );
    const blob = Array.isArray(output) ? output[0] : output;
    if (!blob) throw new Error('Missing board artifact.');
    const result = JSON.parse(await blob.text()) as {
      pieces: { cost: number }[];
      totalBoardFeet: number;
      totalCost: number;
      assumptions: string[];
      units: Record<string, string>;
    };
    expect(result.pieces.map((row: { cost: number }) => row.cost)).toEqual([0.01, 0.01]);
    expect(result.totalBoardFeet).toBe(2);
    expect(result.totalCost).toBe(0.01);
    expect(result.assumptions).toContain(
      'Row display costs are rounded per row; totalCost is rounded once from unrounded row costs, so displayed rows may not sum to totalCost.',
    );
    expect(result.units.totalCost).toBe(
      'entered currency units; rounded once from unrounded row costs',
    );
    expect(result.units.cost).toBe('entered currency units; row display costs rounded per row');
  });
});
