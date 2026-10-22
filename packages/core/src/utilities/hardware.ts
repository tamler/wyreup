import type { ToolModule, ToolRunContext } from '../types.js';
import { cloneUtilityJson, createUtility, numberParam, stringParam, UtilityInputError, validateUtilityParams, type UtilityParams, type UtilityResult } from './common.js';
import { buildingChoice, buildingN, buildingNumber, buildingResult, buildingRows, buildingSpecs, type buildingUtility } from './building-shared.js';
import { abort } from './hardware-shared.js';
export { validateGeneratorLoads } from './hardware-shared.js';
export type { GeneratorLoad } from './hardware-shared.js';


const n = buildingN,
  N = buildingNumber,
  P = (value: number, max = 10000) => N(value, 0.000001, max),
  C = (value: number, min = 0, max = 1000000) => N(value, min, max, true),
  choice = buildingChoice;
const HARDWARE_UNITS: Record<string, Record<string, string>> = {
  'screen-ppi-calculator': {
    ppi: 'pixels/inch',
    pixelPitchMm: 'millimetres/pixel',
    widthIn: 'inches',
    heightIn: 'inches',
  },
  'ohms-law-calculator': {
    voltageV: 'volts',
    currentA: 'amperes',
    resistanceOhm: 'ohms',
    powerW: 'watts',
  },
  'voltage-drop-calculator': {
    resistivityOhmMm2M: 'ohm mm²/metre',
    oneWayResistanceOhm: 'ohms',
    dropV: 'volts',
    loadV: 'volts',
    dropPercent: 'percent',
    lineLossW: 'watts',
  },
  'wire-size-calculator': {
    minimumAreaMm2: 'square millimetres',
    selectedAreaMm2: 'square millimetres',
    actualDropV: 'volts',
    actualDropPercent: 'percent',
    awg: 'American Wire Gauge index (0,-1,-2,-3 denote1/0..4/0)',
  },
  'battery-runtime-calculator': {
    nominalWh: 'watt-hours',
    usableWh: 'watt-hours',
    totalDrawW: 'watts',
    runtimeHours: 'hours',
  },
  'tv-viewing-distance-calculator': {
    widthIn: 'inches',
    heightIn: 'inches',
    referenceDistanceIn: 'inches',
    geometricFovDistanceIn: 'inches',
    referenceMultiplier: 'dimensionless height multiplier',
  },
  'projector-throw-distance-calculator': {
    imageHeightM: 'metres',
    imageDiagonalM: 'metres',
    minDistanceM: 'metres',
    maxDistanceM: 'metres',
  },
  'generator-wattage-calculator': {
    rawContinuousW: 'watts',
    rawPeakW: 'watts',
    headroomContinuousW: 'watts',
    headroomPeakW: 'watts',
    rawContinuousVA: 'volt-amperes',
    rawPeakVA: 'volt-amperes',
    headroomContinuousVA: 'volt-amperes',
    headroomPeakVA: 'volt-amperes',
  },
  'solar-panel-output-calculator': {
    nominalW: 'watts',
    dailyKwh: 'kilowatt-hours/day',
    totalKwh: 'kilowatt-hours',
    days: 'days',
  },
  'led-resistor-calculator': {
    headroomV: 'volts',
    idealResistanceOhm: 'ohms',
    selectedResistanceOhm: 'ohms',
    actualCurrentPerStringMa: 'milliamperes/string',
    totalCurrentMa: 'milliamperes',
    resistorPowerPerStringW: 'watts/string',
    minimumPowerRatingPerStringW: 'watts/string',
    selectedPowerRatingPerStringW: 'watts/string',
    totalResistorPowerW: 'watts',
    resistorCount: 'resistors',
  },
  'ups-runtime-calculator': {
    nominalWh: 'watt-hours',
    usableWh: 'watt-hours',
    totalDrawW: 'watts',
    runtimeHours: 'hours',
    runtimeMinutes: 'minutes',
  },
  'solar-battery-bank-calculator': {
    requiredNominalWh: 'watt-hours',
    actualNominalWh: 'watt-hours',
    actualUsableWh: 'watt-hours',
    requiredAh: 'ampere-hours',
    actualSeriesV: 'volts',
    series: 'batteries/string',
    parallel: 'parallel strings',
    totalBatteries: 'batteries',
  },
  'speaker-box-volume-calculator': {
    innerWidthCm: 'centimetres',
    innerHeightCm: 'centimetres',
    innerDepthCm: 'centimetres',
    grossL: 'litres',
    netL: 'litres',
    grossFt3: 'cubic feet',
    netFt3: 'cubic feet',
  },
};
const tool = (
  id: string,
  name: string,
  description: string,
  specs: Parameters<typeof buildingUtility>[3],
  assumptions: string[],
  resultLimit?: number,
) =>
  createUtility({
    id,
    name,
    description,
    ...buildingSpecs(specs),
    category: 'hardware',
    keywords: id.split('-'),
    calculate: async (p: UtilityParams, ctx: ToolRunContext) => {
      if (ctx.signal.aborted) throw new UtilityInputError('$run', 'abort', 'Calculation cancelled.');
      const { calculateHardware } = await import('./hardware-calculations.js');
      if (ctx.signal.aborted) throw new UtilityInputError('$run', 'abort', 'Calculation cancelled.');
      const result = await calculateHardware(id, p, ctx);
      if (ctx.signal.aborted) throw new UtilityInputError('$run', 'abort', 'Calculation cancelled.');
      return buildingResult(result, assumptions, resultLimit, HARDWARE_UNITS[id]);
    },
  });
