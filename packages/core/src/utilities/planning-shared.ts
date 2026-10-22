import Papa from 'papaparse';
import { numberParam, stringParam, UtilityInputError, type UtilityParams } from './common.js';


export const encoder = new TextEncoder();
export function invalid(field: string, message: string): never { throw new UtilityInputError(field, 'bounds', message); }
export function temporalInput<T>(field: string, message: string, read: () => T): T {
  try { return read(); }
  catch (cause) { if (cause instanceof RangeError) invalid(field, message); throw cause; }
}
export function cancelled(signal?: AbortSignal) { if (signal?.aborted) throw new DOMException('Cancelled.', 'AbortError'); }
export const n = (p: UtilityParams, key: string, max = 1e9, min = 0, integer = false) => numberParam(p, key, { min, max, integer });
export const s = (p: UtilityParams, key: string) => stringParam(p, key);

export type Uint32Reader = () => number;
export function secureUint32(): number {
  if (!globalThis.crypto?.getRandomValues) invalid('randomness', 'Cryptographic randomness is unavailable.');
  return crypto.getRandomValues(new Uint32Array(1))[0]!;
}
export function uniformInteger(min: number, max: number, readUint32: Uint32Reader = secureUint32, signal?: AbortSignal): number {
  if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || min > max) invalid('range', 'Use ordered safe integer bounds.');
  const span = max - min + 1;
  if (span < 1 || span > 4294967296) invalid('range', 'Inclusive range must contain at most 2^32 integers.');
  const threshold = Math.floor(4294967296 / span) * span;
  for (let attempt = 0; attempt < 128; attempt++) {
    cancelled(signal);
    const value = readUint32();
    if (!Number.isInteger(value) || value < 0 || value > 4294967295) invalid('randomness', 'Invalid uint32 entropy value.');
    if (value < threshold) return min + value % span;
  }
  return invalid('randomness', 'Entropy rejection limit exceeded.');
}
export function sampleUniqueIntegers(min: number, max: number, count: number, readUint32: Uint32Reader = secureUint32, signal?: AbortSignal): number[] {
  if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || min > max) invalid('range', 'Use ordered safe integer bounds.');
  const span = max - min + 1;
  if (span < 1 || span > 4294967296 || !Number.isInteger(count) || count < 0 || count > span || count > 1000) invalid('count', 'Count exceeds the available range or 1000 results.');
  const swaps = new Map<number, number>();
  const output: number[] = [];
  for (let i = 0; i < count; i++) {
    const remaining = span - i;
    const index = uniformInteger(0, remaining - 1, readUint32, signal);
    output.push(min + (swaps.get(index) ?? index));
    swaps.set(index, swaps.get(remaining - 1) ?? remaining - 1);
    swaps.delete(remaining - 1);
  }
  return output;
}

export function bmiCategory(value: number): string {
  if (!Number.isFinite(value) || value <= 0) invalid('bmi', 'BMI must be positive and finite.');
  return value < 18.5 ? 'Underweight' : value < 25 ? 'Healthy weight' : value < 30 ? 'Overweight' : value < 35 ? 'Class 1 obesity' : value < 40 ? 'Class 2 obesity' : 'Class 3 obesity';
}

export async function temporalDate(value: string, field = 'date') {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) invalid(field, 'Use YYYY-MM-DD.');
  const { Temporal } = await import('@js-temporal/polyfill');
  const date = temporalInput(field, 'Use a valid calendar date.', () => Temporal.PlainDate.from(value, { overflow: 'reject' }));
  if (date.year < 1900 || date.year > 2100) invalid(field, 'Years must be 1900–2100.');
  return date;
}

