import type { ToolRunContext } from '../types.js';
import { UtilityInputError, type UtilityParams, type UtilityResult } from './common.js';
import { bmiCategory, cookingBand, invalid, n, parseGradeWeight, parsePlanningRows, s, sampleUniqueIntegers, secureUint32, temporalDate, temporalInput, uniformInteger, validateContractParticulars } from './planning-shared.js';

const LB_KG = 0.45359237;
const OZ_G = 28.349523125;
const GALLON_L = 3.785411784;
const positive = (p: UtilityParams, key: string, max = 1e9) => { const value = n(p, key, max); if (!value) invalid(key, 'Must be greater than zero.'); return value; };
async function finishRange(start: string, minMinutes: number, maxMinutes: number): Promise<UtilityResult> {
  if (!start) return { earliestFinish: null, latestFinish: null, finishStatus: 'no-start-time' };
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(start) || /:60(?:[.Z+-])/.test(start)) invalid('start', 'Use a full RFC3339 timestamp with seconds and an offset.');
  const { Temporal } = await import('@js-temporal/polyfill'); const instant = temporalInput('start', 'Use a valid RFC3339 instant.', () => Temporal.Instant.from(start));
  return { earliestFinish: instant.add({ milliseconds: Math.round(minMinutes * 60000) }).toString(), latestFinish: instant.add({ milliseconds: Math.round(maxMinutes * 60000) }).toString(), finishStatus: 'elapsed-instant-estimate' };
}
type Calculate = (p: UtilityParams, ctx: ToolRunContext) => UtilityResult | Promise<UtilityResult>;