function direct(
  id: string,
  name: string,
  description: string,
  specs: ReturnType<typeof buildingSpecs>,
  run: ToolModule<UtilityParams>['run'],
  browser = false,
  memory: 'low' | 'medium' = 'low',
): ToolModule<UtilityParams> {
  return {
    id,
    slug: id,
    name,
    description,
    category: 'hardware',
    keywords: id.split('-'),
    input: { accept: [], min: 0, max: 0 },
    output: { mime: 'application/json', multiple: false },
    ...specs,
    interactive: browser,
    batchable: false,
    cost: 'free',
    memoryEstimate: memory,
    surfaces: browser ? ['web'] : ['web', 'cli', 'mcp'],
    run,
    __testFixtures: { valid: [], weird: [], expectedOutputMime: ['application/json'] },
  };
}
function jsonArtifact(result: UtilityResult, ctx: ToolRunContext): Blob[] {
  abort(ctx.signal);
  const clean = cloneUtilityJson(result, '$result');
  ctx.onProgress({ stage: 'done', percent: 100 });
  return [new Blob([JSON.stringify(clean)], { type: 'application/json' })];
}

export interface GamepadSource {
  getGamepads(): readonly (Gamepad | null)[];
}
export interface GamepadButtonSnapshot {
  index: number;
  value: number;
  pressed: boolean;
  touched: boolean;
}
export interface GamepadDeviceSnapshot {
  slot: number;
  index: number;
  descriptor: string;
  mapping: string;
  connected: boolean;
  timestamp: number;
  axes: number[];
  buttons: GamepadButtonSnapshot[];
  outOfNominal: { axes: number[]; buttons: number[] };
}
export interface GamepadReport {
  status: 'observed' | 'no-device';
  deadZone: number;
  devices: GamepadDeviceSnapshot[];
}
const gamepadSpecs = buildingSpecs({ deadZone: N(0.1, 0, 0.95) });
export function readGamepadSnapshot(deadZone: number, source?: GamepadSource): GamepadReport {
  numberParam({ deadZone }, 'deadZone', { min: 0, max: 0.95 });
  if (!source) {
    if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function')
      throw new UtilityInputError(
        '$gamepads',
        'schema',
        'Gamepad API is unavailable in this browser/context.',
      );
    source = navigator;
  }
  let pads: readonly (Gamepad | null)[];
  try {
    pads = source.getGamepads();
  } catch {
    throw new UtilityInputError(
      '$gamepads',
      'schema',
      'Gamepad reading is denied by browser security or policy.',
    );
  }
  const isArray = (value: unknown): boolean => Array.isArray(value);
  if (!isArray(pads) || pads.length > 16)
    throw new UtilityInputError('$gamepads', 'budget', 'At most16 API slots are supported.');
  const finite = (value: unknown, field: string) => {
    if (typeof value !== 'number' || !Number.isFinite(value))
      throw new UtilityInputError(field, 'bounds', 'Malformed nonfinite device reading.');
    return value;
  };
  const devices: GamepadDeviceSnapshot[] = [];
  for (let slot = 0; slot < pads.length; slot++) {
    const pad = pads[slot];
    if (pad === null) continue;
    if (!pad) throw new UtilityInputError('$gamepads', 'schema', 'Malformed API slot.');
    const path = `$gamepads[${slot}]`,
      index = finite(pad.index, `${path}.index`);
    if (!Number.isSafeInteger(index) || index < 0)
      throw new UtilityInputError(`${path}.index`, 'integer', 'Malformed API device index.');
    if (
      typeof pad.id !== 'string' ||
      pad.id.length > 2000 ||
      typeof pad.mapping !== 'string' ||
      pad.mapping.length > 120 ||
      typeof pad.connected !== 'boolean'
    )
      throw new UtilityInputError(path, 'schema', 'Malformed/bounded device descriptor.');
    if (pad.axes.length > 64 || pad.buttons.length > 128)
      throw new UtilityInputError(path, 'budget', 'At most64 axes and128 buttons per device.');
    const axes = Array.from(pad.axes, (value, i) => finite(value, `${path}.axes[${i}]`)),
      buttons = Array.from(pad.buttons, (value: GamepadButton, i) => {
        if (typeof value.pressed !== 'boolean' || typeof value.touched !== 'boolean')
          throw new UtilityInputError(`${path}.buttons[${i}]`, 'type', 'Malformed button states.');
        return {
          index: i,
          value: finite(value.value, `${path}.buttons[${i}].value`),
          pressed: value.pressed,
          touched: value.touched,
        };
      });
    devices.push({
      slot,
      index,
      descriptor: pad.id,
      mapping: pad.mapping,
      connected: pad.connected,
      timestamp: finite(pad.timestamp, `${path}.timestamp`),
      axes,
      buttons,
      outOfNominal: {
        axes: axes.flatMap((value, i) => (value < -1 || value > 1 ? [i] : [])),
        buttons: buttons.flatMap((button) =>
          button.value < 0 || button.value > 1 ? [button.index] : [],
        ),
      },
    });
  }
  return { status: devices.length ? 'observed' : 'no-device', deadZone, devices };
}
export const gamepadTester = direct(
  'gamepad-tester',
  'Gamepad Tester',
  'Read exposed gamepads locally after browser-recognized interaction; raw readings are not a hardware pass.',
  gamepadSpecs,
  (inputs, params, ctx) => {
    abort(ctx.signal);
    if (inputs.length) throw new UtilityInputError('$input', 'bounds', 'No files accepted.');
    const p = validateUtilityParams(gamepadSpecs.defaults, gamepadSpecs.paramSchema, params);
    return Promise.resolve(
      jsonArtifact(readGamepadSnapshot(n(p, 'deadZone')) as unknown as UtilityResult, ctx),
    );
  },
  true,
);