export type PlanningRowsKind = 'gpa' | 'grade' | 'cocktail';
export interface PlanningRow { name: string; first: number; second: number; weightText: string; row: number }
export function parseGradeWeight(value: unknown): number {
  if (typeof value !== 'string') invalid('weight', 'Weight must be decimal text.');
  const trimmed = value.replace(/^[\t\n\r ]+|[\t\n\r ]+$/g, '');
  if (!/^(?:0|[1-9]\d{0,2})(?:\.\d{1,2})?$/.test(trimmed)) invalid('weight', 'Use a decimal percent with at most two decimal places.');
  const [whole, fraction = ''] = trimmed.split('.');
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (result > 10000) invalid('weight', 'Percent must be 0–100.');
  return result;
}
export function parsePlanningRows(input: string, kind: PlanningRowsKind, delimiter = ',', hasHeader = true, scale = 4, signal?: AbortSignal): PlanningRow[] {
  cancelled(signal);
  if (encoder.encode(input).length > 102400) invalid('rowsText', 'Rows exceed 100 KiB.');
  if (delimiter !== ',' && delimiter !== '\t') invalid('delimiter', 'Use comma or tab.');
  if (!['gpa', 'grade', 'cocktail'].includes(kind)) invalid('rows', 'Unknown row type.');
  const parsed = Papa.parse<string[]>(input, { delimiter, dynamicTyping: false, skipEmptyLines: false });
  if (parsed.errors.length) invalid('rowsText', parsed.errors[0]!.message);
  const meaningful = parsed.data.map((cells, index) => ({ cells, row: index + 1 })).filter(({ cells }) => cells.some(cell => cell.trim() !== ''));
  const headers = kind === 'gpa' ? ['name', 'credits', 'points'] : kind === 'grade' ? ['name', 'grade', 'weight'] : ['name', 'volumeml', 'abvpercent'];
  let order = [0, 1, 2];
  if (hasHeader && meaningful.length) {
    const header = meaningful.shift()!.cells.map(cell => cell.trim().toLowerCase().replace(/[ _]/g, ''));
    if (header.length !== 3 || new Set(header).size !== 3 || headers.some(h => !header.includes(h))) invalid('rowsText', `Headers must be ${headers.join(', ')}.`);
    order = headers.map(h => header.indexOf(h));
  }
  const limit = kind === 'cocktail' ? 50 : 200;
  if (meaningful.length > limit || (!meaningful.length && kind !== 'grade')) invalid('rowsText', `Enter 1–${limit} rows.`);
  return meaningful.map(({ cells, row }) => {
    cancelled(signal);
    if (cells.length !== 3) invalid('rowsText', `Row ${row}: expected exactly three columns.`);
    const name = cells[order[0]!]!; const firstText = cells[order[1]!]!.trim(); const secondText = cells[order[2]!]!.trim();
    if ([...name].length > 120) invalid('rowsText', `Row ${row}: name exceeds 120 characters.`);
    if (!firstText || !secondText) invalid('rowsText', `Row ${row}: numeric cells must not be blank.`);
    const first = Number(firstText); let second: number;
    try { second = kind === 'grade' ? parseGradeWeight(secondText) : Number(secondText); }
    catch (cause) { invalid('rowsText', `Row ${row}: ${cause instanceof Error ? cause.message : 'invalid weight'}`); }
    const firstMax = kind === 'cocktail' ? 10000 : 100; const secondMax = kind === 'gpa' ? scale : kind === 'grade' ? 10000 : 100;
    if (!Number.isFinite(first) || !Number.isFinite(second) || first < 0 || first > firstMax || second < 0 || second > secondMax) invalid('rowsText', `Row ${row}: values are outside their bounds.`);
    return { name, first, second, weightText: kind === 'grade' ? secondText : '', row };
  });
}
export function cookingBand(cut: string, lb: number) {
  if (!Number.isFinite(lb)) invalid('weight', 'Weight must be finite.');
  const rows: Record<string, [number, number, number, number, number, boolean]> = { 'beef-rib-bone-in': [4, 6, 325, 23, 25, true], 'beef-rib-boneless': [4, 6, 325, 28, 33, true], 'beef-round-rump': [2.5, 4, 325, 30, 35, true], 'beef-tenderloin': [4, 6, 425, 45, 60, false] };
  const beef = rows[cut];
  if (beef) { if (lb < beef[0] || lb > beef[1]) invalid('weight', 'Weight is outside the cited cut band.'); return { ovenF: beef[2], minMinutes: beef[3] * (beef[5] ? lb : 1), maxMinutes: beef[4] * (beef[5] ? lb : 1), internalF: 145, restMinutes: 3, band: `${beef[0]}–${beef[1]} lb`, timingBasis: beef[5] ? 'minutes per pound' : 'total minutes' }; }
  if (cut === 'chicken-whole-unstuffed') {
    if (!((lb >= 3 && lb <= 4) || (lb >= 5 && lb <= 7))) invalid('weight', 'Chicken bands are 3–4 or 5–7 lb.');
    return { ovenF: 350, minMinutes: lb <= 4 ? 75 : 120, maxMinutes: lb <= 4 ? 90 : 135, internalF: 165, restMinutes: 0, band: lb <= 4 ? '3–4 lb' : '5–7 lb', timingBasis: 'total minutes' };
  }
  if (cut !== 'turkey-whole-unstuffed' || lb < 8 || lb > 24) invalid('cut', 'Unsupported cut or weight band.');
  const band = lb < 12 ? [8, 12, 165, 180] : lb < 14 ? [12, 14, 180, 225] : lb < 18 ? [14, 18, 225, 255] : lb < 20 ? [18, 20, 255, 270] : [20, 24, 270, 300];
  return { ovenF: 325, minMinutes: band[2]!, maxMinutes: band[3]!, internalF: 165, restMinutes: 0, band: `${band[0]}–${band[1]} lb (heavier band at shared edges)`, timingBasis: 'total minutes' };
}

