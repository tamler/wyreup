import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolModule, ToolRunContext } from '../src/types.js';
import type { UtilityParams, UtilityResult } from '../src/utilities/common.js';

type Family = 'planning' | 'building' | 'hardware';
type Calculate = (id: string, params: UtilityParams, ctx: ToolRunContext) => UtilityResult | Promise<UtilityResult>;
const calculatorIds: Record<Family, string[]> = {
  "planning": [
    "bmi-calculator",
    "age-calculator",
    "time-zone-converter",
    "random-number-generator",
    "dice-roller",
    "coin-flip",
    "calorie-calculator",
    "gpa-calculator",
    "grade-calculator",
    "cocktail-dilution-calculator",
    "pool-volume-calculator",
    "aquarium-volume-calculator",
    "coffee-ratio-calculator",
    "rice-water-ratio-calculator",
    "turkey-thaw-time-calculator",
    "meat-cooking-time-calculator",
    "pizza-dough-calculator",
    "sourdough-calculator",
    "bread-hydration-calculator",
    "cake-pan-size-converter",
    "yeast-converter",
    "sewing-fabric-yardage-calculator",
    "shipping-dimensional-weight-calculator",
    "pallet-loading-calculator",
    "propane-usage-calculator",
    "photography-contract-generator"
  ],
  "building": [
    "paint-calculator",
    "concrete-bag-calculator",
    "gravel-calculator",
    "mulch-calculator",
    "roof-pitch-rafter-calculator",
    "tile-calculator-with-waste",
    "drywall-sheet-calculator",
    "fence-material-calculator",
    "deck-material-calculator",
    "paver-calculator",
    "topsoil-calculator",
    "sod-calculator",
    "hvac-btu-calculator",
    "insulation-calculator",
    "asphalt-driveway-calculator",
    "roofing-shingle-bundle-calculator",
    "retaining-wall-block-calculator",
    "pond-liner-calculator",
    "french-drain-gravel-calculator",
    "wallpaper-roll-calculator",
    "board-foot-calculator",
    "stair-stringer-calculator",
    "stud-wall-calculator",
    "pipe-volume-calculator",
    "ramp-slope-calculator",
    "gutter-size-calculator",
    "ac-tonnage-calculator"
  ],
  "hardware": [
    "screen-ppi-calculator",
    "ohms-law-calculator",
    "voltage-drop-calculator",
    "wire-size-calculator",
    "battery-runtime-calculator",
    "tv-viewing-distance-calculator",
    "projector-throw-distance-calculator",
    "generator-wattage-calculator",
    "solar-panel-output-calculator",
    "led-resistor-calculator",
    "ups-runtime-calculator",
    "solar-battery-bank-calculator",
    "speaker-box-volume-calculator"
  ]
};
const families: Family[] = ['planning', 'building', 'hardware'];
// Controlled wiring value only; original math suites and immutable BEFORE bytes are separate authorities.
const sentinel: UtilityResult = { unitSentinel: 'cohesive-private-engine', orderedValues: ['alpha', 'beta'] };
const firstIds: Record<Family, string> = { planning: 'bmi-calculator', building: 'paint-calculator', hardware: 'screen-ppi-calculator' };
const invalidParams: Record<Family, UtilityParams> = { planning: { age: 'not-a-number' }, building: { lengthM: 'not-a-number' }, hardware: { diagonalIn: 'not-a-number' } };
const inactiveDefaultKeys: Record<string, readonly string[]> = {
  'bmi-calculator': ['feet', 'inches'],
  'cocktail-dilution-calculator': ['dilutionPercent'],
  'aquarium-volume-calculator': ['diameterCm'],
  'coffee-ratio-calculator': ['waterG'],
  'rice-water-ratio-calculator': ['customRatio', 'customCookMinutes', 'customRestMinutes'],
  'cake-pan-size-converter': ['sourceWidth', 'targetWidth'],
  'yeast-converter': ['customFromFactor', 'customToFactor', 'gramsPerTeaspoon'],
  'shipping-dimensional-weight-calculator': ['customBasis', 'customDivisor', 'customRounding'],
  'propane-usage-calculator': ['customHeatingValue'],
  'hvac-btu-calculator': ['heatingWPerM2'],
};

