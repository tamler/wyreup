import { describe, expect, it } from 'vitest';
import {
  buildingTools,
  validateBoardFootPieces,
  validateGutterCandidates,
} from '../../src/utilities/building.js';
import { UtilityInputError } from '../../src/utilities/common.js';
import type { ToolRunContext } from '../../src/types.js';

const context = (): ToolRunContext => ({
  signal: new AbortController().signal,
  cache: new Map(),
  executionId: 'building-known-answer',
  onProgress() {},
});
async function run(id: string, params: Record<string, unknown> = {}) {
  const tool = buildingTools.find((value) => value.id === id);
  if (!tool) throw new Error(`Missing tool ${id}`);
  const output = await tool.run([], params, context());
  const blob = Array.isArray(output) ? output[0] : output;
  expect(blob?.type).toBe('application/json');
  return JSON.parse(await blob!.text()) as Record<string, unknown>;
}
function close(actual: unknown, expected: number) {
  expect(typeof actual).toBe('number');
  expect(Math.abs((actual as number) - expected)).toBeLessThanOrEqual(
    1e-9 * Math.max(1, Math.abs(expected)),
  );
}

describe('building actual tool known answers', () => {
  it.each([
    [
      'paint-calculator',
      {
        wallAreaM2: 32,
        includedAreaM2: 32,
        paintL: 6.4,
        primerL: 3.2,
        paintContainers: 2,
        primerContainers: 1,
      },
    ],
    ['concrete-bag-calculator', { slabVolumeM3: 0.6, bags: 30, purchasedMassKg: 750 }],
    ['gravel-calculator', { volumeM3: 2, massKg: 3200, metricTonnes: 3.2 }],
    ['mulch-calculator', { volumeM3: 0.5, bags: 10 }],
    ['roof-pitch-rafter-calculator', { rafterLengthM: 5, roofAreaM2: 100, risePer12: 9 }],
    ['tile-calculator-with-waste', { tiles: 44, boxes: 5, purchasedAreaM2: 12.5 }],
    [
      'drywall-sheet-calculator',
      { includedAreaM2: 44, sheets: 17, screws: 680, tapeM: 44, compoundKg: 22 },
    ],
    ['fence-material-calculator', { bays: 4, posts: 5, rails: 12, pickets: 100 }],
    [
      'deck-material-calculator',
      {
        boardRows: 20,
        baseBoardPieces: 40,
        purchasedBoards: 44,
        joists: 13,
        joistLengthM: 39,
        fasteners: 520,
      },
    ],
    ['paver-calculator', { areaM2: 20, pavers: 1100, baseM3: 2, sandM3: 0.6, edgeM: 18 }],
    ['topsoil-calculator', { volumeM3: 2, massKg: 2400, bags: 50 }],
    ['sod-calculator', { adjustedAreaM2: 22, rolls: 11, pallets: 3, purchasedPalletAreaM2: 30 }],
    ['hvac-btu-calculator', { baseBtuH: 6000, coolingBtuH: 6000 }],
    ['insulation-calculator', { adjustedAreaM2: 110, packages: 22, cost: 220 }],
    [
      'asphalt-driveway-calculator',
      { volumeM3: 1.5, massKg: 3600, metricTonnes: 3.6, loads: 2, cost: 360 },
    ],
    [
      'roofing-shingle-bundle-calculator',
      { adjustedAreaM2: 110, bundles: 37, underlaymentRolls: 3, nails: 925, ridgeCaps: 34 },
    ],
    [
      'retaining-wall-block-calculator',
      {
        columns: 20,
        courses: 5,
        baseBlocks: 100,
        baseCaps: 20,
        baseM3: 0.5,
        drainM3: 2,
        geogridLayers: 2,
        geogridM2: 20,
      },
    ],
    [
      'pond-liner-calculator',
      { linerLengthM: 7, linerWidthM: 6, linerAreaM2: 42, waterVolumeM3: 12, waterL: 12000 },
    ],
    [
      'french-drain-gravel-calculator',
      {
        trenchM3: 2,
        installedGravelM3: 1.9214601836602552,
        voidStorageM3: 0.6725110642810893,
        fabricM2: 16,
      },
    ],
    ['wallpaper-roll-calculator', { strips: 20, cutHeightM: 3, stripsPerRoll: 3, rolls: 7 }],
    ['board-foot-calculator', { totalBoardFeet: 16, totalVolumeM3: 0.037755795456, totalCost: 48 }],
    [
      'stair-stringer-calculator',
      { risers: 16, treads: 15, totalRunM: 4.2, diagonalM: 5.047771785649585 },
    ],
    [
      'stud-wall-calculator',
      {
        regularStuds: 11,
        totalStuds: 11,
        studLengthM: 26.4,
        plateLengthM: 12,
        blockingLengthM: 3.62,
      },
    ],
    ['pipe-volume-calculator', { volumeM3: 0.07853981633974483, litres: 78.53981633974483 }],
    [
      'ramp-slope-calculator',
      { horizontalRunM: 7.2, runs: 3, intermediateLandings: 2, horizontalExtentM: 10.2 },
    ],
    ['gutter-size-calculator', { requiredLS: 2.7777777777777777, downspouts: 3, selectedIndex: 1 }],
    ['ac-tonnage-calculator', { loadBtuH: 20000, refrigerationTons: 1.6666666666666667 }],
    [
      'construction-estimate-generator',
      { subtotalMinor: 9000, markupMinor: 900, taxMinor: 495, totalMinor: 10395 },
    ],
  ] as const)('%s returns its independent known answer', async (id, expected) => {
    const result = await run(id);
    for (const [key, value] of Object.entries(expected)) close(result[key], value);
  });

  it('has28 unique schemas and rejects unknown params/nonfinite/blank/count fractions in execution', async () => {
    expect(buildingTools).toHaveLength(28);
    expect(new Set(buildingTools.map((tool) => tool.id)).size).toBe(28);
    for (const tool of buildingTools) {
      expect(Object.keys(tool.defaults).sort()).toEqual(Object.keys(tool.paramSchema!).sort());
      await expect(tool.run([], { unknown: true }, context())).rejects.toBeInstanceOf(
        UtilityInputError,
      );
      for (const [key, field] of Object.entries(tool.paramSchema!)) {
        if (!field || field.type !== 'number' || field.showWhen) continue;
        await expect(tool.run([], { [key]: Infinity }, context())).rejects.toBeInstanceOf(
          UtilityInputError,
        );
        await expect(tool.run([], { [key]: '' }, context())).rejects.toBeInstanceOf(
          UtilityInputError,
        );
        if (field.step === 1)
          await expect(tool.run([], { [key]: 1.5 }, context())).rejects.toMatchObject({
            code: 'integer',
          });
      }
    }
  });

  it('keeps roof overhang, zero ridge and identical rectangular plane assumptions explicit', async () => {
    expect(await run('roof-pitch-rafter-calculator', { overhangM: 1 })).toMatchObject({
      extendedRunM: 5,
      extendedRiseM: 3.75,
      rafterLengthM: 6.25,
      roofAreaM2: 125,
    });
    expect(await run('roof-pitch-rafter-calculator', { ridgeLengthM: 0 })).toMatchObject({
      rafterLengthM: 5,
      roofAreaM2: 0,
    });
    expect(JSON.stringify((await run('roof-pitch-rafter-calculator')).assumptions)).toMatch(
      /identical rectangular.*hip\/valley/i,
    );
  });

  it('handles one-riser and zero stairs without division by zero', async () => {
    expect(await run('stair-stringer-calculator', { totalRiseM: 0.1 })).toMatchObject({
      status: 'vertical-rise-no-treads',
      risers: 1,
      treads: 0,
      totalRunM: 0,
      diagonalM: 0.1,
      angleDegrees: 90,
    });
    const withoutFloor = await run('stair-stringer-calculator', {
      totalRiseM: 0.1,
      topFloorIsLastTread: false,
    });
    close(withoutFloor.diagonalM, 0.2973213749463701);
    close(withoutFloor.angleDegrees, 19.653824058053306);
    expect(await run('stair-stringer-calculator', { totalRiseM: 0 })).toMatchObject({
      status: 'empty',
      risers: 0,
      treads: 0,
      diagonalM: 0,
      angleDegrees: 0,
    });
    expect(await run('ramp-slope-calculator', { riseM: 0 })).toMatchObject({
      status: 'empty',
      runs: 0,
      intermediateLandings: 0,
      horizontalExtentM: 0,
    });
    close((await run('ramp-slope-calculator', { riseM: 0 })).slopePercent, 8.333333333333334);
  });

  it('uses both manufacturer preset constants and ignores inactive custom invalid values', async () => {
    const result = await run('concrete-bag-calculator', {
      bagPreset: 'quikrete-80lb-1101',
      bagYieldM3: -1,
      bagMassKg: null,
    });
    expect(result.bags).toBe(36);
    close(result.purchasedMassKg, 1306.3460256);
    close(result.effectiveBagYieldM3, 0.0169901079552);
    await expect(
      run('concrete-bag-calculator', { bagPreset: 'custom', bagYieldM3: 0 }),
    ).rejects.toThrow();
  });

  it('uses HVAC sourced cooling intervals and separately scoped modifiers', async () => {
    for (const [areaFt2, base] of [
      [150, 5000],
      [250, 6000],
      [300, 7000],
      [350, 8000],
      [400, 9000],
      [450, 10000],
      [550, 12000],
      [700, 14000],
      [1000, 18000],
      [1200, 21000],
      [1400, 23000],
      [1500, 24000],
    ]) {
      expect((await run('hvac-btu-calculator', { areaFt2 })).baseBtuH).toBe(base);
    }
    close(
      (
        await run('hvac-btu-calculator', {
          shade: 'sunny',
          occupants: 3,
          kitchen: true,
          ceilingFt: 16,
          climateFactor: 1.5,
        })
      ).coolingBtuH,
      24400,
    );
    const heating = await run('hvac-btu-calculator', { mode: 'heating' });
    expect(heating).toMatchObject({ coolingBtuH: null, baseBtuH: null });
    close(heating.heatingW, 1858.0608);
    await expect(run('hvac-btu-calculator', { areaFt2: 99.999 })).rejects.toThrow();
    await expect(run('hvac-btu-calculator', { areaFt2: 1500.001 })).rejects.toThrow();
  });

  it('keeps zero materials, nondividing intervals and purchase waste distinct', async () => {
    expect(await run('fence-material-calculator', { lengthM: 0 })).toMatchObject({
      posts: 0,
      bays: 0,
      pickets: 0,
    });
    expect((await run('fence-material-calculator', { lengthM: 1, picketGapM: 0.1 })).pickets).toBe(
      6,
    );
    const result = await run('stud-wall-calculator', {
      lengthM: 1,
      maxStudSpacingM: 0.6,
      extraStuds: 2,
    });
    close(result.blockingLengthM, 0.924);
    expect(result.totalStuds).toBe(5);
    expect(result.plateLengthM).toBe(3);
    close(
      (await run('french-drain-gravel-calculator', { wastePercent: 10 })).voidStorageM3,
      0.6725110642810893,
    );
    expect(
      await run('wallpaper-roll-calculator', { wallPerimeterM: 0, extraRolls: 3 }),
    ).toMatchObject({ strips: 0, baseRolls: 0, extraRolls: 0, rolls: 0 });
  });

  it('validates exact typed row paths without mutating or invoking accessors', async () => {
    expect(validateBoardFootPieces([])).toEqual([]);
    expect(validateGutterCandidates([])).toEqual([]);
    await expect(
      run('board-foot-calculator', {
        pieces: [{ thicknessIn: 1, widthIn: 12, lengthFt: 8, quantity: 1.5, pricePerBoardFoot: 3 }],
      }),
    ).rejects.toMatchObject({ field: '$.pieces[0].quantity', code: 'integer' });
    expect(() => validateGutterCandidates([{ name: 'x', widthM: '1', waterDepthM: 1 }])).toThrow();
    let read = false;
    const row = {
      name: 'x',
      waterDepthM: 1,
      get widthM() {
        read = true;
        return 1;
      },
    };
    expect(() => validateGutterCandidates([row])).toThrow();
    expect(read).toBe(false);
    expect(await run('gutter-size-calculator', { candidates: [] })).toMatchObject({
      status: 'no-candidates',
      selectedIndex: null,
    });
    await expect(run('paint-calculator', { openingsM2: 100 })).rejects.toThrow();
    await expect(run('wallpaper-roll-calculator', { rollLengthM: 0.1 })).rejects.toThrow();
    await expect(
      run('tile-calculator-with-waste', { tileWidthM: 0.000001, tileHeightM: 0.000001 }),
    ).rejects.toMatchObject({ code: 'budget' });
  });
});