export function boundedLabel(value: unknown, max = 120): string {
  if (typeof value !== 'string' || [...value].length > max || [...value].some(char => char.codePointAt(0)! < 32 || char.codePointAt(0) === 127) || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)) invalid('label', 'Use bounded text without control characters or invalid Unicode.');
  return value;
}
export async function validateContractParticulars(p: UtilityParams): Promise<void> {
  for (const key of ['photographer', 'client']) if (!boundedLabel(s(p, key)).trim()) invalid(key, 'Required.');
  boundedLabel(s(p, 'location'));
  for (const [key, limit] of [['project', 2000], ['deliverables', 4000], ['usageTerms', 4000], ['cancellationTerms', 4000]] as const) if ([...s(p, key)].length > limit) invalid(key, `Maximum ${limit} characters.`);
  if (!s(p, 'project').trim()) invalid('project', 'Required.');
  if (!/^[A-Za-z]{3}$/.test(s(p, 'currency'))) invalid('currency', 'Use three ASCII letters.');
  if (n(p, 'deposit', 1e9) > n(p, 'fee', 1e9)) invalid('deposit', 'Deposit exceeds fee.');
  await temporalDate(s(p, 'date')); await temporalDate(s(p, 'deliveryDate'), 'deliveryDate');
  n(p, 'hours', 168);
  if (encoder.encode(JSON.stringify(p)).length > 102400) invalid('draft', 'Particulars exceed 100 KiB.');
}

