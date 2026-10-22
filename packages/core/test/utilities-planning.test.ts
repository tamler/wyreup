import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { planningTools, bmiCategory, uniformInteger, sampleUniqueIntegers, parseGradeWeight, parsePlanningRows, cookingBand, validatePlanningSnapshot, safeCsvCell, seatingCsv, type SeatingPlan } from '../src/utilities/planning.js';
import type { ToolRunContext } from '../src/types.js';

const context = (): ToolRunContext => ({ signal: new AbortController().signal, executionId: 'planning-test', cache: new Map(), onProgress: () => {} });
async function run(id: string, params: Record<string, unknown> = {}) {
  const tool = planningTools.find(t => t.id === id)!;
  const output = await tool.run([], { ...tool.defaults, ...params }, context()); const blobs = Array.isArray(output) ? output : [output];
  expect(blobs).toHaveLength(1); expect(blobs[0]!.type).toBe('application/json');
  return JSON.parse(await blobs[0]!.text()) as Record<string, unknown>;
}
const near = (actual: unknown, expected: number) => expect(actual).toBeCloseTo(expected, 8);
describe('planning utility known answers and boundaries', () => {
  it.each([
    ['age-calculator', { birth: '2026-02-29' }, 'birth'],
    ['age-calculator', { asOf: '2026-02-29' }, 'asOf'],
    ['time-zone-converter', { wallTime: '2026-02-29T12:00' }, 'wallTime'],
    ['time-zone-converter', { sourceZone: 'Invalid/Zone' }, 'sourceZone'],
    ['time-zone-converter', { targetZones: 'Invalid/Zone' }, 'targetZones'],
    ['turkey-thaw-time-calculator', { start: '2026-02-29T12:00:00Z' }, 'start'],
    ['photography-contract-generator', { photographer: 'A', client: 'B', project: 'Session', deliveryDate: '2026-02-29' }, 'deliveryDate'],
  ] as const)('reports invalid Temporal input as a field error for %s/%s', async (id, params, field) => {
    await expect(run(id, params)).rejects.toMatchObject({ name: 'UtilityInputError', field, code: 'bounds' });
  });
  it('does not attribute a custom rice rest time to the manufacturer stove examples', async () => {
    for (const preset of ['mahatma-white-stove', 'mahatma-jasmine-stove']) {
      const result = await run('rice-water-ratio-calculator', { preset, customRestMinutes: 37 });
      expect(result.restMinutes).toBeNull();
      expect(result.note).toContain('does not specify a rest time');
    }
    expect(await run('rice-water-ratio-calculator', { preset: 'custom', customRestMinutes: 7 })).toMatchObject({ restMinutes: 7 });
  });
  it('contains exactly 29 distinct actual tools with complete parameter metadata', () => {
    expect(planningTools).toHaveLength(29); expect(new Set(planningTools.map(t => t.id)).size).toBe(29);
    for (const tool of planningTools) { expect(tool.category).toBe('planning'); expect(Object.keys(tool.defaults).sort()).toEqual(Object.keys(tool.paramSchema!).sort()); expect(tool.description.length).toBeGreaterThan(20); }
  });
  it('classifies unrounded adult BMI including all inclusive thresholds', async () => {
    const result = await run('bmi-calculator'); near(result.bmi, 22.857142857142858); expect(result.category).toBe('Healthy weight');
    expect([18.5, 25, 30, 35, 40].map(bmiCategory)).toEqual(['Healthy weight', 'Overweight', 'Class 1 obesity', 'Class 2 obesity', 'Class 3 obesity']); expect(bmiCategory(24.999999)).toBe('Healthy weight');
    await expect(run('bmi-calculator', { heightUnit: 'ft-in', inches: 12 })).rejects.toThrow(); await expect(run('bmi-calculator', { age: 19 })).rejects.toThrow();
  });
  it('uses independently known resting and activity estimates', async () => { const male = await run('calorie-calculator'); near(male.restingKcalPerDay, 1648.75); near(male.maintenanceKcalPerDay, 2473.125); const female = await run('calorie-calculator', { coefficient: 'female' }); near(female.restingKcalPerDay, 1482.75); near(female.maintenanceKcalPerDay, 2224.125); });
  it('preserves zero credits and returns explicit undefined-GPA status', async () => { near((await run('gpa-calculator')).gpa, 3.5); expect(await run('gpa-calculator', { rowsText: 'name,credits,points\nZero,0,0' })).toMatchObject({ gpa: null, totalCredits: 0, qualityPoints: 0, status: 'no-credit', excludedZeroCreditRows: 1 }); });
  it('uses exact weight hundredths and distinguishes impossible/final/no-history grades', async () => {
    const result = await run('grade-calculator'); near(result.completedContribution, 59); near(result.neededGrade, 86.66666666666667);
    expect(['33.33', '33.33', '33.34'].map(parseGradeWeight)).toEqual([3333, 3333, 3334]);
    expect(await run('grade-calculator', { rowsText: '', remainingWeight: '100' })).toMatchObject({ neededGrade: 85, completedAverage: null });
    expect(await run('grade-calculator', { rowsText: 'name,grade,weight\nZero,0,70', remainingWeight: '30' })).toMatchObject({ status: 'unattainable' });
    expect(await run('grade-calculator', { rowsText: 'name,grade,weight\nDone,0,100', remainingWeight: '0' })).toMatchObject({ neededGrade: null, finalGrade: 0, status: 'final-below' });
    for (const value of ['', '00.10', '33.333', '1e2', '+1', '.5', '100.01']) expect(() => parseGradeWeight(value)).toThrow();
    await expect(run('grade-calculator', { remainingWeight: 30 })).rejects.toThrow();
  });
  it('parses named/reordered quoted/multiline CSV without blank numeric coercion', () => {
    const rows = parsePlanningRows('points,name,credits\n4,"A, B\nC",3', 'gpa'); expect(rows[0]).toMatchObject({ name: 'A, B\nC', first: 3, second: 4 });
    expect(parsePlanningRows('name\tgrade\tweight\nG\t0\t33.30', 'grade', '\t')[0]).toMatchObject({ first: 0, second: 3330, weightText: '33.30' });
    for (const input of ['name,credits,points\nA,,4', 'name,name,points\nA,3,4', 'name,credits,points,other\nA,3,4,5', 'name,credits,points\nA,Infinity,4']) expect(() => parsePlanningRows(input, 'gpa')).toThrow();
    expect(() => parsePlanningRows('a'.repeat(102401), 'gpa')).toThrow(); expect(() => parsePlanningRows('name,credits,points\n' + 'A,1,1\n'.repeat(201), 'gpa')).toThrow();
  });
  it('uses measured dilution once for ABV percentages', async () => { const r = await run('cocktail-dilution-calculator'); near(r.ethanolMl, 24); near(r.finalMl, 110); near(r.finalAbvPercent, 21.818181818181817); near(r.dilutionPercent, 22.22222222222222); const target = await run('cocktail-dilution-calculator', { mode: 'target-dilution', dilutionPercent: 100 }); near(target.finalMl, 180); near(target.finalAbvPercent, 13.333333333333334); await expect(run('cocktail-dilution-calculator', { rowsText: 'name,volumeMl,abvPercent\nZero,0,0' })).rejects.toThrow(); });
  it('matches independent geometric, brew and rice constants', async () => {
    const p = await run('pool-volume-calculator'); near(p.liters, 48000); near(p.fillMinutes, 2400);
    const aquarium = await run('aquarium-volume-calculator'); near(aquarium.waterLiters, 54); near(aquarium.substrateGrossLiters, 9); near((await run('aquarium-volume-calculator', { shape: 'cylinder' })).waterLiters, 37.69911184307752);
    near((await run('coffee-ratio-calculator')).waterG, 320); near((await run('coffee-ratio-calculator', { mode: 'water-to-coffee' })).coffeeG, 20);
    expect(await run('rice-water-ratio-calculator')).toMatchObject({ waterVolume: 2, cookMinutes: 20 }); expect(await run('rice-water-ratio-calculator', { preset: 'mahatma-jasmine-stove' })).toMatchObject({ waterVolume: 1.5, cookMinutes: 15 }); await expect(run('rice-water-ratio-calculator', { unit: 'g' })).rejects.toThrow();
  });
  it('matches baker percentage and starter accounting oracles', async () => {
    const p = await run('pizza-dough-calculator'); near(p.flourG, 598.0861244019139); near(p.waterG, 388.755980861244); near(p.saltG, 11.961722488038278); near(p.yeastG, 1.1961722488038278); near(Number(p.flourG) + Number(p.waterG) + Number(p.saltG) + Number(p.yeastG) + Number(p.oilG), 1000);
    const sour = await run('sourdough-calculator'); near(sour.totalFlourG, 581.3953488372093); near(sour.starterG, 116.27906976744187); near(sour.addedFlourG, 523.2558139534884); near(sour.addedWaterG, 348.83720930232556); near(sour.saltG, 11.627906976744187); near(Number(sour.addedFlourG) + Number(sour.addedWaterG) + Number(sour.starterG) + Number(sour.saltG), 1000);
    const b = await run('bread-hydration-calculator'); near(b.totalFlourG, 550); near(b.totalWaterG, 400); near(b.hydrationPercent, 72.72727272727273); near(b.totalG, 960);
    await expect(run('sourdough-calculator', { hydrationPercent: 20, starterPercent: 100, starterHydrationPercent: 300 })).rejects.toThrow();
  });
  it('matches recipe scaling, yeast roundtrip and fabric orientation', async () => {
    near((await run('cake-pan-size-converter')).areaFactor, 1.265625); near((await run('cake-pan-size-converter', { targetCount: 2 })).volumeFactor, 2.53125);
    near((await run('yeast-converter')).resultG, 5.775); near((await run('yeast-converter', { from: 'instant', to: 'active-dry', amount: 5.775 })).resultG, 7);
    near((await run('yeast-converter', { equivalence: 'custom', customFromFactor: 2, customToFactor: 0.5, amount: 7 })).resultG, 1.75);
    await expect(run('yeast-converter', { equivalence: 'custom', customFromFactor: 0 })).rejects.toThrow();
    near((await run('sewing-fabric-yardage-calculator')).finalLengthCm, 70.4); await expect(run('sewing-fabric-yardage-calculator', { rollWidthCm: 1 })).rejects.toThrow();
  });
  it('matches UPS unit parity, axis rounding and pallet tie order', async () => {
    const shipping = await run('shipping-dimensional-weight-calculator'); near(shipping.billableWeight, 13); near(shipping.billableKg, 5.89670081);
    near((await run('shipping-dimensional-weight-calculator', { inputUnits: 'cm-kg', length: 30.48, width: 30.48, height: 30.48, mass: 4.5359237 })).billableWeight, 13);
    expect((await run('shipping-dimensional-weight-calculator', { length: 10.5 })).axes).toEqual([11, 12, 12]); await expect(run('shipping-dimensional-weight-calculator', { length: 0.4 })).rejects.toThrow();
    expect(await run('pallet-loading-calculator')).toMatchObject({ cartonCount: 48, orientationCm: [40, 25, 30], grossKg: 260, loadedHeightCm: 135 });
  });
  it('matches explicit propane energy and zero-duration behavior', async () => { const r = await run('propane-usage-calculator'); near(r.energyBtu, 160000); near(r.usGallons, 1.7501640778823015); near(r.cost, 5.250492233646904); near(r.runtimeHours, 22.855); expect(await run('propane-usage-calculator', { durationHours: 0, availableGallons: 0, pricePerGallon: 0 })).toMatchObject({ energyBtu: 0, usGallons: 0, runtimeHours: 0, cost: 0 }); await expect(run('propane-usage-calculator', { dutyPercent: 0 })).rejects.toThrow(); });
  it('uses actual roast bands and safe temperature/rest instructions', async () => {
    expect(await run('meat-cooking-time-calculator')).toMatchObject({ minMinutes: 115, maxMinutes: 125, ovenF: 325, internalF: 145, restMinutes: 3 }); expect(cookingBand('turkey-whole-unstuffed', 12)).toMatchObject({ minMinutes: 180, maxMinutes: 225, internalF: 165 }); expect(cookingBand('turkey-whole-unstuffed', 24)).toMatchObject({ minMinutes: 270, maxMinutes: 300 }); expect(() => cookingBand('chicken-whole-unstuffed', 4.5)).toThrow(); expect(() => cookingBand('rare-steak', 5)).toThrow();
    expect(await run('turkey-thaw-time-calculator')).toMatchObject({ minDays: 2.4, maxDays: 3 }); expect(await run('turkey-thaw-time-calculator', { method: 'cold-water', start: '2026-01-01T00:00:00Z' })).toMatchObject({ minHours: 6, earliestFinish: '2026-01-01T06:00:00Z' }); await expect(run('turkey-thaw-time-calculator', { start: '2026-02-31T00:00:00Z' })).rejects.toThrow();
  });
  it('generates an original literal editable contract draft with bounded particulars', async () => { const r = await run('photography-contract-generator', { photographer: '<img src=x>', client: 'Client', project: 'Portrait session', fee: 100, deposit: 25 }); expect(r.draft).toContain('<img src=x>'); expect(r.draft).toContain('Balance: 75 USD'); expect(r.draft).toContain('Draft for review'); await expect(run('photography-contract-generator')).rejects.toThrow(); await expect(run('photography-contract-generator', { photographer: 'A', client: 'B', project: 'P', deposit: 1 })).rejects.toThrow(); await expect(run('photography-contract-generator', { photographer: 'A', client: 'B', project: 'P', date: '2026-02-29' })).rejects.toThrow(); });
  it('rejects invalid scalar inputs and aborted runs before output', async () => { for (const value of [NaN, Infinity, -1, null, '2']) await expect(run('pizza-dough-calculator', { ballG: value })).rejects.toThrow(); const tool = planningTools.find(t => t.id === 'pizza-dough-calculator')!; const controller = new AbortController(); controller.abort(); await expect(tool.run([], tool.defaults, { ...context(), signal: controller.signal })).rejects.toThrow(); });
});