export interface TouchscreenRect {
  left: number;
  top: number;
  width: number;
  height: number;
}
export interface TouchscreenSample {
  clientX: number;
  clientY: number;
  at: number;
  pointerType: string;
  pressure: number;
}
export interface TouchscreenSession {
  columns: number;
  rows: number;
  rect: TouchscreenRect;
  startedAt: number;
  stoppedAt: number;
  samples: TouchscreenSample[];
  excludedSamples: number;
  pointerTypes: Record<string, number>;
}
export interface TouchscreenReport {
  grid: { columns: number; rows: number };
  rect: TouchscreenRect;
  status: 'measured';
  touchedCells: number;
  untouchedCells: number;
  coveragePercent: number;
  sampleCount: number;
  excludedSampleCount: number;
  pointerTypeCounts: Record<string, number>;
  durationMs: number;
  cellCoverage: number[];
  note: string;
}
const touchSpecs = buildingSpecs({ columns: C(10, 2, 50), rows: C(10, 2, 50) });
function plain(value: unknown, field: string, keys?: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new UtilityInputError(field, 'type', 'Expected plain record.');
  const proto: unknown = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null)
    throw new UtilityInputError(field, 'prototype', 'Expected plain record.');
  const descriptors = Object.getOwnPropertyDescriptors(value),
    result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== 'string')
      throw new UtilityInputError(field, 'type', 'Symbol keys are unsupported.');
    const d = descriptors[key]!;
    if (!('value' in d))
      throw new UtilityInputError(`${field}.${key}`, 'schema', 'Accessors are unsupported.');
    if (keys && !keys.includes(key))
      throw new UtilityInputError(`${field}.${key}`, 'unknown', 'Unknown field.');
    result[key] = d.value;
  }
  if (keys)
    for (const key of keys)
      if (!Object.hasOwn(result, key))
        throw new UtilityInputError(`${field}.${key}`, 'required', 'Required field.');
  return result;
}
function rectValue(value: unknown): TouchscreenRect {
  const p = plain(value, '$session.rect', ['left', 'top', 'width', 'height']);
  return {
    left: numberParam(p, 'left', { min: -10000000, max: 10000000 }),
    top: numberParam(p, 'top', { min: -10000000, max: 10000000 }),
    width: numberParam(p, 'width', { min: 0.000001, max: 10000000 }),
    height: numberParam(p, 'height', { min: 0.000001, max: 10000000 }),
  };
}
export function touchscreenCellIndex(
  rect: TouchscreenRect,
  columns: number,
  rows: number,
  clientX: number,
  clientY: number,
): number | null {
  const r = rectValue(rect);
  numberParam({ columns }, 'columns', { min: 2, max: 50, integer: true });
  numberParam({ rows }, 'rows', { min: 2, max: 50, integer: true });
  if (!Number.isFinite(clientX) || !Number.isFinite(clientY))
    throw new UtilityInputError('$session.sample', 'bounds', 'Coordinates must be finite.');
  const x = clientX - r.left,
    y = clientY - r.top;
  if (x < 0 || y < 0 || x > r.width || y > r.height) return null;
  return (
    Math.min(rows - 1, Math.floor((y / r.height) * rows)) * columns +
    Math.min(columns - 1, Math.floor((x / r.width) * columns))
  );
}
export function summarizeTouchscreenSession(
  value: unknown,
  params: UtilityParams,
  signal?: AbortSignal,
): TouchscreenReport {
  abort(signal);
  const p = validateUtilityParams(touchSpecs.defaults, touchSpecs.paramSchema, params),
    session = plain(value, '$session', [
      'columns',
      'rows',
      'rect',
      'startedAt',
      'stoppedAt',
      'samples',
      'excludedSamples',
      'pointerTypes',
    ]),
    columns = n(p, 'columns'),
    rows = n(p, 'rows');
  if (session.columns !== columns || session.rows !== rows)
    throw new UtilityInputError(
      '$session',
      'schema',
      'Session grid changed; reset and measure again.',
    );
  const rect = rectValue(session.rect),
    startedAt = numberParam(session, 'startedAt', { min: 0, max: 1e12 }),
    stoppedAt = numberParam(session, 'stoppedAt', { min: startedAt, max: startedAt + 120000 }),
    excludedSamples = numberParam(session, 'excludedSamples', {
      min: 0,
      max: 100000,
      integer: true,
    });
  if (!Array.isArray(session.samples) || Object.getPrototypeOf(session.samples) !== Array.prototype)
    throw new UtilityInputError('$session.samples', 'type', 'Expected a dense sample array.');
  if (session.samples.length + excludedSamples > 100000)
    throw new UtilityInputError('$session', 'budget', 'At most100000 observed events.');
  if (!session.samples.length && !excludedSamples)
    throw new UtilityInputError(
      '$session',
      'required',
      'Record at least one actual accepted/excluded sample before exporting.',
    );
  const sampleDescriptors = Object.getOwnPropertyDescriptors(session.samples);
  for (const key of Reflect.ownKeys(sampleDescriptors)) {
    if (key === 'length') continue;
    if (
      typeof key !== 'string' ||
      !/^\d+$/.test(key) ||
      Number(key) >= session.samples.length ||
      !('value' in sampleDescriptors[key]!)
    )
      throw new UtilityInputError(
        '$session.samples',
        'schema',
        'Unexpected/accessor sample field.',
      );
  }
  const cellCoverage = new Array<number>(columns * rows).fill(0),
    acceptedTypes: Record<string, number> = Object.create(null) as Record<string, number>;
  let prior = startedAt;
  for (let i = 0; i < session.samples.length; i++) {
    if (i % 1024 === 0) abort(signal);
    const d = sampleDescriptors[String(i)];
    if (!d || !('value' in d))
      throw new UtilityInputError(`$session.samples[${i}]`, 'required', 'Missing actual sample.');
    const sample = plain(d.value, `$session.samples[${i}]`, [
        'clientX',
        'clientY',
        'at',
        'pointerType',
        'pressure',
      ]),
      at = numberParam(sample, 'at', { min: prior, max: stoppedAt }),
      clientX = numberParam(sample, 'clientX', { min: -10000000, max: 10000000 }),
      clientY = numberParam(sample, 'clientY', { min: -10000000, max: 10000000 });
    numberParam(sample, 'pressure', { min: 0, max: 1 });
    const pointerType = stringParam(sample, 'pointerType', { maxLength: 32 }),
      index = touchscreenCellIndex(rect, columns, rows, clientX, clientY);
    if (!pointerType)
      throw new UtilityInputError(
        `$session.samples[${i}].pointerType`,
        'required',
        'Pointer type is required.',
      );
    if (index === null)
      throw new UtilityInputError(
        `$session.samples[${i}]`,
        'bounds',
        'Accepted sample lies outside frozen rectangle.',
      );
    cellCoverage[index] = cellCoverage[index]! + 1;
    acceptedTypes[pointerType] = (acceptedTypes[pointerType] ?? 0) + 1;
    prior = at;
  }
  const types = plain(session.pointerTypes, '$session.pointerTypes'),
    pointerTypeCounts: Record<string, number> = Object.create(null) as Record<string, number>;
  let typeTotal = 0;
  for (const [key, count] of Object.entries(types)) {
    if (!key || key.length > 32)
      throw new UtilityInputError(
        '$session.pointerTypes',
        'bounds',
        'Pointer type label must be1..32 characters.',
      );
    const number = numberParam({ count }, 'count', { min: 0, max: 100000, integer: true });
    if (number < (acceptedTypes[key] ?? 0))
      throw new UtilityInputError(
        '$session.pointerTypes',
        'bounds',
        'Pointer counts contradict accepted samples.',
      );
    pointerTypeCounts[key] = number;
    typeTotal += number;
  }
  for (const key of Object.keys(acceptedTypes))
    if (!Object.hasOwn(types, key))
      throw new UtilityInputError(
        '$session.pointerTypes',
        'required',
        'Missing accepted pointer type count.',
      );
  if (typeTotal !== session.samples.length + excludedSamples)
    throw new UtilityInputError(
      '$session.pointerTypes',
      'bounds',
      'Pointer counts must equal accepted and excluded samples.',
    );
  const touchedCells = cellCoverage.filter((count) => count > 0).length;
  abort(signal);
  return {
    grid: { columns, rows },
    rect,
    status: 'measured',
    touchedCells,
    untouchedCells: columns * rows - touchedCells,
    coveragePercent: (100 * touchedCells) / (columns * rows),
    sampleCount: session.samples.length,
    excludedSampleCount: excludedSamples,
    pointerTypeCounts,
    durationMs: stoppedAt - startedAt,
    cellCoverage,
    note: 'Unvisited cells are not proof of dead hardware. Mouse and pen readings are labelled separately.',
  };
}
export const touchscreenTester = direct(
  'touchscreen-dead-zone-tester',
  'Touchscreen Dead Zone Tester',
  'Summarize actual stopped local pointer measurements; unvisited cells are not proof of dead hardware.',
  touchSpecs,
  (inputs, params, ctx) => {
    abort(ctx.signal);
    if (inputs.length) throw new UtilityInputError('$input', 'bounds', 'No files accepted.');
    const p = validateUtilityParams(touchSpecs.defaults, touchSpecs.paramSchema, params);
    return Promise.resolve(
      jsonArtifact(
        summarizeTouchscreenSession(
          ctx.cache.get('wyreup:touchscreen-session'),
          p,
          ctx.signal,
        ) as unknown as UtilityResult,
        ctx,
      ),
    );
  },
  true,
  'medium',
);
const ppi = tool(
  'screen-ppi-calculator',
  'Screen PPI Calculator',
  'Calculate physical pixel density from pixel resolution and diagonal inches.',
  { pixelWidth: C(800, 1), pixelHeight: C(600, 1), diagonalIn: N(5, 0.01, 10000) },
  ['Physical screen pixels and entered diagonal, not CSS viewport size.'],
);
const ohm = tool(
  'ohms-law-calculator',
  'Ohm’s Law Calculator',
  'Solve an explicitly selected positive-resistance DC/resistive pair.',
  {
    pair: choice('VR', ['VI', 'VR', 'IR', 'VP', 'IP', 'RP']),
    first: N(12, 0, 1e9),
    second: N(6, 0, 1e9),
  },
  [
    'Selected pair first/second units: VI volts/amps; VR volts/ohms; IR amps/ohms; VP volts/watts; IP amps/watts; RP ohms/watts. Positive-resistance DC/resistive PF1; no complex impedance.',
  ],
);
const phase = () => choice('dc', ['dc', 'single-phase', 'three-phase']);
const copperAssumptions = [
  'Annealed copper at20°C resistivity1/58 ohm mm²/m, linear temperature coefficient0.00393/K,10..100°C. DC/single-phase return factor2; balanced three-phase sqrt3. PF1 resistive approximation excludes reactance/contact resistance/imbalance/ampacity.',
  'https://nvlpubs.nist.gov/nistpubs/Legacy/hb/nbshandbook100.pdf',
];
const drop = tool(
  'voltage-drop-calculator',
  'Voltage Drop Calculator',
  'Estimate copper resistive voltage drop and line loss with an explicit phase convention.',
  {
    supplyV: P(24),
    currentA: N(10, 0, 1e9),
    oneWayLengthM: N(10),
    areaMm2: P(2.5),
    temperatureC: N(20, 10, 100),
    phase: phase(),
  },
  copperAssumptions,
);
const wire = tool(
  'wire-size-calculator',
  'Wire Size for Voltage Drop',
  'Choose the smallest AWG cross-section meeting entered copper voltage-drop limits.',
  {
    supplyV: P(24),
    currentA: P(10, 1e9),
    oneWayLengthM: P(10),
    maxDropPercent: N(3, 0.1, 20),
    temperatureC: N(20, 10, 100),
    phase: phase(),
  },
  [
    ...copperAssumptions,
    'Voltage-drop-only selection, AWG36 through0000; no breaker/ampacity/NEC conclusion.',
  ],
);
const battery = tool(
  'battery-runtime-calculator',
  'Battery Runtime Calculator',
  'Estimate energy divided by entered constant draw.',
  {
    voltageV: N(12, 1, 10000),
    capacityAh: N(100, 0.001, 1000000),
    usableFraction: N(0.8, 0.01, 1),
    efficiency: N(0.9, 0.01, 1),
    loadW: N(120, 0, 1e9),
    standbyW: N(0, 0, 1e9),
  },
  [
    'Entered usable fraction/efficiency; excludes Peukert curves, aging, temperature and safe discharge recommendations.',
  ],
);
const tv = tool(
  'tv-viewing-distance-calculator',
  'TV Viewing Distance Calculator',
  'Show a manufacturer height reference and a separate chosen field-of-view distance.',
  {
    diagonalIn: P(55),
    aspectWidth: N(16, 1, 100),
    aspectHeight: N(9, 1, 100),
    resolution: choice('4k', ['hd', '4k']),
    horizontalFovDeg: N(30, 10, 120),
  },
  [
    'Sony reference4K1.5×height/HD3×height; preferences/environment vary. Separate user FOV geometry, no comfort or vision guarantee.',
    'https://www.sony.com/electronics/support/articles/00008601',
  ],
);
const projector = tool(
  'projector-throw-distance-calculator',
  'Projector Throw Distance Calculator',
  'Multiply entered image width by the lens manufacturer throw-ratio range.',
  {
    imageWidthM: P(2),
    aspectWidth: N(16, 1, 100),
    aspectHeight: N(9, 1, 100),
    minThrowRatio: N(1.2, 0.01, 100),
    maxThrowRatio: N(1.5, 0.01, 100),
  },
  [
    'Entered lens-manufacturer ratios; lens shift/keystone/clearance are not predicted.',
    'https://epson.com/projector-guide-how-to-buy-a-projector-throw-distance-and-positioning',
  ],
);
const generator = tool(
  'generator-wattage-calculator',
  'Generator Wattage Calculator',
  'Sum actual load/startup values using one-at-a-time or simultaneous startup.',
  {
    loads: buildingRows([
      { name: 'Motor', runningW: 100, startingW: 500, quantity: 1 },
      { name: 'Lamp', runningW: 100, startingW: 100, quantity: 1 },
    ]),
    startupMode: choice('one-at-a-time', ['one-at-a-time', 'simultaneous']),
    headroomPercent: N(25, 0, 100),
    powerFactor: N(1, 0.1, 1),
  },
  [
    'Starting watts include running watts; use actual manufacturer surge values. Zero quantity excluded. Wattages alone do not establish connection/wiring safety.',
  ],
  1e12,
);
const solar = tool(
  'solar-panel-output-calculator',
  'Solar Panel Output Calculator',
  'Estimate constant-sun energy using explicit hours and total derate.',
  {
    panelW: P(400, 1e9),
    panelCount: C(2, 0, 100000),
    peakSunHours: N(5, 0, 24),
    lossPercent: N(20, 0, 100),
    days: C(30, 1, 366),
  },
  [
    'Constant sun/total derate entered example; no live weather, tilt, shading, temperature, inverter or PVWatts model.',
    'https://www.nrel.gov/docs/fy14osti/62641.pdf',
  ],
);
const led = tool(
  'led-resistor-calculator',
  'LED Resistor Calculator',
  'Estimate one resistor per series string with exact or preferred E12 resistance.',
  {
    supplyV: N(12, 0.01, 1000),
    forwardV: P(2, 1000),
    ledsInSeries: C(3, 1, 1000),
    targetMa: N(20, 0.001, 10000),
    parallelStrings: C(1, 1, 10000),
    series: choice('E12', ['E12', 'exact']),
    powerMargin: N(2, 1, 10),
  },
  [
    'Nominal fixed LED forward voltage and resistance; per-string power margin is entered. No tolerance/thermal guarantee. Full E12 series uses exact integer tenths-ohm ticks; only8EPS equality-noise allowance.',
    'https://www.vishay.com/docs/21014/perfval.pdf',
  ],
);
const ups = tool(
  'ups-runtime-calculator',
  'UPS Runtime Calculator',
  'Estimate physical battery energy divided by draw and compare entered UPS output rating.',
  {
    batteryV: N(48, 1, 10000),
    batteryAh: N(9, 0.001, 1000000),
    usableFraction: N(0.8, 0.01, 1),
    inverterEfficiency: N(0.9, 0.01, 1),
    loadW: N(200, 0, 1e9),
    standbyW: N(0, 0, 1e9),
    ratedOutputW: P(500, 1e9),
  },
  [
    'Physical bank voltage/Ah, not VA as energy. Overload estimate is unusable. Actual high-rate discharge curves may shorten runtime.',
  ],
);
const bank = tool(
  'solar-battery-bank-calculator',
  'Solar Battery Bank Calculator',
  'Estimate matching-series battery quantities using entered autonomy and usable fractions.',
  {
    dailyWh: N(2000, 0, 1e9),
    autonomyDays: N(2, 0, 365),
    bankV: P(24),
    usableFraction: N(0.8, 0.01, 1),
    efficiency: N(0.9, 0.01, 1),
    batteryV: P(12),
    batteryAh: N(100, 0.001, 1000000),
  },
  [
    'Entered autonomy/usable fractions; actual series voltage reported. No mixed-chemistry/wiring/charger-safety claim.',
  ],
);
const speaker = tool(
  'speaker-box-volume-calculator',
  'Speaker Box Volume Calculator',
  'Calculate clear interior volume less entered component displacement.',
  {
    outerWidthCm: P(30),
    outerHeightCm: P(30),
    outerDepthCm: P(30),
    panelThicknessCm: N(2.5, 0, 100),
    driverDisplacementL: N(1, 0, 1000000),
    portDisplacementL: N(0.5, 0, 1000000),
    braceDisplacementL: N(0.125, 0, 1000000),
  },
  [
    'No acoustic tuning/Thiele-Small or best-enclosure prediction. Zero air space is not a usable enclosure.',
  ],
);