function context(signal = new AbortController().signal, onProgress: ToolRunContext['onProgress'] = () => {}): ToolRunContext {
  return { signal, onProgress, cache: new Map(), executionId: 'cohesive-lazy-unit' };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function observe<T>(promise: Promise<T>) {
  return promise.then(value => ({ status: 'fulfilled' as const, value }), (reason: unknown) => ({ status: 'rejected' as const, reason }));
}
function mockEngine(family: Family, factory: () => Calculate | Promise<Calculate>) {
  if (family === 'planning') vi.doMock('../src/utilities/planning-calculations.js', async () => ({ calculatePlanning: await factory() }));
  else if (family === 'building') vi.doMock('../src/utilities/building-calculations.js', async () => ({ calculateBuilding: await factory() }));
  else vi.doMock('../src/utilities/hardware-calculations.js', async () => ({ calculateHardware: await factory() }));
}
function requireTool(tools: ReadonlyMap<string, ToolModule>, id: string) {
  const tool = tools.get(id);
  if (!tool) throw new Error('Expected source-bound public calculator: ' + id);
  return tool;
}
function expectAbort(outcome: Awaited<ReturnType<typeof observe>>) {
  expect(outcome.status).toBe('rejected');
  if (outcome.status !== 'rejected') throw new Error('Expected original cancellation refusal.');
  expect(outcome.reason).toMatchObject({ name: 'UtilityInputError', field: '$run', code: 'abort', message: '$run: Calculation cancelled.' });
}
async function oneJson(value: Blob | Blob[]) {
  const outputs = Array.isArray(value) ? value : [value];
  expect(outputs).toHaveLength(1);
  const output = outputs[0]!;
  expect(output).toBeInstanceOf(Blob);
  expect(output.type).toBe('application/json');
  return JSON.parse(await output.text()) as Record<string, unknown>;
}

describe('cohesive private calculators — controlled acquisition and settled-result seams', () => {
  const releases: Array<() => void> = [];
  const drains: Array<Promise<unknown>> = [];
  afterEach(async () => {
    try {
      for (const release of releases.splice(0)) release();
      await Promise.all(drains.splice(0));
    } finally {
      vi.doUnmock('../src/utilities/planning-calculations.js');
      vi.doUnmock('../src/utilities/building-calculations.js');
      vi.doUnmock('../src/utilities/hardware-calculations.js');
      vi.resetModules();
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    }
  });

  it('retains all73 public/registered metadata and sole public helper owners without acquiring engines', async () => {
    vi.resetModules();
    let entries = 0;
    for (const family of families) mockEngine(family, () => { entries++; return () => structuredClone(sentinel); });
    const source = await import('../src/index.js');
    const registry = source.createDefaultRegistry();
    const publicTools = [...source.planningTools, ...source.buildingTools, ...source.hardwareTools];
    expect(publicTools).toHaveLength(73);
    for (const tool of publicTools) {
      const registered = requireTool(registry.toolsById, tool.id);
      for (const key of Object.keys(tool)) if (key !== 'run') expect(Reflect.get(registered, key)).toEqual(Reflect.get(tool, key));
      expect(typeof registered.run).toBe('function');
    }
    const planning = await import('../src/utilities/planning.js'), planningShared = await import('../src/utilities/planning-shared.js');
    const building = await import('../src/utilities/building.js'), buildingShared = await import('../src/utilities/building-shared.js');
    const hardware = await import('../src/utilities/hardware.js'), hardwareShared = await import('../src/utilities/hardware-shared.js');
    for (const [facade, shared] of [[planning, planningShared], [building, buildingShared], [hardware, hardwareShared]] as const)
      for (const key of Object.keys(facade)) if (Object.hasOwn(shared, key)) expect(Reflect.get(facade, key)).toBe(Reflect.get(shared, key));
    expect(building.buildingUtility).toBe(buildingShared.buildingUtility);
    expect(entries).toBe(0);
  });

  it.each(families)('%s routes every exact calculator ID through its own engine with validated params/context', async family => {
    vi.resetModules();
    const calculate = vi.fn((_id: string, _params: UtilityParams, _ctx: ToolRunContext) => structuredClone(sentinel));
    mockEngine(family, () => calculate);
    const source = await import('../src/index.js'), registry = source.createDefaultRegistry();
    for (const id of calculatorIds[family]) {
      const tool = requireTool(registry.toolsById, id);
      const params = id === 'photography-contract-generator' ? { photographer: '<img src=x>', client: 'Client', project: 'Portrait session' } : {};
      const progress: unknown[] = [], ctx = context(undefined, event => { progress.push(structuredClone(event)); });
      const result = await oneJson(await tool.run([], params, ctx));
      expect(result.unitSentinel).toBe(sentinel.unitSentinel);
      expect(result.orderedValues).toEqual(sentinel.orderedValues);
      const expectedParams: UtilityParams = { ...(tool.defaults as UtilityParams), ...params };
      for (const key of inactiveDefaultKeys[id] ?? []) delete expectedParams[key];
      expect(calculate).toHaveBeenLastCalledWith(id, expectedParams, ctx);
      if (id === 'bmi-calculator') expect(calculate.mock.lastCall?.[1]).toEqual({ age: 30, weight: 70, weightUnit: 'kg', heightUnit: 'cm', heightCm: 175 });
      if (id === 'hvac-btu-calculator') expect(calculate.mock.lastCall?.[1]).toEqual({ mode: 'cooling', areaFt2: 200, ceilingFt: 8, occupants: 2, kitchen: false, shade: 'normal', additionalWindowBtuH: 0, climateFactor: 1 });
      expect(progress).toEqual([{ stage: 'done', percent: 100 }]);
    }
    expect(calculate.mock.calls.map(call => call[0])).toEqual(calculatorIds[family]);
  });

  it.each(families)('%s refuses invalid parameters and pre-abort before engine acquisition', async family => {
    vi.resetModules();
    let entries = 0;
    mockEngine(family, () => { entries++; return () => structuredClone(sentinel); });
    const source = await import('../src/index.js'), tool = requireTool(source.createDefaultRegistry().toolsById, firstIds[family]);
    await expect(tool.run([], invalidParams[family], context())).rejects.toMatchObject({ name: 'UtilityInputError', code: 'type' });
    const controller = new AbortController();
    controller.abort();
    expectAbort(await observe(tool.run([], {}, context(controller.signal))));
    expect(entries).toBe(0);
  });

  for (const family of families) it.each(['fulfill', 'reject'] as const)(family + ' aborts during import and observes late %s without calculation/progress/Blob', async settlement => {
    vi.resetModules();
    const entered = deferred<void>(), release = deferred<void>();
    releases.push(() => { release.resolve(); });
    const calculate = vi.fn((_id: string, _params: UtilityParams, _ctx: ToolRunContext) => structuredClone(sentinel));
    const loading = observe((async () => {
      await release.promise;
      if (settlement === 'reject') throw new Error('Owned cohesive late import rejection.');
      return calculate;
    })());
    drains.push(loading);
    mockEngine(family, async () => {
      entered.resolve();
      const outcome = await loading;
      if (outcome.status === 'rejected') throw outcome.reason;
      return outcome.value;
    });
    const source = await import('../src/index.js'), tool = requireTool(source.createDefaultRegistry().toolsById, firstIds[family]);
    const controller = new AbortController(), progress: unknown[] = [];
    const blobs = vi.spyOn(globalThis, 'Blob');
    const running = observe(tool.run([], {}, context(controller.signal, event => { progress.push(structuredClone(event)); })));
    drains.push(running);
    try {
      await entered.promise;
      expect(calculate).not.toHaveBeenCalled();
      controller.abort();
      expectAbort(await running);
      expect(progress).toEqual([]);
      expect(blobs).not.toHaveBeenCalled();
      release.resolve();
      expect((await loading).status).toBe(settlement === 'fulfill' ? 'fulfilled' : 'rejected');
      expect(calculate).not.toHaveBeenCalled();
      expect(progress).toEqual([]);
      expect(blobs).not.toHaveBeenCalled();
    } finally {
      release.resolve();
      await Promise.all(drains);
    }
  });

  it.each(families)('%s preserves the original thrown calculation Error reference', async family => {
    vi.resetModules();
    const original = new Error('Owned cohesive calculation refusal.');
    mockEngine(family, () => () => { throw original; });
    const source = await import('../src/index.js'), tool = requireTool(source.createDefaultRegistry().toolsById, firstIds[family]);
    const outcome = await observe(tool.run([], {}, context()));
    expect(outcome.status).toBe('rejected');
    if (outcome.status !== 'rejected') throw new Error('Expected calculation refusal.');
    expect(outcome.reason).toBe(original);
  });

  it.each(['building', 'hardware'] as const)('%s awaits the controlled Promise before original enrichment/progress/Blob', async family => {
    vi.resetModules();
    const entered = deferred<void>(), result = deferred<UtilityResult>();
    releases.push(() => { result.resolve(structuredClone(sentinel)); });
    const calculated = observe(result.promise);
    drains.push(calculated);
    mockEngine(family, () => (_id, _params, _ctx) => { entered.resolve(); return result.promise; });
    const source = await import('../src/index.js'), tool = requireTool(source.createDefaultRegistry().toolsById, firstIds[family]);
    const progress: unknown[] = [], ctx = context(undefined, event => { progress.push(structuredClone(event)); });
    const NativeBlob = globalThis.Blob;
    let blobCount = 0;
    class ObservedBlob extends NativeBlob {
      constructor(parts: BlobPart[] = [], options: BlobPropertyBag = {}) { super(parts, options); blobCount++; }
    }
    vi.stubGlobal('Blob', ObservedBlob);
    const running = observe(tool.run([], {}, ctx));
    drains.push(running);
    let settled = false;
    void running.then(() => { settled = true; });
    try {
      await entered.promise;
      expect(settled).toBe(false);
      expect(progress).toEqual([]);
      expect(blobCount).toBe(0);
      result.resolve(structuredClone(sentinel));
      const outcome = await running;
      expect(outcome.status).toBe('fulfilled');
      if (outcome.status !== 'fulfilled') throw outcome.reason;
      const actual = await oneJson(outcome.value);
      const shared = await import('../src/utilities/building-shared.js');
      const units = family === 'building' ? shared.BUILDING_UNITS : { ppi: 'pixels/inch', pixelPitchMm: 'millimetres/pixel', widthIn: 'inches', heightIn: 'inches' };
      const assumptions = family === 'building'
        ? ['Coverage is entered product label coverage; geometry does not predict surface absorption.']
        : ['Physical screen pixels and entered diagonal, not CSS viewport size.'];
      expect(actual).toEqual({ ...sentinel, units, assumptions });
      expect(Object.keys(actual)).toEqual(['unitSentinel', 'orderedValues', 'units', 'assumptions']);
      expect(progress).toEqual([{ stage: 'done', percent: 100 }]);
      expect(blobCount).toBe(1);
    } finally {
      result.resolve(structuredClone(sentinel));
      await Promise.all(drains);
    }
  });

  it('retains the original building output-limit refusal after a settled controlled value', async () => {
    vi.resetModules();
    mockEngine('building', () => () => ({ controlledOutOfBounds: Number.POSITIVE_INFINITY }));
    const source = await import('../src/index.js'), tool = requireTool(source.createDefaultRegistry().toolsById, 'paint-calculator');
    await expect(tool.run([], {}, context())).rejects.toMatchObject({ name: 'UtilityInputError', field: '$.result.controlledOutOfBounds', code: 'bounds' });
  });

  it('all three private dispatchers refuse unknown and inherited keys', async () => {
    vi.resetModules();
    const planning = await import('../src/utilities/planning-calculations.js');
    const building = await import('../src/utilities/building-calculations.js');
    const hardware = await import('../src/utilities/hardware-calculations.js');
    for (const id of ['unknown-cohesive-unit-key', 'toString', '__proto__']) {
      expect(() => planning.calculatePlanning(id, {}, context())).toThrow('$tool: Unknown planning calculator.');
      expect(() => building.calculateBuilding(id, {}, context())).toThrow('$tool: Unknown building calculator.');
      expect(() => hardware.calculateHardware(id, {}, context())).toThrow('$tool: Unknown hardware calculator.');
    }
  });
});