describe('real calendar and IANA conversion', () => {
  it('locks ordinary birthday and leap/non-leap policy oracles', async () => {
    expect(await run('age-calculator')).toMatchObject({ years: 36, birthdayToday: true, daysUntilBirthday: 0, nextAnniversary: '2027-01-01' });
    for (const leapPolicy of ['feb28', 'mar1']) {
      expect(await run('age-calculator', { birth: '2000-02-29', asOf: '2024-02-28', leapPolicy })).toMatchObject({ birthdayToday: false, daysUntilBirthday: 1, nextAnniversary: '2024-02-29' });
      expect(await run('age-calculator', { birth: '2000-02-29', asOf: '2024-02-29', leapPolicy })).toMatchObject({ years: 24, months: 0, days: 0, totalDays: 8766, birthdayToday: true, daysUntilBirthday: 0, nextAnniversary: leapPolicy === 'feb28' ? '2025-02-28' : '2025-03-01' });
      expect(await run('age-calculator', { birth: '2000-02-29', asOf: '2024-03-01', leapPolicy })).toMatchObject({ years: 24, months: 0, days: 1, totalDays: 8767, birthdayToday: false, daysUntilBirthday: leapPolicy === 'feb28' ? 364 : 365, nextAnniversary: leapPolicy === 'feb28' ? '2025-02-28' : '2025-03-01' });
    }
    expect(await run('age-calculator', { birth: '2000-02-29', asOf: '2026-02-28', leapPolicy: 'feb28' })).toMatchObject({ birthdayToday: true, daysUntilBirthday: 0, nextAnniversary: '2027-02-28', totalDays: 9496 });
    expect(await run('age-calculator', { birth: '2000-02-29', asOf: '2026-02-28', leapPolicy: 'mar1' })).toMatchObject({ birthdayToday: false, daysUntilBirthday: 1, nextAnniversary: '2026-03-01', totalDays: 9496 });
    expect(await run('age-calculator', { birth: '2000-02-29', asOf: '2026-03-01', leapPolicy: 'feb28' })).toMatchObject({ birthdayToday: false, daysUntilBirthday: 364, nextAnniversary: '2027-02-28', totalDays: 9497 });
    expect(await run('age-calculator', { birth: '2000-02-29', asOf: '2026-03-01', leapPolicy: 'mar1' })).toMatchObject({ birthdayToday: true, daysUntilBirthday: 0, nextAnniversary: '2027-03-01', totalDays: 9497 });
    for (const birth of ['1900-02-29', '2026-02-29', '2100-02-29']) await expect(run('age-calculator', { birth, asOf: '2100-12-31' })).rejects.toThrow();
  });
  it('rejects DST gaps for every choice and disambiguates folds', async () => {
    for (const repeated of ['reject', 'earlier', 'later']) await expect(run('time-zone-converter', { sourceZone: 'America/New_York', wallTime: '2026-03-08T02:30', repeated })).rejects.toThrow('Nonexistent');
    await expect(run('time-zone-converter', { sourceZone: 'America/New_York', wallTime: '2026-11-01T01:30' })).rejects.toThrow('Repeated');
    expect(await run('time-zone-converter', { sourceZone: 'America/New_York', wallTime: '2026-11-01T01:30', repeated: 'earlier' })).toMatchObject({ instant: '2026-11-01T05:30:00Z', sourceOffset: '-04:00' });
    expect(await run('time-zone-converter', { sourceZone: 'America/New_York', wallTime: '2026-11-01T01:30', repeated: 'later' })).toMatchObject({ instant: '2026-11-01T06:30:00Z', sourceOffset: '-05:00' });
    expect(await run('time-zone-converter', { sourceZone: 'Asia/Kolkata', wallTime: '2026-01-15T00:00', targetZones: 'UTC' })).toMatchObject({ instant: '2026-01-14T18:30:00Z', targets: [{ zone: 'UTC', wallTime: '2026-01-14T18:30:00', offset: '+00:00' }] });
    await expect(run('time-zone-converter', { sourceZone: 'Invalid/Zone' })).rejects.toThrow();
  });
});
describe('cryptographic sampling contract', () => {
  it('rejects the biased tail, validates entropy and caps retries precisely', () => {
    const values = [4294967295, 7]; expect(uniformInteger(1, 6, () => values.shift()!)).toBe(2);
    expect(uniformInteger(0, 4294967295, () => 4294967295)).toBe(4294967295);
    let reads = 0; expect(() => uniformInteger(5, 1, () => { reads++; return 0; })).toThrow(); expect(reads).toBe(0);
    expect(() => uniformInteger(1, 6, () => 4294967295)).toThrow('limit'); let attempts = 0; expect(uniformInteger(1, 6, () => ++attempts < 128 ? 4294967295 : 7)).toBe(2); expect(attempts).toBe(128);
    for (const entropy of [NaN, -1, 1.1, 4294967296]) expect(() => uniformInteger(1, 6, () => entropy)).toThrow();
  });
  it('samples full and near-capacity ranges without duplicates or retry loops', () => { const all = sampleUniqueIntegers(-2, 3, 6, () => 0); expect([...all].sort((a, b) => a - b)).toEqual([-2, -1, 0, 1, 2, 3]); expect(sampleUniqueIntegers(1, 1, 0, () => 0)).toEqual([]); expect(() => sampleUniqueIntegers(1, 2, 3, () => 0)).toThrow(); const controller = new AbortController(); controller.abort(); expect(() => uniformInteger(1, 6, () => 1, controller.signal)).toThrow(); });
  it('runs real stateless dice/coin modules with bounded valid outcomes', async () => { const dice = await run('dice-roller', { count: 100, modifier: -1 }); const values = dice.values as number[]; expect(values.every(v => Number.isInteger(v) && v >= 1 && v <= 6)).toBe(true); expect(dice.total).toBe(values.reduce((a, b) => a + b, 0) - 1); const coin = await run('coin-flip', { count: 1000 }); expect(Number(coin.heads) + Number(coin.tails)).toBe(1000); expect(coin.values).toHaveLength(1000); expect(coin.longestStreak).toBeGreaterThan(0); });
  it('runs the actual number generator at maximum unique count and rejects reversed bounds', async () => { const r = await run('random-number-generator', { min: -500, max: 499, count: 1000, unique: true }); const values = r.values as number[]; expect([...values].sort((a, b) => a - b)).toEqual(Array.from({ length: 1000 }, (_, i) => i - 500)); await expect(run('random-number-generator', { min: 2, max: 1 })).rejects.toThrow(); });
});

