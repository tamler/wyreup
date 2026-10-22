import { describe, expect, it } from 'vitest';
import {
  hardwareTools,
  validateGeneratorLoads,
  readGamepadSnapshot,
  touchscreenCellIndex,
  summarizeTouchscreenSession,
} from '../../src/utilities/hardware.js';
import type { ToolRunContext } from '../../src/types.js';

const context = (): ToolRunContext => ({
  signal: new AbortController().signal,
  cache: new Map(),
  executionId: 'hardware-known-answer',
  onProgress() {},
});
async function run(id: string, params: Record<string, unknown> = {}) {
  const tool = hardwareTools.find((value) => value.id === id);
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
describe('hardware actual tool known answers', () => {
  it.each([
    ['screen-ppi-calculator', { ppi: 200, pixelPitchMm: 0.127, widthIn: 4, heightIn: 3 }],
    ['ohms-law-calculator', { voltageV: 12, currentA: 2, resistanceOhm: 6, powerW: 24 }],
    [
      'voltage-drop-calculator',
      {
        oneWayResistanceOhm: 0.06896551724137931,
        dropV: 1.3793103448275863,
        lineLossW: 13.793103448275863,
      },
    ],
    [
      'wire-size-calculator',
      { minimumAreaMm2: 4.789272030651341, awg: 10, selectedAreaMm2: 5.261154954510373 },
    ],
    ['battery-runtime-calculator', { nominalWh: 1200, usableWh: 864, runtimeHours: 7.2 }],
    [
      'projector-throw-distance-calculator',
      {
        imageHeightM: 1.125,
        imageDiagonalM: 2.2946949688357274,
        minDistanceM: 2.4,
        maxDistanceM: 3,
      },
    ],
    [
      'generator-wattage-calculator',
      { rawContinuousW: 200, rawPeakW: 600, headroomContinuousW: 250, headroomPeakW: 750 },
    ],
    ['solar-panel-output-calculator', { nominalW: 800, dailyKwh: 3.2, totalKwh: 96 }],
    [
      'led-resistor-calculator',
      {
        selectedResistanceOhm: 330,
        selectedPowerRatingPerStringW: 0.25,
        actualCurrentPerStringMa: 18.181818181818183,
        resistorPowerPerStringW: 0.10909090909090909,
      },
    ],
    [
      'ups-runtime-calculator',
      { nominalWh: 432, usableWh: 311.04, runtimeHours: 1.5552, runtimeMinutes: 93.312 },
    ],
    [
      'solar-battery-bank-calculator',
      {
        requiredNominalWh: 5555.555555555556,
        requiredAh: 231.4814814814815,
        series: 2,
        parallel: 3,
        totalBatteries: 6,
        actualNominalWh: 7200,
        actualUsableWh: 5184,
      },
    ],
    ['speaker-box-volume-calculator', { grossL: 15.625, netL: 14 }],
  ] as const)('%s returns its independent known answer', async (id, expected) => {
    const result = await run(id);
    for (const [key, value] of Object.entries(expected)) close(result[key], value);
  });

  it('returns separate manufacturer/FOV distances from actual TV geometry', async () => {
    expect(
      await run('tv-viewing-distance-calculator', {
        diagonalIn: 5,
        aspectWidth: 4,
        aspectHeight: 3,
        horizontalFovDeg: 90,
      }),
    ).toMatchObject({ widthIn: 4, heightIn: 3, referenceDistanceIn: 4.5 });
    close(
      (
        await run('tv-viewing-distance-calculator', {
          diagonalIn: 5,
          aspectWidth: 4,
          aspectHeight: 3,
          horizontalFovDeg: 90,
        })
      ).geometricFovDistanceIn,
      2,
    );
  });

  it('has16 unique tools with two real browser-only surfaces', () => {
    expect(hardwareTools).toHaveLength(16);
    expect(
      hardwareTools
        .filter((tool) => tool.surfaces?.length === 1 && tool.surfaces[0] === 'web')
        .map((tool) => tool.id)
        .sort(),
    ).toEqual(['gamepad-tester', 'touchscreen-dead-zone-tester']);
  });

  it('preserves wire zero-length schema error and voltage-drop-only selection', async () => {
    await expect(run('wire-size-calculator', { oneWayLengthM: 0 })).rejects.toMatchObject({
      field: 'oneWayLengthM',
      code: 'bounds',
      message: 'oneWayLengthM: Minimum is 0.000001.',
    });
    expect(await run('wire-size-calculator', { supplyV: 0.000001, currentA: 1e9 })).toMatchObject({
      status: 'no-available-candidate',
      awg: null,
      selectedAreaMm2: null,
    });
    expect(await run('voltage-drop-calculator', { currentA: 0 })).toMatchObject({
      dropV: 0,
      lineLossW: 0,
    });
    expect(await run('voltage-drop-calculator', { currentA: 1e9 })).toMatchObject({
      status: 'insufficient-voltage',
      loadV: null,
    });
    close(
      (await run('voltage-drop-calculator', { currentA: 1e9 })).lineLossW,
      1.3793103448275862e17,
    );
  });

  it('uses all six Ohm pairs and rejects ambiguous zero pairs', async () => {
    for (const [pair, first, second] of [
      ['VI', 12, 2],
      ['VR', 12, 6],
      ['IR', 2, 6],
      ['VP', 12, 24],
      ['IP', 2, 24],
      ['RP', 6, 24],
    ] as const)
      expect(await run('ohms-law-calculator', { pair, first, second })).toMatchObject({
        voltageV: 12,
        currentA: 2,
        resistanceOhm: 6,
        powerW: 24,
      });
    await expect(run('ohms-law-calculator', { pair: 'VI', first: 0, second: 0 })).rejects.toThrow();
    expect(await run('ohms-law-calculator', { pair: 'IR', first: 0, second: 6 })).toMatchObject({
      voltageV: 0,
      currentA: 0,
      powerW: 0,
    });
  });

  it('keeps LED per-string ratings and full E12 representational boundaries', async () => {
    const two = await run('led-resistor-calculator', { parallelStrings: 2 });
    expect(two).toMatchObject({
      selectedResistanceOhm: 330,
      selectedPowerRatingPerStringW: 0.25,
      resistorCount: 2,
    });
    close(two.totalCurrentMa, 36.36363636363636);
    close(two.totalResistorPowerW, 0.21818181818181817);
    for (const [ideal, selected] of [
      [1, 1],
      [1.2, 1.2],
      [330, 330],
      [330 + 4 * Number.EPSILON * 330, 330],
      [330 + 256 * Number.EPSILON * 330, 390],
      [8200000, 8200000],
      [10000000, 10000000],
    ] as const) {
      const targetMa = ideal > 999 ? 0.001 : 1000;
      const supplyV = 1 + (ideal * targetMa) / 1000;
      expect(
        (await run('led-resistor-calculator', { supplyV, forwardV: 1, ledsInSeries: 1, targetMa }))
          .selectedResistanceOhm,
      ).toBe(selected);
    }
    await expect(run('led-resistor-calculator', { forwardV: 100 })).rejects.toThrow();
  });

  it('keeps generator simultaneous quantity, post-margin/PF cap, and exact row paths', async () => {
    expect(
      await run('generator-wattage-calculator', { startupMode: 'simultaneous' }),
    ).toMatchObject({ rawPeakW: 600 });
    const loads = [{ name: 'Motor', runningW: 100, startingW: 500, quantity: 2 }];
    expect(await run('generator-wattage-calculator', { loads })).toMatchObject({
      rawContinuousW: 200,
      rawPeakW: 600,
    });
    expect(
      await run('generator-wattage-calculator', { loads, startupMode: 'simultaneous' }),
    ).toMatchObject({ rawPeakW: 1000 });
    expect(() =>
      validateGeneratorLoads([{ name: 'x', runningW: 2, startingW: 1, quantity: 1 }]),
    ).toThrow();
    await expect(
      run('generator-wattage-calculator', {
        loads: [{ name: 'x', runningW: 2, startingW: 1, quantity: 1 }],
      }),
    ).rejects.toMatchObject({ field: '$.loads[0].startingW', code: 'bounds' });
    expect(
      await run('generator-wattage-calculator', {
        loads: [{ name: 'x', runningW: 1e9, startingW: 1e9, quantity: 1000 }],
        headroomPercent: 0,
      }),
    ).toMatchObject({ rawContinuousW: 1e12 });
    await expect(
      run('generator-wattage-calculator', {
        loads: [{ name: 'x', runningW: 1e9, startingW: 1e9, quantity: 1000 }],
      }),
    ).rejects.toThrow();
  });

  it('refuses undefined runtime, incompatible series, bad enclosure, and retains zero solar', async () => {
    await expect(run('battery-runtime-calculator', { loadW: 0, standbyW: 0 })).rejects.toThrow();
    await expect(run('ups-runtime-calculator', { loadW: 0, standbyW: 0 })).rejects.toThrow();
    await expect(run('solar-battery-bank-calculator', { bankV: 24.001 })).rejects.toThrow();
    expect(
      (await run('solar-battery-bank-calculator', { bankV: 24.2, batteryV: 12.1 })).series,
    ).toBe(2);
    expect(await run('solar-panel-output-calculator', { peakSunHours: 0 })).toMatchObject({
      dailyKwh: 0,
      totalKwh: 0,
    });
    await expect(run('speaker-box-volume-calculator', { panelThicknessCm: 15 })).rejects.toThrow();
  });

  it('reads actual source slot/index and preserves raw finite overshoots', () => {
    const pad = {
      index: 1,
      id: 'controlled pad',
      mapping: 'standard',
      connected: true,
      timestamp: 10,
      axes: [1.00001],
      buttons: [{ value: 1.01, pressed: true, touched: true }],
    } as unknown as Gamepad;
    const result = readGamepadSnapshot(0.1, { getGamepads: () => [null, pad] });
    expect(result.devices[0]).toMatchObject({ slot: 1, index: 1, axes: [1.00001] });
    expect(result.devices[0]!.buttons[0]).toMatchObject({ value: 1.01 });
    expect(result.status).toBe('observed');
    expect(readGamepadSnapshot(0.1, { getGamepads: () => [] }).status).toBe('no-device');
  });

  it('uses shifted CSS rectangles, inclusive far edges and real stopped session summaries', () => {
    const rect = { left: 100, top: 200, width: 30, height: 20 };
    expect(touchscreenCellIndex(rect, 3, 2, 130, 220)).toBe(5);
    expect(touchscreenCellIndex(rect, 3, 2, 130.001, 220)).toBeNull();
    const session = {
      columns: 3,
      rows: 2,
      rect,
      startedAt: 0,
      stoppedAt: 100,
      samples: [
        [105, 205],
        [125, 205],
        [125, 215],
      ].map(([clientX, clientY]) => ({
        clientX,
        clientY,
        at: 10,
        pointerType: 'touch',
        pressure: 0.5,
      })),
      excludedSamples: 0,
      pointerTypes: { touch: 3 },
    };
    expect(summarizeTouchscreenSession(session, { columns: 3, rows: 2 })).toMatchObject({
      touchedCells: 3,
      untouchedCells: 3,
      coveragePercent: 50,
      sampleCount: 3,
    });
    expect(() => summarizeTouchscreenSession(session, { columns: 10, rows: 10 })).toThrow();
    expect(() =>
      summarizeTouchscreenSession(
        { ...session, samples: [], pointerTypes: {} },
        { columns: 3, rows: 2 },
      ),
    ).toThrow();
  });
});