export interface StopwatchSnapshot { version: 1; kind: 'stopwatch'; state: 'running' | 'paused'; elapsedMs: number; laps: { totalMs: number; deltaMs: number }[] }
export interface CountdownSnapshot { version: 1; kind: 'countdown'; state: 'running' | 'paused' | 'done'; durationMs: number; elapsedMs: number }
export interface SeatingPlan { version: 1; kind: 'seating'; guests: { id: string; name: string }[]; tables: { id: string; name: string; capacity: number }[]; assignments: { guestId: string; tableId: string }[] }
export type PlanningSnapshot = StopwatchSnapshot | CountdownSnapshot | SeatingPlan;
export function exact(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) invalid('snapshot', 'Expected a plain record.');
  const record = value as Record<string, unknown>; const actual = Object.keys(record);
  if (actual.length !== keys.length || actual.some(key => !keys.includes(key))) invalid('snapshot', 'Missing or unexpected fields.');
  return record;
}
export function snapshotNumber(value: unknown, max: number, min = 0, integer = false): number { return n({ value }, 'value', max, min, integer); }
export function snapshotBudget(value: unknown) {
  let leaves = 0;
  function visit(current: unknown, depth: number) {
    if (depth > 10) invalid('snapshot', 'Nesting exceeds 10 levels.');
    if (current && typeof current === 'object') {
      if (!Array.isArray(current) && Object.getPrototypeOf(current) !== Object.prototype) invalid('snapshot', 'Expected JSON records.');
      for (const [key, child] of Object.entries(current)) { if (['__proto__', 'constructor', 'prototype'].includes(key)) invalid('snapshot', 'Forbidden key.'); visit(child, depth + 1); }
    } else { if (++leaves > 10000 || current === undefined || typeof current === 'number' && !Number.isFinite(current)) invalid('snapshot', 'Invalid or excessive scalar values.'); }
  }
  visit(value, 0);
}
export function validatePlanningSnapshot(value: unknown, expectedKind?: PlanningSnapshot['kind']): PlanningSnapshot {
  snapshotBudget(value);
  const kind = (value as { kind?: unknown } | null)?.kind;
  if (expectedKind && kind !== expectedKind) invalid('snapshot', 'Wrong session kind.');
  if (kind === 'stopwatch') {
    const p = exact(value, ['version', 'kind', 'state', 'elapsedMs', 'laps']);
    if (p.version !== 1 || typeof p.state !== 'string' || !['running', 'paused'].includes(p.state) || !Array.isArray(p.laps) || p.laps.length > 200) invalid('snapshot', 'Invalid stopwatch session.');
    const elapsedMs = snapshotNumber(p.elapsedMs, 604800000); let previous = 0;
    const laps = p.laps.map(lap => { const row = exact(lap, ['totalMs', 'deltaMs']); const totalMs = snapshotNumber(row.totalMs, elapsedMs); const deltaMs = snapshotNumber(row.deltaMs, elapsedMs); if (totalMs < previous || Math.abs(totalMs - previous - deltaMs) > 1e-6) invalid('laps', 'Lap totals and deltas disagree.'); previous = totalMs; return { totalMs, deltaMs }; });
    return { version: 1, kind, state: p.state as 'running' | 'paused', elapsedMs, laps };
  }
  if (kind === 'countdown') {
    const p = exact(value, ['version', 'kind', 'state', 'durationMs', 'elapsedMs']);
    if (p.version !== 1 || typeof p.state !== 'string' || !['running', 'paused', 'done'].includes(p.state)) invalid('snapshot', 'Invalid countdown session.');
    const durationMs = snapshotNumber(p.durationMs, 86400000, 1000); const elapsedMs = snapshotNumber(p.elapsedMs, durationMs);
    if ((p.state === 'done') !== (elapsedMs === durationMs)) invalid('state', 'Done state must match zero remaining time.');
    return { version: 1, kind, state: p.state as CountdownSnapshot['state'], durationMs, elapsedMs };
  }
  if (kind !== 'seating') invalid('kind', 'Unsupported session kind.');
  const p = exact(value, ['version', 'kind', 'guests', 'tables', 'assignments']);
  if (p.version !== 1 || !Array.isArray(p.guests) || !Array.isArray(p.tables) || !Array.isArray(p.assignments) || p.guests.length > 500 || p.tables.length > 100 || p.assignments.length > 500) invalid('snapshot', 'Seating plan exceeds guest/table/assignment limits.');
  const ids = new Set<string>();
  const id = (value: unknown) => { if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,36}$/.test(value) || ['__proto__', 'constructor', 'prototype'].includes(value) || ids.has(value)) invalid('id', 'IDs must be valid and unique across guests and tables.'); ids.add(value); return value; };
  const guests = p.guests.map(row => { const r = exact(row, ['id', 'name']); return { id: id(r.id), name: boundedLabel(r.name) }; });
  const tables = p.tables.map(row => { const r = exact(row, ['id', 'name', 'capacity']); return { id: id(r.id), name: boundedLabel(r.name), capacity: snapshotNumber(r.capacity, 100, 1, true) }; });
  const guestIds = new Set(guests.map(g => g.id)); const tableIds = new Set(tables.map(t => t.id)); const assigned = new Set<string>(); const counts = new Map<string, number>();
  const assignments = p.assignments.map(row => { const r = exact(row, ['guestId', 'tableId']); if (typeof r.guestId !== 'string' || typeof r.tableId !== 'string' || !guestIds.has(r.guestId) || !tableIds.has(r.tableId) || assigned.has(r.guestId)) invalid('assignment', 'Assignments require existing guest/table references and one table per guest.'); assigned.add(r.guestId); counts.set(r.tableId, (counts.get(r.tableId) ?? 0) + 1); return { guestId: r.guestId, tableId: r.tableId }; });
  if (tables.some(t => (counts.get(t.id) ?? 0) > t.capacity)) invalid('capacity', 'An assigned table exceeds capacity.');
  const result: SeatingPlan = { version: 1, kind, guests, tables, assignments };
  if (encoder.encode(JSON.stringify(result)).length > 1048576) invalid('snapshot', 'Seating plan exceeds 1 MiB.');
  return result;
}
export function safeCsvCell(value: string | number): string {
  let raw = String(value);
  if (typeof value === 'string' && (/^\s*[=+\-@]/u.test(raw) || /^[\t\r\n]/.test(raw))) raw = `'${raw}`;
  return `"${raw.replace(/"/g, '""')}"`;
}
export function seatingCsv(plan: SeatingPlan): string {
  const validated = validatePlanningSnapshot(plan, 'seating') as SeatingPlan; const assignments = new Map(validated.assignments.map(a => [a.guestId, a.tableId])); const tables = new Map(validated.tables.map(t => [t.id, t.name]));
  return [['guestId', 'guest', 'tableId', 'table'], ...validated.guests.map(g => { const tableId = assignments.get(g.id) ?? ''; return [g.id, g.name, tableId, tables.get(tableId) ?? 'Unassigned']; })].map(row => row.map(safeCsvCell).join(',')).join('\r\n');
}