describe('actual session files, strict schemas and formula-safe CSV', () => {
  const empty: SeatingPlan = { version: 1, kind: 'seating', guests: [], tables: [], assignments: [] };
  it('runs all three actual metadata fixtures and reimports countdown output', async () => {
    for (const tool of planningTools.filter(t => t.surfaces?.includes('web'))) {
      const raw = await readFile(new URL(`../${tool.__testFixtures.valid[0]!}`, import.meta.url)); const file = new File([raw], 'session.json', { type: 'application/json' }); const output = await tool.run([file], {}, context()); const blobs = Array.isArray(output) ? output : [output]; expect(blobs).toHaveLength(1); expect(blobs[0]!.type).toBe(tool.output.mime);
      if (tool.id === 'countdown-timer') expect(validatePlanningSnapshot(JSON.parse(await blobs[0]!.text()) as unknown, 'countdown')).toMatchObject({ state: 'running', elapsedMs: 12000 });
    }
  });
  it('rejects broken lap/done/unknown/deep session data', () => {
    for (const value of [{ version: 1, kind: 'stopwatch', state: 'paused', elapsedMs: 20, laps: [{ totalMs: 10, deltaMs: 9 }] }, { version: 1, kind: 'countdown', state: 'done', durationMs: 1000, elapsedMs: 0 }, { ...empty, extra: true }, JSON.parse('{"version":1,"kind":"seating","guests":[],"tables":[],"assignments":[],"__proto__":{}}') as unknown]) expect(() => validatePlanningSnapshot(value)).toThrow();
  });
  it('rejects ID collisions, duplicate/multiple/orphan assignments and capacity overflow', () => {
    const plan: SeatingPlan = { ...empty, guests: [{ id: 'a', name: 'Alex' }, { id: 'b', name: 'Alex' }], tables: [{ id: 't', name: 'One', capacity: 1 }], assignments: [{ guestId: 'a', tableId: 't' }] };
    expect(validatePlanningSnapshot(plan)).toEqual(plan);
    const cases = [{ ...plan, guests: [...plan.guests, { id: 'a', name: 'Other' }] }, { ...plan, tables: [{ id: 'a', name: 'Conflict', capacity: 1 }] }, { ...plan, assignments: [...plan.assignments, { guestId: 'a', tableId: 't' }] }, { ...plan, assignments: [...plan.assignments, { guestId: 'b', tableId: 't' }] }, { ...plan, assignments: [{ guestId: 'missing', tableId: 't' }] }, { ...plan, assignments: [{ guestId: 'a', tableId: 'missing' }] }];
    for (const value of cases) expect(() => validatePlanningSnapshot(value)).toThrow();
  });
  it('roundtrips maximum astral/escaped-label plans and neutralizes formula cells', () => {
    const tables = Array.from({ length: 100 }, (_, i) => ({ id: `t${i}`, name: '😀'.repeat(120), capacity: 5 })); const guests = Array.from({ length: 500 }, (_, i) => ({ id: `g${i}`, name: '😀'.repeat(120) })); const assignments = guests.map((g, i) => ({ guestId: g.id, tableId: `t${Math.floor(i / 5)}` })); const plan = { version: 1, kind: 'seating', tables, guests, assignments };
    expect(validatePlanningSnapshot(JSON.parse(JSON.stringify(plan)) as unknown)).toEqual(plan); expect(new TextEncoder().encode(JSON.stringify(plan)).length).toBeLessThan(445600);
    const escaped = { ...plan, tables: tables.map(t => ({ ...t, name: '"\\'.repeat(60) })), guests: guests.map(g => ({ ...g, name: '"\\'.repeat(60) })) };
    expect(validatePlanningSnapshot(JSON.parse(JSON.stringify(escaped)) as unknown)).toEqual(escaped); expect(new TextEncoder().encode(JSON.stringify(escaped)).length).toBeLessThan(445600);
    expect(safeCsvCell(' =HYPERLINK("x")')).toBe('"\' =HYPERLINK(""x"")"'); expect(safeCsvCell('\tvalue')).toBe('"\'\tvalue"'); expect(safeCsvCell(-1)).toBe('"-1"');
    expect(seatingCsv({ ...empty, guests: [{ id: 'g', name: '=1+1' }] })).toContain("'=1+1");
    expect(() => validatePlanningSnapshot({ ...empty, guests: [{ id: 'g', name: '\uD800' }] })).toThrow();
  });
});