function cameraMetadata(bytes: Uint8Array, signal: AbortSignal): UtilityResult {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    counts: number[] = [],
    intervals: Array<[number, number]> = [];
  let make: string | undefined,
    model: string | undefined,
    unsupported = false,
    ifdCount = 0,
    entriesTotal = 0;
  const visited = new Set<number>();
  const malformed = (message: string): never => {
    throw new UtilityInputError(
      '$input',
      'bounds',
      `Malformed bounded TIFF/JPEG metadata: ${message}`,
    );
  };
  function range(start: number, length: number, lower = 0, upper = bytes.length) {
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(length) ||
      length < 0 ||
      start < lower ||
      start > upper - length
    )
      malformed('Referenced metadata lies outside its container.');
  }
  function charge(start: number, length: number) {
    range(start, length);
    intervals.push([start, start + length]);
    intervals.sort((a, b) => a[0] - b[0]);
    let union = 0,
      end = -1;
    for (const [a, b] of intervals) {
      union += Math.max(0, b - Math.max(end, a));
      end = Math.max(end, b);
    }
    if (union > 1048576)
      throw new UtilityInputError(
        '$input',
        'budget',
        'Actually dereferenced metadata exceeds1MiB.',
      );
  }
  function header(base: number, lower: number, upper: number): boolean | null {
    range(base, 8, lower, upper);
    charge(base, 8);
    const little = bytes[base] === 0x49 && bytes[base + 1] === 0x49,
      big = bytes[base] === 0x4d && bytes[base + 1] === 0x4d;
    if (!little && !big) return null;
    if (view.getUint16(base + 2, little) !== 42) return null;
    return little;
  }
  function ascii(
    entry: number,
    type: number,
    count: number,
    base: number,
    little: boolean,
    lower: number,
    upper: number,
  ): string {
    if (type !== 2 || count < 1 || count > 121) malformed('Make/model must be bounded ASCII.');
    const start = count <= 4 ? entry + 8 : base + view.getUint32(entry + 8, little);
    range(start, count, lower, upper);
    charge(start, count);
    let result = '';
    for (let i = 0; i < count; i++) {
      const byte = bytes[start + i]!;
      if (!byte) break;
      if (byte > 127) malformed('Make/model is not ASCII.');
      result += String.fromCharCode(byte);
    }
    return result;
  }
  function ifds(
    base: number,
    offset: number,
    little: boolean,
    lower: number,
    upper: number,
    nikon: boolean,
  ) {
    while (offset) {
      abort(signal);
      const start = base + offset;
      range(start, 2, lower, upper);
      if (visited.has(start)) malformed('Circular/repeated IFD offset.');
      visited.add(start);
      if (++ifdCount > 16)
        throw new UtilityInputError('$input', 'budget', 'At most16 followed IFDs.');
      const count = view.getUint16(start, little);
      entriesTotal += count;
      if (entriesTotal > 4096)
        throw new UtilityInputError('$input', 'budget', 'At most4096 followed entries.');
      range(start, 2 + count * 12 + 4, lower, upper);
      charge(start, 2 + count * 12 + 4);
      for (let i = 0; i < count; i++) {
        if (i % 64 === 0) abort(signal);
        const entry = start + 2 + i * 12,
          tag = view.getUint16(entry, little),
          type = view.getUint16(entry + 2, little),
          quantity = view.getUint32(entry + 4, little),
          inline = view.getUint32(entry + 8, little);
        if (nikon) {
          if (tag === 0x00a7) {
            if (type !== 4 || quantity !== 1)
              malformed('Nikon shutter count must be inline LONG/count1.');
            counts.push(inline);
          }
          continue;
        }
        if (tag === 0x010f) make = ascii(entry, type, quantity, base, little, lower, upper);
        else if (tag === 0x0110) model = ascii(entry, type, quantity, base, little, lower, upper);
        else if (tag === 0x8769) {
          if (type !== 4 || quantity !== 1) malformed('ExifIFD pointer must be LONG/count1.');
          if (!inline) malformed('ExifIFD offset is zero.');
          ifds(base, inline, little, lower, upper, false);
        } else if (tag === 0x927c) {
          if (type !== 7 || !quantity)
            malformed('MakerNote must be a nonempty undefined byte payload.');
          const note = quantity <= 4 ? entry + 8 : base + inline;
          range(note, quantity, lower, upper);
          charge(note, quantity);
          const nikonPrefix =
            quantity >= 10 &&
            [78, 105, 107, 111, 110, 0].every((b, k) => bytes[note + k] === b) &&
            bytes[note + 6] === 2;
          if (!nikonPrefix) {
            unsupported = true;
            continue;
          }
          if (quantity < 18) {
            unsupported = true;
            continue;
          }
          const embedded = note + 10,
            end = note + quantity,
            order = header(embedded, note, end);
          if (order === null) {
            unsupported = true;
            continue;
          }
          const first = view.getUint32(embedded + 4, order);
          if (!first) malformed('Nikon embedded first IFD is zero.');
          ifds(embedded, first, order, note, end, true);
        }
      }
      offset = view.getUint32(start + 2 + count * 12, little);
    }
  }
  function tiff(base: number, upper: number) {
    const order = header(base, base, upper);
    if (order === null) {
      unsupported = true;
      return;
    }
    const first = view.getUint32(base + 4, order);
    if (!first) malformed('Outer first IFD is zero.');
    ifds(base, first, order, base, upper, false);
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let pos = 2;
    while (pos < bytes.length) {
      abort(signal);
      if (bytes[pos] !== 0xff) malformed('Invalid JPEG segment marker.');
      while (bytes[pos] === 0xff) pos++;
      if (pos >= bytes.length) malformed('Truncated JPEG marker.');
      const marker = bytes[pos++]!;
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (marker === 0 || marker === 0xd8) malformed('Invalid JPEG marker.');
      range(pos, 2);
      const length = view.getUint16(pos, false);
      if (length < 2) malformed('Invalid JPEG segment length.');
      range(pos, length);
      const payload = pos + 2,
        end = pos + length;
      if (
        marker === 0xe1 &&
        length >= 8 &&
        [69, 120, 105, 102, 0, 0].every((b, k) => bytes[payload + k] === b)
      ) {
        charge(payload, length - 2);
        tiff(payload + 6, end);
      }
      pos = end;
    }
  } else tiff(0, bytes.length);
  const support =
      'Nikon MakerNote shutter-count tag in original JPEG/classic TIFF and supported TIFF-based NEF; metadata only',
    base: UtilityResult = { support, sourceTag: 'Nikon MakerNote0x00a7 (inline LONG1)' };
  if (make !== undefined) base.make = make;
  if (model !== undefined) base.model = model;
  if (make && !/^nikon\b/i.test(make)) return { ...base, status: 'unsupported' };
  const unique = new Set(counts);
  if (unique.size > 1) return { ...base, status: 'ambiguous' };
  if (unique.size === 1) return { ...base, status: 'found', count: counts[0]! };
  return { ...base, status: unsupported ? 'unsupported' : 'not-found' };
}
export const cameraShutterCountChecker: ToolModule<UtilityParams> = {
  ...direct(
    'camera-shutter-count-checker',
    'Nikon Camera Shutter Count',
    'Read Nikon MakerNote shutter-count tag in original JPEG/classic TIFF and supported TIFF-based NEF; metadata only.',
    buildingSpecs({}),
    async (inputs, params, ctx) => {
      abort(ctx.signal);
      validateUtilityParams({}, {}, params);
      if (inputs.length !== 1 || inputs[0]!.size > 64 * 1024 * 1024)
        throw new UtilityInputError(
          '$input',
          'budget',
          'Select one original file of at most64MiB.',
        );
      const file = inputs[0]!,
        prefix = new Uint8Array(await file.slice(0, 4).arrayBuffer());
      abort(ctx.signal);
      const jpeg = prefix[0] === 255 && prefix[1] === 216,
        tiff =
          (prefix[0] === 73 && prefix[1] === 73 && prefix[2] === 42 && prefix[3] === 0) ||
          (prefix[0] === 77 && prefix[1] === 77 && prefix[2] === 0 && prefix[3] === 42);
      if (!jpeg && !tiff)
        throw new UtilityInputError(
          '$input',
          'type',
          'Unsupported signature. Use original JPEG/classic TIFF or supported TIFF-based NEF; BigTIFF/raw decoding is unsupported.',
        );
      const bytes = new Uint8Array(await file.arrayBuffer());
      abort(ctx.signal);
      if (bytes.byteLength > 64 * 1024 * 1024)
        throw new UtilityInputError('$input', 'budget', 'Actual file exceeds64MiB.');
      return jsonArtifact(cameraMetadata(bytes, ctx.signal), ctx);
    },
    false,
    'medium',
  ),
  input: {
    accept: ['image/jpeg', 'image/tiff', '.nef'],
    min: 1,
    max: 1,
    sizeLimit: 64 * 1024 * 1024,
  },
};
export const hardwareTools: ToolModule<UtilityParams>[] = [
  gamepadTester,
  ppi,
  touchscreenTester,
  cameraShutterCountChecker,
  ohm,
  drop,
  wire,
  battery,
  tv,
  projector,
  generator,
  solar,
  led,
  ups,
  bank,
  speaker,
];