const calculations: Record<string, Calculate> = {
  "bmi-calculator": p => {
    const kg = n(p, 'weight', 1103) * (p.weightUnit === 'lb' ? LB_KG : 1);
    const inches = p.heightUnit === 'ft-in' ? n(p, 'inches', 12) : 0;
    if (inches >= 12) invalid('inches', 'Inches must be less than 12.');
    const cm = p.heightUnit === 'cm' ? n(p, 'heightCm', 275, 90) : (n(p, 'feet', 9, 0, true) * 12 + inches) * 2.54;
    if (kg < 25 || kg > 500 || cm < 90 || cm > 275) invalid('measurements', 'Adult bounds: 25–500 kg and 90–275 cm.');
    const value = kg / (cm / 100) ** 2;
    return { bmi: value, category: bmiCategory(value), weightKg: kg, heightCm: cm, note: 'Adult screening category; BMI does not diagnose health.', source: 'https://www.cdc.gov/bmi/adult-calculator/bmi-categories.html' };
  },
  "age-calculator": async p => {
    const birth = await temporalDate(s(p, 'birth'), 'birth'); const asOf = await temporalDate(s(p, 'asOf'), 'asOf');
    const { Temporal } = await import('@js-temporal/polyfill');
    if (Temporal.PlainDate.compare(birth, asOf) > 0) invalid('birth', 'Birth must be on or before the as-of date.');
    const anniversary = (year: number) => {
      const leap = Temporal.PlainDate.from({ year, month: 1, day: 1 }).inLeapYear;
      const fallback = birth.month === 2 && birth.day === 29 && !leap;
      return Temporal.PlainDate.from({ year, month: fallback && p.leapPolicy === 'mar1' ? 3 : birth.month, day: fallback ? (p.leapPolicy === 'mar1' ? 1 : 28) : birth.day }, { overflow: 'reject' });
    };
    const thisYear = anniversary(asOf.year); const birthdayToday = thisYear.equals(asOf);
    const next = Temporal.PlainDate.compare(thisYear, asOf) <= 0 ? anniversary(asOf.year + 1) : thisYear;
    const elapsed = birth.until(asOf, { largestUnit: 'years' });
    return { years: elapsed.years, months: elapsed.months, days: elapsed.days, totalDays: birth.until(asOf, { largestUnit: 'days' }).days, birthdayToday, nextAnniversary: next.toString(), daysUntilBirthday: birthdayToday ? 0 : asOf.until(next, { largestUnit: 'days' }).days, leapPolicy: s(p, 'leapPolicy'), note: 'Calendar calculation; not a legal age determination.' };
  },
  "time-zone-converter": async p => {
    const { Temporal } = await import('@js-temporal/polyfill');
    const raw = s(p, 'wallTime');
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(raw) || /:60$/.test(raw)) invalid('wallTime', 'Use YYYY-MM-DDTHH:mm[:ss], without leap seconds.');
    const wall = temporalInput('wallTime', 'Use a valid local date and time.', () => Temporal.PlainDateTime.from(raw, { overflow: 'reject' }));
    if (wall.year < 1900 || wall.year > 2100) invalid('wallTime', 'Years must be 1900–2100.');
    const sourceZone = s(p, 'sourceZone');
    if (/^[+-]/.test(sourceZone)) invalid('sourceZone', 'Use an IANA zone, not a fixed offset.');
    const earlier = temporalInput('sourceZone', 'Use a supported IANA time zone.', () => wall.toZonedDateTime(sourceZone, { disambiguation: 'earlier' }));
    const later = temporalInput('sourceZone', 'Use a supported IANA time zone.', () => wall.toZonedDateTime(sourceZone, { disambiguation: 'later' }));
    const earlierMatches = earlier.toPlainDateTime().equals(wall); const laterMatches = later.toPlainDateTime().equals(wall);
    if (!earlierMatches && !laterMatches) invalid('wallTime', 'Nonexistent local time during a DST gap.');
    const repeated = earlierMatches && laterMatches && earlier.epochNanoseconds !== later.epochNanoseconds;
    if (repeated && p.repeated === 'reject') invalid('repeated', 'Repeated local time: choose earlier or later.');
    const chosen = repeated && p.repeated === 'later' ? later : earlierMatches ? earlier : later;
    const zones = s(p, 'targetZones').split(/\r?\n|,/).map(z => z.trim()).filter(Boolean);
    if (!zones.length || zones.length > 12 || new Set(zones).size !== zones.length) invalid('targetZones', 'Enter 1–12 distinct IANA zones.');
    const targets = zones.map(zone => {
      if (/^[+-]/.test(zone)) invalid('targetZones', 'Use IANA zones, not fixed offsets.');
      const target = temporalInput('targetZones', 'Use supported IANA time zones.', () => chosen.toInstant().toZonedDateTimeISO(zone));
      return { zone, wallTime: target.toPlainDateTime().toString(), offset: target.offset };
    });
    return { instant: chosen.toInstant().toString(), sourceZone, sourceOffset: chosen.offset, repeatedTime: repeated, targets, note: 'IANA rules supplied by this runtime; future rules may change.' };
  },
  "random-number-generator": (p, ctx) => {
    const min = n(p, 'min', 1e9, -1e9, true); const max = n(p, 'max', 1e9, -1e9, true); const count = n(p, 'count', 1000, 1, true);
    const values = p.unique === true ? sampleUniqueIntegers(min, max, count, secureUint32, ctx.signal) : Array.from({ length: count }, () => uniformInteger(min, max, secureUint32, ctx.signal));
    return { values, count, min, max, mode: p.unique === true ? 'without replacement' : 'independent draws' };
  },
  "dice-roller": (p, ctx) => {
    const sides = n(p, 'sides', 1000, 2, true); const count = n(p, 'count', 100, 1, true); const modifier = n(p, 'modifier', 100000, -100000, true);
    const values = Array.from({ length: count }, () => uniformInteger(1, sides, secureUint32, ctx.signal)); const subtotal = values.reduce((a, b) => a + b, 0);
    return { values, sides, count, modifier, subtotal, total: subtotal + modifier };
  },
  "coin-flip": (p, ctx) => {
  const values = Array.from({ length: n(p, 'count', 1000, 1, true) }, () => uniformInteger(0, 1, secureUint32, ctx.signal));
  let streak = 0; let longestStreak = 0; let previous = -1;
  for (const value of values) { streak = value === previous ? streak + 1 : 1; previous = value; longestStreak = Math.max(streak, longestStreak); }
  const heads = values.filter(v => v === 1).length;
  return { values: values.map(v => v ? 'Heads' : 'Tails'), heads, tails: values.length - heads, count: values.length, headRatio: heads / values.length, longestStreak };
},
  "calorie-calculator": p => {
    const resting = 10 * n(p, 'weightKg', 300, 25) + 6.25 * n(p, 'heightCm', 250, 100) - 5 * n(p, 'age', 78, 20, true) + (p.coefficient === 'male' ? 5 : -161);
    return { restingKcalPerDay: resting, maintenanceKcalPerDay: resting * n(p, 'multiplier', 2.5, 1), multiplier: n(p, 'multiplier', 2.5, 1), equation: 'Mifflin–St Jeor', note: 'Equation and activity scenario estimates; no intake prescription.', source: 'https://pubmed.ncbi.nlm.nih.gov/2305711/' };
  },
  "gpa-calculator": (p, ctx) => {
  const rows = parsePlanningRows(s(p, 'rowsText'), 'gpa', s(p, 'delimiter'), p.hasHeader === true, n(p, 'scale', 10, 1), ctx.signal);
  const totalCredits = rows.reduce((a, row) => a + row.first, 0); const qualityPoints = rows.reduce((a, row) => a + row.first * row.second, 0);
  return { gpa: totalCredits ? qualityPoints / totalCredits : null, totalCredits, qualityPoints, excludedZeroCreditRows: rows.filter(row => row.first === 0).length, status: totalCredits ? 'calculated' : 'no-credit', courses: rows.map(row => ({ name: row.name, credits: row.first, points: row.second })) };
},
  "grade-calculator": (p, ctx) => {
  const rows = parsePlanningRows(s(p, 'rowsText'), 'grade', s(p, 'delimiter'), p.hasHeader === true, 4, ctx.signal); const remaining = parseGradeWeight(p.remainingWeight);
  const completed = rows.reduce((a, row) => a + row.second, 0);
  if (completed + remaining !== 10000) invalid('weight', 'Completed and remaining weights must total exactly 100%.');
  const weighted = rows.reduce((a, row) => a + row.first * row.second, 0); const contribution = weighted / 10000; const target = n(p, 'target', 100);
  const needed = remaining ? Math.max(0, (target - contribution) * 10000 / remaining) : null;
  return { completedContribution: contribution, completedAverage: completed ? weighted / completed : null, remainingWeightPercent: remaining / 100, neededGrade: needed, finalGrade: remaining ? null : contribution, status: remaining ? (needed! > 100 ? 'unattainable' : 'calculated') : contribution >= target ? 'final-met' : 'final-below', work: rows.map(row => ({ name: row.name, grade: row.first, weightPercent: row.second / 100 })) };
},
  "cocktail-dilution-calculator": (p, ctx) => {
  const rows = parsePlanningRows(s(p, 'rowsText'), 'cocktail', s(p, 'delimiter'), p.hasHeader === true, 4, ctx.signal); const initial = rows.reduce((a, r) => a + r.first, 0);
  if (!initial) invalid('volume', 'Initial volume must be greater than zero.');
  const ethanol = rows.reduce((a, r) => a + r.first * r.second / 100, 0); const added = p.mode === 'added-water' ? n(p, 'waterMl', 10000) : initial * n(p, 'dilutionPercent', 1000) / 100;
  if (added > 10000) invalid('water', 'Derived added water exceeds 10000 mL.');
  return { initialMl: initial, ethanolMl: ethanol, addedWaterMl: added, finalMl: initial + added, finalAbvPercent: 100 * ethanol / (initial + added), dilutionPercent: 100 * added / initial, waterFractionOfFinal: added / (initial + added), note: 'Measured dilution calculation; stirring time does not determine melt water.' };
},
  "pool-volume-calculator": p => {
  const averageDepthM = (positive(p, 'shallowM', 100) + positive(p, 'deepM', 100)) / 2; const liters = positive(p, 'lengthM', 1000) * positive(p, 'widthM', 1000) * averageDepthM * (p.shape === 'oval' ? Math.PI / 4 : 1) * 1000;
  return { liters, cubicMeters: liters / 1000, usGallons: liters / GALLON_L, approximateWaterKg: liters, averageDepthM, fillMinutes: p.includeFlow === true ? liters / positive(p, 'flowLPerMinute', 100000) : null, fillStatus: p.includeFlow === true ? 'calculated' : 'not-requested', assumption: 'Geometric approximation with average depth and approximately 1 kg per liter of water.' };
},
  "aquarium-volume-calculator": p => {
  const area = p.shape === 'rectangle' ? positive(p, 'lengthCm', 1000) * positive(p, 'widthCm', 1000) : Math.PI * (positive(p, 'diameterCm', 1000) / 2) ** 2; const water = positive(p, 'waterDepthCm', 1000); const substrate = n(p, 'substrateDepthCm', 1000);
  if (water + substrate > positive(p, 'tankHeightCm', 1000)) invalid('depth', 'Water plus substrate exceeds tank height.');
  return { waterLiters: area * water / 1000, substrateGrossLiters: area * substrate / 1000, note: 'Clear water depth excludes substrate; substrate is not subtracted again. Decoration displacement is not included.' };
},
  "coffee-ratio-calculator": p => {
  const ratio = n(p, 'ratio', 30, 1); const coffeeG = p.mode === 'coffee-to-water' ? positive(p, 'coffeeG', 100000) : positive(p, 'waterG', 100000) / ratio;
  return { coffeeG, waterG: coffeeG * ratio, ratio, note: 'Mass ratio; no density conversion or brewing quality guarantee.' };
},
  "rice-water-ratio-calculator": p => {
  const dry = positive(p, 'dryVolume', 23659); const cups = p.unit === 'US-cup' ? dry : dry / 236.5882365;
  if (cups > 100) invalid('dryVolume', 'Maximum is 100 US cups equivalent.');
  const custom = p.preset === 'custom'; const jasmine = p.preset === 'mahatma-jasmine-stove'; const ratio = custom ? positive(p, 'customRatio', 10) : jasmine ? 1.5 : 2;
  return { dryVolume: dry, waterVolume: dry * ratio, unit: s(p, 'unit'), ratio, cookMinutes: custom ? n(p, 'customCookMinutes', 240) : jasmine ? 15 : 20, restMinutes: custom ? n(p, 'customRestMinutes', 240) : null, source: custom ? 'User supplied; follow your rice and cooker instructions.' : jasmine ? 'https://mahatmarice.com/products/jasmine-white-rice/' : 'https://mahatmarice.com/products/white-rice/', note: 'Volume only. Stove examples do not transfer automatically to pressure cookers.' + (custom ? '' : ' The cited manufacturer stove example does not specify a rest time.') };
},
  "turkey-thaw-time-calculator": async p => {
  const lb = positive(p, 'weight', 24) / (p.unit === 'kg' ? LB_KG : 1); if (lb < 4 || lb > 24) invalid('weight', 'Supported turkey weights: 4–24 lb.');
  const fridge = p.method === 'fridge'; const minHours = fridge ? lb / 5 * 24 : lb * 0.5; const maxHours = fridge ? lb / 4 * 24 : minHours;
  return { weightLb: lb, minHours, maxHours, minDays: minHours / 24, maxDays: maxHours / 24, instructions: fridge ? 'Refrigerate at 40°F / 4.4°C or below.' : 'Use a leakproof bag in cold water; change water every 30 minutes and cook immediately after thawing.', source: 'https://www.fsis.usda.gov/food-safety/safe-food-handling-and-preparation/poultry/turkey-basics-safe-thawing', ...await finishRange(s(p, 'start'), minHours * 60, maxHours * 60) };
},
  "meat-cooking-time-calculator": async p => {
  const lb = positive(p, 'weight', 24) / (p.unit === 'kg' ? LB_KG : 1); const band = cookingBand(s(p, 'cut'), lb);
  return { weightLb: lb, ...band, ovenC: (band.ovenF - 32) * 5 / 9, internalC: (band.internalF - 32) * 5 / 9, restNote: band.restMinutes ? 'Rest at least 3 minutes.' : 'No minimum rest in cited chart.', safety: 'Time is an estimate. Verify the required internal temperature with a food thermometer.', source: 'https://www.foodsafety.gov/food-safety-charts/meat-poultry-charts', temperatureSource: 'https://www.foodsafety.gov/food-safety-charts/safe-minimum-internal-temperatures', ...await finishRange(s(p, 'start'), band.minMinutes, band.maxMinutes) };
},
  "pizza-dough-calculator": p => {
  const mass = n(p, 'count', 100, 1, true) * n(p, 'ballG', 2000, 50); if (mass > 100000) invalid('mass', 'Maximum dough mass is 100000 g.');
  const h = n(p, 'hydrationPercent', 120, 20) / 100; const salt = n(p, 'saltPercent', 10) / 100; const yeast = n(p, 'yeastPercent', 10) / 100; const oil = n(p, 'oilPercent', 30) / 100; const flourG = mass / (1 + h + salt + yeast + oil);
  return { flourG, waterG: flourG * h, saltG: flourG * salt, yeastG: flourG * yeast, oilG: flourG * oil, totalG: mass, ballG: n(p, 'ballG', 2000, 50), note: 'Baker percentages use flour mass; fermentation time is not inferred.' };
},
  "sourdough-calculator": p => {
  const totalG = n(p, 'totalG', 100000, 100); const h = n(p, 'hydrationPercent', 200, 20) / 100; const salt = n(p, 'saltPercent', 10) / 100; const starter = n(p, 'starterPercent', 100) / 100; const hs = n(p, 'starterHydrationPercent', 300, 10) / 100;
  const totalFlourG = totalG / (1 + h + salt); const starterG = starter * totalFlourG; const starterFlourG = starterG / (1 + hs); const starterWaterG = starterG - starterFlourG; const addedFlourG = totalFlourG - starterFlourG; const addedWaterG = h * totalFlourG - starterWaterG;
  if (addedFlourG < 0 || addedWaterG < 0) invalid('starter', 'Starter contributes more flour or water than the recipe target.');
  return { totalG, totalFlourG, totalWaterG: h * totalFlourG, starterG, starterFlourG, starterWaterG, addedFlourG, addedWaterG, saltG: salt * totalFlourG, note: 'Starter is included once in the target mass and total hydration.' };
},
  "bread-hydration-calculator": p => {
  const addedFlourG = positive(p, 'flourG', 100000); const addedWaterG = n(p, 'waterG', 100000); const starterG = n(p, 'starterG', 100000); const hs = n(p, 'starterHydrationPercent', 300, 10) / 100; const totalFlourG = addedFlourG + starterG / (1 + hs); const totalWaterG = addedWaterG + starterG * hs / (1 + hs); const totalG = addedFlourG + addedWaterG + starterG + n(p, 'otherDryG', 100000);
  if (totalG > 100000) invalid('total', 'Maximum total dough mass is 100000 g.');
  return { addedFlourG, addedWaterG, totalFlourG, totalWaterG, hydrationPercent: totalWaterG / totalFlourG * 100, totalG };
},
  "cake-pan-size-converter": p => {
  const factor = p.unit === 'in' ? 2.54 : 1;
  const length = (key: string, cap: number) => { const value = positive(p, key, cap) * factor; if (value > cap) invalid(key, `Maximum equivalent is ${cap} cm.`); return value; };
  const area = (prefix: string) => { const x = length(`${prefix}Length`, 100); return p[`${prefix}Shape`] === 'round' ? Math.PI * x * x / 4 : x * length(`${prefix}Width`, 100); };
  const areaFactor = area('target') * n(p, 'targetCount', 20, 1, true) / (area('source') * n(p, 'sourceCount', 20, 1, true));
  return { areaFactor, volumeFactor: areaFactor * length('targetDepth', 30) / length('sourceDepth', 30), note: 'Recipe geometry scaling; baking time is not predicted.' };
},
  "yeast-converter": p => {
  const factors: Record<string, number> = { fresh: 1, 'active-dry': 0.4, instant: 0.33 }; const inputG = positive(p, 'amount', 1000) * (p.unit === 'oz' ? OZ_G : 1); if (inputG > 1000) invalid('amount', 'Maximum is 1000 g equivalent.');
  const fromFactor = p.equivalence === 'custom' ? positive(p, 'customFromFactor', 10) : factors[s(p, 'from')]!; const toFactor = p.equivalence === 'custom' ? positive(p, 'customToFactor', 10) : factors[s(p, 'to')]!; const resultG = inputG / fromFactor * toFactor;
  return { inputG, resultG, resultOz: resultG / OZ_G, teaspoons: p.includeTeaspoons === true ? resultG / positive(p, 'gramsPerTeaspoon', 100) : null, teaspoonStatus: p.includeTeaspoons === true ? 'user-density' : 'not-requested', fromFactor, toFactor, factors, note: 'General fresh-based factors or explicit user factors; manufacturer instructions take precedence.', source: p.equivalence === 'custom' ? 'User/manufacturer supplied factors' : 'https://www.kingarthurbaking.com/pro/reference/yeast' };
},
  "sewing-fabric-yardage-calculator": p => {
  const width = positive(p, 'pieceWidthCm', 10000) + 2 * n(p, 'allowanceCm', 20); const height = positive(p, 'pieceHeightCm', 10000) + 2 * n(p, 'allowanceCm', 20); const roll = positive(p, 'rollWidthCm', 10000); const count = n(p, 'count', 10000, 1, true);
  const options = [[width, height, false] as const, ...(p.rotate === true ? [[height, width, true] as const] : [])].map(([w, h, rotated]) => ({ across: Math.floor(roll / w), height: h, rotated })).filter(o => o.across > 0).map(o => ({ ...o, rows: Math.ceil(count / o.across), lengthCm: Math.ceil(count / o.across) * o.height }));
  if (!options.length) invalid('rollWidthCm', 'Neither permitted orientation fits the roll.');
  const best = options.reduce((a, b) => b.lengthCm < a.lengthCm ? b : a); const finalLengthCm = best.lengthCm * (1 + n(p, 'wastePercent', 100) / 100);
  return { piecesAcross: best.across, rows: best.rows, rotated: best.rotated, baseLengthCm: best.lengthCm, finalLengthCm, yards: finalLengthCm / 91.44, note: 'Repeated rectangular pieces in a fixed orientation; not mixed nesting or grain matching.' };
},
  "shipping-dimensional-weight-calculator": p => {
  const inputMetric = p.inputUnits === 'cm-kg'; const cm = ['length', 'width', 'height'].map(k => positive(p, k, 10000) * (inputMetric ? 1 : 2.54)); if (cm.some(v => v > 10000)) invalid('dimensions', 'Axes exceed 10000 cm equivalent.');
  const kg = n(p, 'mass', 220463) * (inputMetric ? 1 : LB_KG); if (kg > 100000) invalid('mass', 'Mass exceeds 100000 kg equivalent.');
  const custom = p.mode === 'custom'; const metric = custom && p.customBasis === 'cm-kg'; const rawAxes = cm.map(v => metric ? v : v / 2.54); const actual = metric ? kg : kg / LB_KG;
  const rounding = custom ? s(p, 'customRounding') : 'nearest-half-up'; const axes = rawAxes.map(v => rounding === 'nearest-half-up' ? Math.floor(v + 0.5) : v); if (axes.some(v => !v)) invalid('dimensions', 'A rounded dimension is zero.');
  const divisor = custom ? positive(p, 'customDivisor', 100000) : p.mode === 'ups-retail' ? 166 : 139; const dimensional = axes.reduce((a, v) => a * v, 1) / divisor; const billed = Math.max(Math.ceil(actual), Math.ceil(dimensional));
  return { basis: metric ? 'cm³/kg' : 'in³/lb', axes, divisor, rounding, rawActualWeight: actual, dimensionalWeight: dimensional, roundedActualWeight: Math.ceil(actual), roundedDimensionalWeight: Math.ceil(dimensional), billableWeight: billed, billableKg: metric ? billed : billed * LB_KG, equivalentUnroundedCmKgDivisor: metric ? divisor : divisor * 16.387064 / LB_KG, note: 'Estimate under the selected rule; service tariffs and actual carrier charges may differ.', source: 'https://www.ups.com/us/en/support/shipping-support/shipping-dimensions-weight' };
},
  "pallet-loading-calculator": p => {
  const a = positive(p, 'cartonACm', 10000), b = positive(p, 'cartonBCm', 10000), c = positive(p, 'cartonCCm', 10000); const height = positive(p, 'maxHeightCm', 10000) - n(p, 'palletHeightCm', 10000); const remainingKg = n(p, 'maxGrossKg', 1e8) - n(p, 'palletKg', 1e6); const cartonKg = n(p, 'cartonKg', 1e6);
  if (height <= 0 || remainingKg < 0) invalid('limits', 'Loaded height must exceed pallet height and gross limit must cover pallet mass.');
  const options = [[a, b, c], [b, a, c], [a, c, b], [c, a, b], [b, c, a], [c, b, a]].map(([x, y, z]) => {
    const perLayer = Math.floor(positive(p, 'palletLengthCm', 10000) / x!) * Math.floor(positive(p, 'palletWidthCm', 10000) / y!); const layers = Math.floor(height / z!); const geometric = perLayer * layers; const count = cartonKg ? Math.min(geometric, Math.floor(remainingKg / cartonKg)) : geometric;
    return { x: x!, y: y!, z: z!, perLayer, layers, count };
  });
  const best = options.reduce((x, y) => y.count > x.count ? y : x);
  if (best.count <= 0 || best.count > 1e7) invalid('capacity', 'No fitting capacity, or estimated count exceeds 10 million.');
  return { cartonCount: best.count, orientationCm: [best.x, best.y, best.z], perLayer: best.perLayer, fullLayers: Math.floor(best.count / best.perLayer), partialLayerCount: best.count % best.perLayer, loadedHeightCm: n(p, 'palletHeightCm', 10000) + Math.ceil(best.count / best.perLayer) * best.z, grossKg: n(p, 'palletKg', 1e6) + best.count * cartonKg, note: 'Single orientation; no mixed packing, stability or load-strength promise.' };
},
  "propane-usage-calculator": p => {
  const rating = positive(p, 'ratingBtuPerHour', 1e8); const duty = positive(p, 'dutyPercent', 100) / 100; const heatingValue = p.heatingBasis === 'custom' ? positive(p, 'customHeatingValue', 1e8) : p.heatingBasis === 'HHV' ? 91420 : 84250; const energyBtu = rating * duty * n(p, 'durationHours', 1e5); const gallons = energyBtu / heatingValue;
  return { energyBtu, usGallons: gallons, runtimeHours: n(p, 'availableGallons', 1e6) * heatingValue / (rating * duty), cost: gallons * n(p, 'pricePerGallon', 1e9), heatingValueBtuPerGallon: heatingValue, note: 'Input burner energy estimate; useful delivered heat and safe cylinder filling are not inferred.', source: 'https://afdc.energy.gov/fuels/properties' };
},
  "photography-contract-generator": async p => {
  await validateContractParticulars(p);
  const draft = `PHOTOGRAPHY AGREEMENT DRAFT\nDraft for review; add applicable terms before signing.\n\nPhotographer: ${s(p, 'photographer')}\nClient: ${s(p, 'client')}\nProject: ${s(p, 'project')}\nSession date: ${s(p, 'date')}\nLocation: ${s(p, 'location')}\nCoverage hours: ${n(p, 'hours', 168)}\nFee: ${n(p, 'fee', 1e9)} ${s(p, 'currency').toUpperCase()}\nDeposit: ${n(p, 'deposit', 1e9)} ${s(p, 'currency').toUpperCase()}\nBalance: ${n(p, 'fee', 1e9) - n(p, 'deposit', 1e9)} ${s(p, 'currency').toUpperCase()}\n\nDeliverables:\n${s(p, 'deliverables')}\nDelivery date: ${s(p, 'deliveryDate')}\n\nUsage terms:\n${s(p, 'usageTerms')}\n\nCancellation terms:\n${s(p, 'cancellationTerms')}\n\nAdditional agreed terms:\n\nPhotographer signature: __________________ Date: __________\nClient signature: ________________________ Date: __________\n\nThis editable template does not determine legal enforceability, copyright assignment, or model-release rights.`;
  return { draft, status: 'draft-for-review' };
},
};

export function calculatePlanning(id: string, p: UtilityParams, ctx: ToolRunContext): UtilityResult | Promise<UtilityResult> {
  if (!Object.hasOwn(calculations, id)) throw new UtilityInputError('$tool', 'unknown', 'Unknown planning calculator.');
  return calculations[id]!(p, ctx);
}

