import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist';
import type { ParamFieldSchema } from '../types.js';
import { exportCsv, type CsvTable } from './csv-data.js';

export const BANK_LIMITS = {
  inputBytes: 20 * 1024 * 1024,
  pages: 100,
  items: 100000,
  lines: 20000,
  lineChars: 4096,
  textBytes: 10 * 1024 * 1024,
  outputBytes: 32 * 1024 * 1024,
} as const;
export interface BankTextItem {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface BankLine {
  id: string;
  page: number;
  line: number;
  y: number;
  text: string;
  items: BankTextItem[];
}
export interface BankPage {
  page: number;
  width: number;
  height: number;
  visual: 'blank' | 'text' | 'nontext' | 'mixed' | 'unknown';
}
export interface BankDocument {
  pages: BankPage[];
  lines: BankLine[];
  rowTolerance: number;
}
export interface BankPdfEnvironment {
  open(bytes: Uint8Array): PDFDocumentLoadingTask;
  paintOps: readonly number[];
  imageOps: readonly number[];
  destroy(): void | Promise<void>;
}
export type BankRange = [number, number];
export interface BankMapping {
  mode: 'signed-amount' | 'debit-credit';
  date: BankRange;
  description: BankRange;
  amount?: BankRange;
  debit?: BankRange;
  credit?: BankRange;
  balance?: BankRange;
}
export type BankRole = 'transaction' | 'opening' | 'closing' | 'non-financial';
export interface BankLineDecision {
  id: string;
  decision: 'pending' | 'accept' | 'ignore' | 'attach';
  role: BankRole;
  edited?: { date?: string; description?: string; amount?: string; balance?: string };
  reason?: string;
  attachTo?: string;
}
export interface BankPageDecision {
  page: number;
  decision: 'pending' | 'include' | 'ignore';
  reason?: string;
}
export interface BankParams {
  mapping: BankMapping;
  datePattern: 'YYYY-MM-DD' | 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'DD/MM' | 'MM/DD';
  statementYear: number | null;
  decimal: 'dot' | 'comma';
  grouping: 'none' | 'comma' | 'dot' | 'space';
  signConvention: 'minus' | 'parentheses' | 'cr-dr';
  crMeaning: 'positive' | 'negative';
  opening: string | null;
  closing: string | null;
  rowTolerance: number;
  pageDecisions: BankPageDecision[];
  lineDecisions: BankLineDecision[];
  spreadsheetSafe: boolean;
  acknowledged: boolean;
}
export const bankDefaults: BankParams = {
  mapping: {
    mode: 'signed-amount',
    date: [35, 115],
    description: [115, 350],
    amount: [350, 430],
    balance: [430, 510],
  },
  datePattern: 'YYYY-MM-DD',
  statementYear: null,
  decimal: 'dot',
  grouping: 'none',
  signConvention: 'minus',
  crMeaning: 'positive',
  opening: null,
  closing: null,
  rowTolerance: 2,
  pageDecisions: [],
  lineDecisions: [],
  spreadsheetSafe: false,
  acknowledged: false,
};
export const bankParamSchema: Record<keyof BankParams, ParamFieldSchema> = {
  mapping: { type: 'json', label: 'PDF column mapping' },
  datePattern: {
    type: 'enum',
    label: 'Date format',
    options: ['YYYY-MM-DD', 'DD/MM/YYYY', 'MM/DD/YYYY', 'DD/MM', 'MM/DD'].map((value) => ({
      value,
      label: value,
    })),
  },
  statementYear: {
    type: 'number',
    label: 'Year for yearless dates',
    min: 1900,
    max: 2100,
    step: 1,
  },
  decimal: {
    type: 'enum',
    label: 'Decimal separator',
    options: [
      { value: 'dot', label: 'Dot' },
      { value: 'comma', label: 'Comma' },
    ],
  },
  grouping: {
    type: 'enum',
    label: 'Digit grouping',
    options: ['none', 'comma', 'dot', 'space'].map((value) => ({ value, label: value })),
  },
  signConvention: {
    type: 'enum',
    label: 'Amount signs',
    options: ['minus', 'parentheses', 'cr-dr'].map((value) => ({ value, label: value })),
  },
  crMeaning: {
    type: 'enum',
    label: 'CR means',
    options: [
      { value: 'positive', label: 'Positive' },
      { value: 'negative', label: 'Negative' },
    ],
  },
  opening: { type: 'string', label: 'Opening balance' },
  closing: { type: 'string', label: 'Closing balance' },
  rowTolerance: {
    type: 'number',
    label: 'Baseline tolerance in PDF points',
    min: 0.5,
    max: 5,
    step: 0.5,
  },
  pageDecisions: { type: 'json', label: 'Page review decisions' },
  lineDecisions: { type: 'json', label: 'Line review decisions' },
  spreadsheetSafe: { type: 'boolean', label: 'Spreadsheet-safe text' },
  acknowledged: { type: 'boolean', label: 'I reviewed every candidate and visual-page exception' },
};

function cancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Bank statement processing cancelled.', 'AbortError');
}

class BankAnnotationInputError extends Error {}
interface BankAnnotationPresence {
  id: string;
  eligible: boolean;
  hasAppearance: boolean;
  hasAvailableContent: boolean;
}
interface BankAnnotationBudget {
  count: number;
  bytes: number;
}
const BANK_ANNOTATION_RECORD_BYTES = 1024 * 1024;
// Pinned PDF.js 6.4.299 presence categories, used only inside eligible annotation groups.
const BANK_ANNOTATION_DRAWING = new Set([
  20, 21, 22, 23, 24, 25, 26, 27, 44, 45, 46, 47, 62, 66, 83, 84, 85, 86, 87, 88, 89, 90, 94,
]);
const BANK_ANNOTATION_STATE = new Set([
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 28, 29, 30, 31, 32, 33, 34, 35,
  36, 37, 38, 39, 40, 41, 42, 43, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 67, 68,
  69, 70, 71, 72, 73, 74, 75, 76, 77, 92, 93,
]);

function annotationRecord(value: unknown): asserts value is Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value) as object | null)
  )
    throw new BankAnnotationInputError('Annotation metadata requires a plain record.');
}
function annotationField(value: Record<string, unknown>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (descriptor && 'value' in descriptor) return descriptor.value;
  if (descriptor || key in value)
    throw new BankAnnotationInputError('Annotation metadata requires own data fields.');
  return undefined;
}
function annotationArray(value: unknown, max: number): asserts value is unknown[] {
  try {
    array(value, max, 'Annotation metadata');
  } catch {
    throw new BankAnnotationInputError('Annotation metadata requires a bounded dense data array.');
  }
}
function annotationRectangle(value: unknown): asserts value is [number, number, number, number] {
  annotationArray(value, 4);
  if (value.length !== 4 || value.some((v) => typeof v !== 'number' || !Number.isFinite(v)))
    throw new BankAnnotationInputError(
      'Annotation metadata requires four finite rectangle coordinates.',
    );
}
function projectBankAnnotations(
  value: unknown,
  crop: unknown,
  budget: BankAnnotationBudget,
  signal: AbortSignal,
): Map<string, BankAnnotationPresence> {
  annotationArray(value, 1000);
  budget.count += value.length;
  if (budget.count > 10000)
    throw new BankAnnotationInputError('Annotation metadata document limit is 10000.');
  annotationRectangle(crop);
  const projected = new Map<string, BankAnnotationPresence>();
  for (const raw of value) {
    cancelled(signal);
    annotationRecord(raw);
    const id = annotationField(raw, 'id');
    const flags = annotationField(raw, 'annotationFlags');
    const rect = annotationField(raw, 'rect');
    const hasAppearance = annotationField(raw, 'hasAppearance');
    const subtype = annotationField(raw, 'subtype');
    if (typeof id !== 'string' || !id.length || id.length > 128)
      throw new BankAnnotationInputError('Annotation metadata requires a bounded nonempty id.');
    if (projected.has(id)) throw new BankAnnotationInputError('Duplicate annotation metadata id.');
    if (typeof flags !== 'number' || !Number.isSafeInteger(flags) || flags < 0)
      throw new BankAnnotationInputError(
        'Annotation metadata flags must be nonnegative safe integers.',
      );
    annotationRectangle(rect);
    if (typeof hasAppearance !== 'boolean')
      throw new BankAnnotationInputError('Annotation metadata appearance must be boolean.');
    if (
      subtype !== undefined &&
      subtype !== null &&
      (typeof subtype !== 'string' || subtype.length > 64)
    )
      throw new BankAnnotationInputError('Annotation metadata subtype must be bounded text.');

    // References are local to this bounded projection; only the presence boolean survives.
    const strings: string[] = [];
    let units = 0;
    const addString = (s: unknown) => {
      if (typeof s !== 'string')
        throw new BankAnnotationInputError('Annotation content fields must contain strings.');
      units += s.length;
      if (units > BANK_ANNOTATION_RECORD_BYTES)
        throw new BankAnnotationInputError('Annotation content byte budget exceeded.');
      strings.push(s);
    };
    const addStrings = (content: unknown, scalar: boolean) => {
      if (content === undefined || content === null) return;
      if (scalar && typeof content === 'string') addString(content);
      else {
        annotationArray(content, 1000);
        for (const s of content) addString(s);
      }
    };
    if (subtype === 'Widget') addStrings(annotationField(raw, 'fieldValue'), true);
    else if (subtype === 'FreeText') {
      const contents = annotationField(raw, 'contentsObj');
      if (contents !== undefined && contents !== null) {
        annotationRecord(contents);
        addString(annotationField(contents, 'str'));
      }
      addStrings(annotationField(raw, 'textContent'), false);
    }
    let recordBytes = 0;
    let hasAvailableContent = false;
    for (const s of strings) {
      hasAvailableContent ||= s.length > 0;
      for (let i = 0; i < s.length; i++) {
        if ((i & 4095) === 0) cancelled(signal);
        const code = s.charCodeAt(i);
        let bytes = code < 0x80 ? 1 : code < 0x800 ? 2 : 3;
        if (code >= 0xd800 && code <= 0xdbff && i + 1 < s.length) {
          const next = s.charCodeAt(i + 1);
          if (next >= 0xdc00 && next <= 0xdfff) {
            bytes = 4;
            i++;
          }
        }
        recordBytes += bytes;
        budget.bytes += bytes;
        if (
          recordBytes > BANK_ANNOTATION_RECORD_BYTES ||
          budget.bytes > 10 * BANK_ANNOTATION_RECORD_BYTES
        )
          throw new BankAnnotationInputError('Annotation content byte budget exceeded.');
      }
    }
    const eligible =
      !(flags & (1 | 2 | 32)) &&
      rect[2] > rect[0] &&
      rect[3] > rect[1] &&
      rect[2] > crop[0] &&
      rect[0] < crop[2] &&
      rect[3] > crop[1] &&
      rect[1] < crop[3];
    projected.set(id, { id, eligible, hasAppearance, hasAvailableContent });
  }
  return projected;
}

function bankOperatorVisual(
  value: unknown,
  annotations: Map<string, BankAnnotationPresence>,
  hasText: boolean,
  env: BankPdfEnvironment,
  signal: AbortSignal,
): BankPage['visual'] {
  annotationRecord(value);
  const functions = annotationField(value, 'fnArray');
  const args = annotationField(value, 'argsArray');
  if (Array.isArray(functions) && functions.length > 100000)
    throw new BankAnnotationInputError('PDF operator budget exceeded.');
  array(functions, 100000, 'PDF operators');
  array(args, 100000, 'PDF operator arguments');
  if (functions.length !== args.length) return 'unknown';
  let active: BankAnnotationPresence | undefined;
  let image = false,
    painted = false,
    annotationDrawing = false,
    unknown = false;
  const seen = new Set<string>(),
    drawn = new Set<string>();
  for (let i = 0; i < functions.length; i++) {
    cancelled(signal);
    const op = functions[i];
    if (typeof op !== 'number' || !Number.isSafeInteger(op)) return 'unknown';
    if (op === 80) {
      const payload = args[i];
      const descriptor = Array.isArray(payload)
        ? Object.getOwnPropertyDescriptor(payload, '0')
        : undefined;
      const id: unknown = descriptor && 'value' in descriptor ? descriptor.value : undefined;
      if (active || typeof id !== 'string' || !id.length || id.length > 128 || seen.has(id))
        return 'unknown';
      active = annotations.get(id);
      if (!active) return 'unknown';
      seen.add(id);
    } else if (op === 81) {
      if (!active) return 'unknown';
      active = undefined;
    } else if (active) {
      if (!active.eligible) continue;
      if (BANK_ANNOTATION_DRAWING.has(op)) {
        annotationDrawing = true;
        drawn.add(active.id);
      } else if (op === 91) {
        const payload = args[i];
        const descriptor = Array.isArray(payload)
          ? Object.getOwnPropertyDescriptor(payload, '0')
          : undefined;
        const terminal: unknown =
          descriptor && 'value' in descriptor ? descriptor.value : undefined;
        if (typeof terminal !== 'number' || !Number.isSafeInteger(terminal)) unknown = true;
        else if (terminal >= 20 && terminal <= 27) {
          annotationDrawing = true;
          drawn.add(active.id);
        } else if (terminal !== 28) unknown = true;
      } else if (!BANK_ANNOTATION_STATE.has(op)) unknown = true;
    } else {
      image ||= env.imageOps.includes(op);
      painted ||= env.paintOps.includes(op);
    }
  }
  if (active) return 'unknown';
  for (const annotation of annotations.values()) {
    cancelled(signal);
    if (
      annotation.eligible &&
      ((annotation.hasAppearance && !seen.has(annotation.id)) ||
        (annotation.hasAvailableContent && !drawn.has(annotation.id)))
    )
      unknown = true;
  }
  if (unknown) return 'unknown';
  if (annotationDrawing) return hasText ? 'mixed' : 'nontext';
  return hasText ? (image ? 'mixed' : 'text') : image || painted ? 'nontext' : 'blank';
}
function record(
  value: unknown,
  keys: readonly string[],
  label: string,
): asserts value is Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value) as object | null)
  )
    throw new Error(`${label}: expected a plain object.`);
  for (const key of Reflect.ownKeys(value)) {
    const d = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== 'string' || !keys.includes(key) || !d || !('value' in d) || !d.enumerable)
      throw new Error(`${label}: unexpected field or accessor.`);
  }
}
function array(value: unknown, max: number, label: string): asserts value is unknown[] {
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    value.length > max ||
    Reflect.ownKeys(value).length !== value.length + 1
  )
    throw new Error(`${label}: bounded dense array required.`);
  for (let i = 0; i < value.length; i++) {
    const d = Object.getOwnPropertyDescriptor(value, String(i));
    if (!d || !('value' in d)) throw new Error(`${label}: data entries required.`);
  }
}
function text(value: unknown, label: string, max = 4096): asserts value is string {
  if (typeof value !== 'string' || value.length > max)
    throw new Error(`${label}: bounded text required.`);
}
function finite(value: unknown, label: string, min = 0, max = 2000): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)
    throw new Error(`${label}: invalid bounded number.`);
}
function option(value: unknown, options: readonly string[], label: string): void {
  if (typeof value !== 'string' || !options.includes(value)) throw new Error(`Invalid ${label}.`);
}
function range(value: unknown): asserts value is BankRange {
  array(value, 2, 'Column range');
  if (value.length !== 2) throw new Error('Column range requires two endpoints.');
  finite(value[0], 'Column start');
  finite(value[1], 'Column end');
  if (value[0] >= value[1]) throw new Error('Column start must precede its end.');
}

export function validateBankParams(value: unknown): BankParams {
  record(value, Object.keys(bankDefaults), 'Bank parameters');
  const p = { ...bankDefaults, ...value };
  record(
    p.mapping,
    ['mode', 'date', 'description', 'amount', 'debit', 'credit', 'balance'],
    'Column mapping',
  );
  option(p.mapping.mode, ['signed-amount', 'debit-credit'], 'mapping mode');
  range(p.mapping.date);
  range(p.mapping.description);
  if (p.mapping.mode === 'signed-amount') {
    range(p.mapping.amount);
    if (p.mapping.debit !== undefined || p.mapping.credit !== undefined)
      throw new Error('Signed mode cannot map debit or credit.');
  } else {
    range(p.mapping.debit);
    range(p.mapping.credit);
    if (p.mapping.amount !== undefined)
      throw new Error('Debit-credit mode cannot map signed amount.');
  }
  if (p.mapping.balance !== undefined) range(p.mapping.balance);
  const ranges = Object.entries(p.mapping)
    .filter(([key]) => key !== 'mode')
    .map(([, r]) => r as BankRange)
    .sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < ranges.length; i++)
    if (ranges[i]![0] < ranges[i - 1]![1]) throw new Error('Mapped columns must not overlap.');
  option(
    p.datePattern,
    ['YYYY-MM-DD', 'DD/MM/YYYY', 'MM/DD/YYYY', 'DD/MM', 'MM/DD'],
    'date pattern',
  );
  if (
    p.statementYear !== null &&
    (!Number.isInteger(p.statementYear) || p.statementYear < 1900 || p.statementYear > 2100)
  )
    throw new Error('Statement year must be 1900..2100 or null.');
  if ((p.datePattern === 'DD/MM' || p.datePattern === 'MM/DD') && p.statementYear === null)
    throw new Error('Yearless dates require an explicit statement year.');
  option(p.decimal, ['dot', 'comma'], 'decimal');
  option(p.grouping, ['none', 'comma', 'dot', 'space'], 'grouping');
  if (p.decimal === p.grouping) throw new Error('Decimal and grouping separators must differ.');
  option(p.signConvention, ['minus', 'parentheses', 'cr-dr'], 'sign convention');
  option(p.crMeaning, ['positive', 'negative'], 'CR polarity');
  if (p.mapping.mode === 'debit-credit' && p.signConvention !== 'minus')
    throw new Error('Debit-credit columns require unsigned magnitudes and minus convention.');
  finite(p.rowTolerance, 'Row tolerance', 0.5, 5);
  for (const k of ['spreadsheetSafe', 'acknowledged'] as const)
    if (typeof p[k] !== 'boolean') throw new Error(`${k} must be boolean.`);
  for (const k of ['opening', 'closing'] as const)
    if (p[k] !== null) {
      text(p[k], k, 100);
      parseBankMoney(p[k], p);
    }
  array(p.pageDecisions, 100, 'Page decisions');
  array(p.lineDecisions, 20000, 'Line decisions');
  for (const d of p.pageDecisions) {
    record(d, ['page', 'decision', 'reason'], 'Page decision');
    finite(d.page, 'Page number', 1, 100);
    if (!Number.isInteger(d.page)) throw new Error('Page number must be integer.');
    option(d.decision, ['pending', 'include', 'ignore'], 'page decision');
    if (d.reason !== undefined) text(d.reason, 'Page reason', 500);
  }
  for (const d of p.lineDecisions) {
    record(d, ['id', 'decision', 'role', 'edited', 'reason', 'attachTo'], 'Line decision');
    text(d.id, 'Line ID', 100);
    option(d.decision, ['pending', 'accept', 'ignore', 'attach'], 'line decision');
    option(d.role, ['transaction', 'opening', 'closing', 'non-financial'], 'line role');
    if (d.reason !== undefined) text(d.reason, 'Review reason', 500);
    if (d.attachTo !== undefined) text(d.attachTo, 'Attachment target', 100);
    if (d.edited !== undefined) {
      record(d.edited, ['date', 'description', 'amount', 'balance'], 'Edited values');
      for (const [key, v] of Object.entries(d.edited)) text(v, `Edited ${key}`);
      if (p.mapping.mode === 'debit-credit' && d.edited.amount !== undefined)
        throw new Error('Edit debit-credit source mapping, not its calculated net amount.');
      if (d.edited.date) parseBankDate(d.edited.date, p);
      if (d.edited.amount) parseBankMoney(d.edited.amount, p);
      if (d.edited.balance) parseBankMoney(d.edited.balance, p);
    }
  }
  return p;
}

export function parseBankMoney(
  value: string,
  p: Pick<BankParams, 'decimal' | 'grouping' | 'signConvention' | 'crMeaning'>,
  unsigned = false,
): string {
  option(p.decimal, ['dot', 'comma'], 'decimal');
  option(p.grouping, ['none', 'comma', 'dot', 'space'], 'grouping');
  option(p.signConvention, ['minus', 'parentheses', 'cr-dr'], 'sign convention');
  option(p.crMeaning, ['positive', 'negative'], 'CR polarity');
  text(value, 'Money', 100);
  let source = value.trim();
  let negative = false;
  if (!unsigned && p.signConvention === 'minus' && source.startsWith('-')) {
    negative = true;
    source = source.slice(1);
  } else if (
    !unsigned &&
    p.signConvention === 'parentheses' &&
    source.startsWith('(') &&
    source.endsWith(')')
  ) {
    negative = true;
    source = source.slice(1, -1);
  } else if (!unsigned && p.signConvention === 'cr-dr') {
    const m = /^(.*?)(CR|DR)$/i.exec(source);
    if (m) {
      source = m[1]!.trimEnd();
      negative = (m[2]!.toUpperCase() === 'CR') !== (p.crMeaning === 'positive');
    }
  }
  const decimal = p.decimal === 'dot' ? '.' : ',';
  const group =
    p.grouping === 'none' ? '' : p.grouping === 'space' ? ' ' : p.grouping === 'dot' ? '.' : ',';
  if (decimal === group) throw new Error('Decimal and grouping separators must differ.');
  const parts = source.split(decimal);
  if (parts.length > 2 || !parts[0] || (parts.length === 2 && !/^\d{1,2}$/.test(parts[1]!)))
    throw new Error('Invalid money grammar.');
  const whole = parts[0];
  let digits = whole;
  if (group && whole.includes(group)) {
    const groups = whole.split(group);
    if (!/^\d{1,3}$/.test(groups[0]!) || groups.slice(1).some((g) => !/^\d{3}$/.test(g)))
      throw new Error('Invalid money grouping.');
    digits = groups.join('');
  }
  if (!/^\d+$/.test(digits)) throw new Error('Invalid money grammar.');
  let cents = BigInt(digits) * 100n + BigInt((parts[1] ?? '').padEnd(2, '0') || '0');
  if (cents > 1000000000000000n) throw new Error('Money exceeds the minor-unit limit.');
  if (negative) cents = -cents;
  return formatMinor(cents);
}
function formatMinor(value: bigint): string {
  const abs = value < 0n ? -value : value;
  return `${value < 0n ? '-' : ''}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`;
}
function minor(value: string): bigint {
  const negative = value.startsWith('-');
  const raw = value.replace('-', '').replace('.', '');
  return BigInt(raw) * (negative ? -1n : 1n);
}
export function parseBankDate(
  value: string,
  p: Pick<BankParams, 'datePattern' | 'statementYear'>,
): string {
  option(
    p.datePattern,
    ['YYYY-MM-DD', 'DD/MM/YYYY', 'MM/DD/YYYY', 'DD/MM', 'MM/DD'],
    'date pattern',
  );
  if (
    (p.datePattern === 'DD/MM' || p.datePattern === 'MM/DD') &&
    (!Number.isInteger(p.statementYear) ||
      p.statementYear === null ||
      p.statementYear < 1900 ||
      p.statementYear > 2100)
  )
    throw new Error('Yearless dates require a statement year from 1900 to 2100.');
  text(value, 'Date', 100);
  const pattern = p.datePattern;
  const s = value.trim();
  let year: number, month: number, day: number;
  let m: RegExpExecArray | null;
  if (pattern === 'YYYY-MM-DD') {
    m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (!m) throw new Error('Date does not match selected pattern.');
    year = Number(m[1]);
    month = Number(m[2]);
    day = Number(m[3]);
  } else {
    const yearless = pattern === 'DD/MM' || pattern === 'MM/DD';
    m = (yearless ? /^(\d{2})\/(\d{2})$/ : /^(\d{2})\/(\d{2})\/(\d{4})$/).exec(s);
    if (!m) throw new Error('Date does not match selected pattern.');
    year = yearless ? (p.statementYear ?? 0) : Number(m[3]);
    day = Number(m[pattern.startsWith('DD') ? 1 : 2]);
    month = Number(m[pattern.startsWith('DD') ? 2 : 1]);
  }
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || year > 9999 || month < 1 || month > 12 || day < 1 || day > days[month - 1]!)
    throw new Error('Invalid Gregorian statement date.');
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function joined(items: BankTextItem[], spaces: boolean): string {
  let result = '';
  let previous: BankTextItem | undefined;
  for (const item of items) {
    if (
      previous &&
      spaces &&
      item.x - (previous.x + previous.width) > 0.25 * Math.max(previous.height, item.height)
    )
      result += ' ';
    result += item.text;
    previous = item;
  }
  return result;
}
export function validateBankDocument(value: unknown): BankDocument {
  record(value, ['pages', 'lines', 'rowTolerance'], 'Bank document');
  finite(value.rowTolerance, 'Row tolerance', 0.5, 5);
  array(value.pages, 100, 'PDF pages');
  array(value.lines, 20000, 'PDF lines');
  if (!value.pages.length) throw new Error('PDF has no pages.');
  let count = 0,
    total = 0;
  const pageWidths = new Map<number, number>();
  for (let i = 0; i < value.pages.length; i++) {
    const p = value.pages[i];
    record(p, ['page', 'width', 'height', 'visual'], 'PDF page');
    if (p.page !== i + 1) throw new Error('PDF pages must be consecutive.');
    finite(p.width, 'Page width', 1, 2000);
    finite(p.height, 'Page height', 1, 2000);
    option(p.visual, ['blank', 'text', 'nontext', 'mixed', 'unknown'], 'page visual status');
    pageWidths.set(i + 1, p.width);
  }
  const perPage = new Map<number, number>();
  let lastPage = 0,
    lastY = Infinity;
  for (const line of value.lines) {
    record(line, ['id', 'page', 'line', 'y', 'text', 'items'], 'PDF line');
    finite(line.page, 'Source page', 1, value.pages.length);
    if (!Number.isInteger(line.page)) throw new Error('Invalid source page.');
    const expected = (perPage.get(line.page) ?? 0) + 1;
    perPage.set(line.page, expected);
    if (line.line !== expected || line.id !== `p${line.page}-l${expected}` || line.page < lastPage)
      throw new Error('Noncanonical PDF provenance.');
    finite(line.y, 'Baseline');
    if (line.page === lastPage && line.y > lastY)
      throw new Error('PDF line order must follow descending baselines.');
    lastPage = line.page;
    lastY = line.y;
    text(line.text, 'Line text');
    array(line.items, 100000, 'Text items');
    if (!line.items.length) throw new Error('PDF source line must contain actual items.');
    let lastX = -Infinity;
    for (const item of line.items) {
      record(item, ['text', 'x', 'y', 'width', 'height'], 'PDF text item');
      text(item.text, 'Item text');
      finite(item.x, 'Item x', 0, pageWidths.get(line.page));
      finite(item.y, 'Item y');
      finite(item.width, 'Item width');
      finite(item.height, 'Item height');
      if (item.x < lastX || Math.abs(item.y - line.y) > value.rowTolerance)
        throw new Error('Invalid grouped text positions.');
      lastX = item.x;
      count++;
      total += new TextEncoder().encode(item.text).length;
    }
    if (joined(line.items as unknown as BankTextItem[], true) !== line.text)
      throw new Error('Source text does not match positioned items.');
  }
  if (count > 100000 || total > 10 * 1024 * 1024) throw new Error('PDF text budget exceeded.');
  return value as unknown as BankDocument;
}

export async function extractBankStatement(
  bytes: Uint8Array,
  rowTolerance: number,
  signal: AbortSignal,
  env: BankPdfEnvironment,
): Promise<BankDocument> {
  let task: PDFDocumentLoadingTask | undefined, pdf: PDFDocumentProxy | undefined;
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (task) void task.destroy().catch(() => {});
  };
  signal.addEventListener('abort', stop, { once: true });
  const result: BankDocument = { pages: [], lines: [], rowTolerance };
  let totalItems = 0,
    totalBytes = 0;
  const annotationBudget: BankAnnotationBudget = { count: 0, bytes: 0 };
  try {
    cancelled(signal);
    finite(rowTolerance, 'Row tolerance', 0.5, 5);
    if (
      !(bytes instanceof Uint8Array) ||
      !bytes.length ||
      bytes.length > BANK_LIMITS.inputBytes ||
      new TextDecoder().decode(bytes.subarray(0, 5)) !== '%PDF-'
    )
      throw new Error('Select a valid PDF of at most 20 MiB.');
    task = env.open(bytes);
    pdf = await task.promise;
    cancelled(signal);
    if (pdf.numPages < 1 || pdf.numPages > 100) throw new Error('PDF page limit is 100.');
    for (let n = 1; n <= pdf.numPages; n++) {
      cancelled(signal);
      const page = await pdf.getPage(n);
      try {
        cancelled(signal);
        if (page.rotate !== 0)
          throw new Error('Supported layout requires horizontal, unrotated selectable text.');
        const viewport = page.getViewport({ scale: 1, rotation: 0 });
        finite(viewport.width, 'Page width', 1, 2000);
        finite(viewport.height, 'Page height', 1, 2000);
        const content = await page.getTextContent({ disableNormalization: true });
        cancelled(signal);
        totalItems += content.items.length;
        if (totalItems > 100000) throw new Error('PDF text item limit is 100000.');
        const items: BankTextItem[] = [];
        for (const raw of content.items) {
          cancelled(signal);
          if (!('str' in raw)) continue;
          const transform = raw.transform as number[];
          if (
            raw.dir === 'ttb' ||
            Math.abs(transform[1] ?? NaN) > 0.000001 ||
            Math.abs(transform[2] ?? NaN) > 0.000001
          )
            throw new Error('Supported layout requires horizontal selectable text.');
          if (!raw.str.trim()) continue;
          text(raw.str, 'PDF text item');
          totalBytes += new TextEncoder().encode(raw.str).length;
          if (totalBytes > 10 * 1024 * 1024) throw new Error('PDF text exceeds 10 MiB.');
          const item = {
            text: raw.str,
            x: raw.transform[4]! - page.view[0]!,
            y: raw.transform[5]! - page.view[1]!,
            width: raw.width,
            height: raw.height,
          };
          finite(item.x, 'Text x', 0, viewport.width);
          finite(item.y, 'Text y', 0, viewport.height);
          finite(item.width, 'Text width');
          finite(item.height, 'Text height');
          items.push(item);
        }
        items.sort((a, b) => b.y - a.y || a.x - b.x);
        const groups: BankTextItem[][] = [];
        for (const item of items) {
          const last = groups.at(-1);
          if (last && Math.abs(item.y - last[0]!.y) <= rowTolerance) last.push(item);
          else groups.push([item]);
        }
        for (let i = 0; i < groups.length; i++) {
          const group = groups[i]!;
          const y = group[0]!.y;
          group.sort((a, b) => a.x - b.x);
          const lineText = joined(group, true);
          text(lineText, 'Joined PDF line');
          result.lines.push({
            id: `p${n}-l${i + 1}`,
            page: n,
            line: i + 1,
            y,
            text: lineText,
            items: group,
          });
          if (result.lines.length > 20000) throw new Error('PDF candidate line limit is 20000.');
        }
        let visual: BankPage['visual'] = 'unknown';
        let metadata: unknown;
        let metadataAvailable = false;
        try {
          metadata = await page.getAnnotations({ intent: 'display' });
          cancelled(signal);
          metadataAvailable = true;
        } catch {
          cancelled(signal);
        }
        if (metadataAvailable) {
          const annotations = projectBankAnnotations(metadata, page.view, annotationBudget, signal);
          try {
            const ops = await page.getOperatorList({ intent: 'display', annotationMode: 1 });
            cancelled(signal);
            visual = bankOperatorVisual(ops, annotations, items.length > 0, env, signal);
          } catch (error) {
            cancelled(signal);
            if (
              error instanceof BankAnnotationInputError &&
              error.message === 'PDF operator budget exceeded.'
            )
              throw error;
            visual = 'unknown';
          }
        }
        result.pages.push({ page: n, width: viewport.width, height: viewport.height, visual });
      } finally {
        page.cleanup();
      }
    }
    return validateBankDocument(result);
  } finally {
    signal.removeEventListener('abort', stop);
    if (pdf) await pdf.cleanup(false).catch(() => {});
    if (task && !stopped) {
      stopped = true;
      await task.destroy().catch(() => {});
    }
    await env.destroy();
  }
}

export interface BankReviewedRow {
  id: string;
  status: 'pending' | 'accepted' | 'ignored' | 'attached';
  role: BankRole;
  date: string;
  description: string;
  amount: string;
  debit: string;
  credit: string;
  balance: string;
  sourcePage: number;
  sourceLine: number;
  reviewReason: string;
  originalText: string;
  errors: string[];
  hasMoney: boolean;
  hasDate: boolean;
  raw: {
    date: string;
    description: string;
    amount: string;
    debit: string;
    credit: string;
    balance: string;
  };
}
export interface BankReview {
  rows: BankReviewedRow[];
  pages: BankPage[];
  status: 'pending-review' | 'reconciled' | 'reviewed-unreconciled' | 'reviewed-with-exceptions';
  delta: string | null;
  acceptedSum: string;
  pending: number;
  issues: string[];
}
export function reviewBankStatement(
  document: BankDocument,
  provided: unknown,
  options: { requireComplete?: boolean } = {},
): BankReview {
  validateBankDocument(document);
  const p = validateBankParams(provided);
  if (document.rowTolerance !== p.rowTolerance)
    throw new Error('Changed row tolerance requires extracting the PDF again.');
  for (const page of document.pages)
    for (const [key, r] of Object.entries(p.mapping))
      if (key !== 'mode' && (r as BankRange)[1] > page.width)
        throw new Error('Column mapping exceeds a source page width.');
  const decisions = new Map<string, BankLineDecision>();
  const ids = new Set(document.lines.map((l) => l.id));
  for (const d of p.lineDecisions) {
    if (!ids.has(d.id) || decisions.has(d.id))
      throw new Error('Unknown or duplicate line decision.');
    decisions.set(d.id, d);
  }
  const pages = new Map<number, BankPageDecision>();
  for (const d of p.pageDecisions) {
    if (!document.pages.some((page) => page.page === d.page) || pages.has(d.page))
      throw new Error('Unknown or duplicate page decision.');
    pages.set(d.page, d);
  }
  let pending = 0,
    exceptions = false;
  const issues: string[] = [];
  for (const page of document.pages) {
    const d = pages.get(page.page);
    if (page.visual === 'nontext' || page.visual === 'mixed' || page.visual === 'unknown') {
      if (!d || d.decision === 'pending') pending++;
      else {
        if (!d.reason?.trim())
          throw new Error('Visual-page decisions require a meaningful review reason.');
        if (page.visual !== 'mixed' || d.decision === 'ignore') exceptions = true;
      }
    }
    if (d?.decision === 'ignore' && page.visual !== 'blank') exceptions = true;
  }
  const rows: BankReviewedRow[] = [];
  let sum = 0n;
  const roleUsed = new Set<string>();
  for (const line of document.lines) {
    const d = decisions.get(line.id);
    const cell = (key: keyof Omit<BankMapping, 'mode'>) => {
      const r = p.mapping[key];
      return r
        ? joined(
            line.items.filter((item) => item.x >= r[0] && item.x < r[1]),
            key === 'description',
          ).trim()
        : '';
    };
    const raw = {
      date: cell('date'),
      description: cell('description'),
      amount: cell('amount'),
      debit: cell('debit'),
      credit: cell('credit'),
      balance: cell('balance'),
    };
    const edited = { ...raw, ...d?.edited };
    const errors: string[] = [];
    const money = (value: string, unsigned = false) => {
      if (!value) return '';
      try {
        return parseBankMoney(value, p, unsigned);
      } catch {
        errors.push('Invalid mapped money.');
        return '';
      }
    };
    const date = (value: string) => {
      if (!value) return '';
      try {
        return parseBankDate(value, p);
      } catch {
        errors.push('Invalid mapped date.');
        return '';
      }
    };
    const debit = money(edited.debit, true),
      credit = money(edited.credit, true);
    const amount =
      p.mapping.mode === 'signed-amount'
        ? money(edited.amount)
        : debit || credit
          ? formatMinor(minor(credit || '0.00') - minor(debit || '0.00'))
          : '';
    if (debit && credit && minor(debit) !== 0n && minor(credit) !== 0n)
      errors.push('Both debit and credit are nonzero.');
    const balance = money(edited.balance);
    const parsedDate = date(edited.date);
    const moneyLike = /(?:\d+[.,]\d{1,2}\b|[($€£¥]\s*\d|\d\s*(?:CR|DR)\b)/i.test(line.text);
    const hasMoney = Boolean(
      amount ||
      debit ||
      credit ||
      balance ||
      moneyLike ||
      Object.values(raw).some((v, i) => i >= 2 && v && /\d/.test(v)),
    );
    const hasDate = Boolean(parsedDate || /\d{1,4}[-/]\d{1,2}/.test(line.text));
    const row: BankReviewedRow = {
      id: line.id,
      status:
        d?.decision === 'accept'
          ? 'accepted'
          : d?.decision === 'ignore'
            ? 'ignored'
            : d?.decision === 'attach'
              ? 'attached'
              : 'pending',
      role: d?.role ?? 'transaction',
      date: parsedDate,
      description: edited.description,
      amount,
      debit: p.mapping.mode === 'debit-credit' ? debit : '',
      credit: p.mapping.mode === 'debit-credit' ? credit : '',
      balance,
      sourcePage: line.page,
      sourceLine: line.line,
      reviewReason: d?.reason ?? '',
      originalText: line.text,
      errors,
      hasMoney,
      hasDate,
      raw,
    };
    if (!d || d.decision === 'pending') pending++;
    if (d?.decision === 'accept') {
      if (errors.length) throw new Error(`${line.id}: ${errors.join(' ')}`);
      if (d.role === 'transaction') {
        if (!parsedDate || !amount)
          throw new Error(`${line.id}: transactions require valid date and amount.`);
        sum += minor(amount);
      } else if (d.role === 'opening' || d.role === 'closing') {
        if (roleUsed.has(d.role)) throw new Error('Duplicate opening or closing role.');
        roleUsed.add(d.role);
        const anchor = p[d.role];
        if (anchor === null) throw new Error('Balance roles require a provided matching anchor.');
        const target = parseBankMoney(anchor, p);
        if (!amount && !balance) throw new Error('Balance role requires mapped amount or balance.');
        if ((amount && amount !== target) || (balance && balance !== target))
          throw new Error('Mapped balance role does not equal its provided anchor.');
        row.balance = target;
        row.amount = '';
        row.debit = '';
        row.credit = '';
        row.date = '';
      } else {
        if (hasMoney) throw new Error('A monetary candidate cannot be non-financial.');
        row.amount = '';
        row.debit = '';
        row.credit = '';
        row.balance = '';
      }
    }
    if (d?.decision === 'ignore' && hasMoney) exceptions = true;
    if (d?.decision === 'attach') {
      if (
        hasMoney ||
        hasDate ||
        !row.description ||
        line.items.some(
          (item) =>
            !p.mapping.description ||
            item.x < p.mapping.description[0] ||
            item.x >= p.mapping.description[1],
        )
      )
        throw new Error('Attach only a description-only line without money or date.');
      const target = rows.find((r) => r.id === d.attachTo);
      if (!target || target.status !== 'accepted' || target.role !== 'transaction')
        throw new Error('Attachment target must be a prior accepted transaction.');
      const joinedDescription = `${target.description} ${row.description}`.trim();
      text(joinedDescription, 'Attached description');
      target.description = joinedDescription;
      row.amount = '';
      row.debit = '';
      row.credit = '';
      row.balance = '';
    }
    if (pages.get(line.page)?.decision === 'ignore' && row.status === 'accepted')
      throw new Error('An ignored page cannot contain accepted rows.');
    rows.push(row);
  }
  const opening = p.opening === null ? null : minor(parseBankMoney(p.opening, p)),
    closing = p.closing === null ? null : minor(parseBankMoney(p.closing, p));
  const delta = opening === null || closing === null ? null : formatMinor(opening + sum - closing);
  const transactions = rows.filter(
    (row) => row.status === 'accepted' && row.role === 'transaction',
  );
  let balances = true;
  if (transactions.some((row) => row.balance)) {
    if (opening === null || closing === null) balances = false;
    let expected = opening ?? 0n;
    for (const row of transactions) {
      expected += minor(row.amount);
      if (!row.balance || minor(row.balance) !== expected) balances = false;
    }
    if (transactions.at(-1)?.balance !== formatMinor(closing ?? 0n)) balances = false;
  }
  if (opening === null || closing === null)
    issues.push('Opening and closing anchors are both required for reconciliation.');
  if (!balances) issues.push('Running balances must cover the entire anchored transaction chain.');
  if (delta !== null && delta !== '0.00')
    issues.push('Opening plus accepted transactions does not equal closing.');
  const status = pending
    ? 'pending-review'
    : exceptions
      ? 'reviewed-with-exceptions'
      : delta === '0.00' && balances
        ? 'reconciled'
        : 'reviewed-unreconciled';
  if (
    options.requireComplete &&
    (pending || decisions.size !== document.lines.length || !p.acknowledged)
  )
    throw new Error(
      'Every candidate and visual page needs an explicit decision and acknowledgement before export.',
    );
  return {
    rows,
    pages: document.pages,
    status,
    delta,
    acceptedSum: formatMinor(sum),
    pending,
    issues,
  };
}

export function exportBankStatement(
  document: BankDocument,
  provided: unknown,
  signal?: AbortSignal,
): string {
  cancelled(signal);
  const p = validateBankParams(provided);
  const review = reviewBankStatement(document, p, { requireComplete: true });
  const labels = [
    'status',
    'role',
    'date',
    'description',
    'amount',
    'debit',
    'credit',
    'balance',
    'sourcePage',
    'sourceLine',
    'reviewReason',
    'overallStatus',
    'reconciliationDelta',
    'originalText',
    'pageDecision',
    'pageReviewReason',
    'pageVisual',
  ];
  const cells = review.rows.map((r) => {
    const decision = p.pageDecisions.find((d) => d.page === r.sourcePage);
    return [
      r.status,
      r.role,
      r.date,
      r.description,
      r.amount,
      r.debit,
      r.credit,
      r.balance,
      String(r.sourcePage),
      String(r.sourceLine),
      r.reviewReason,
      review.status,
      review.delta ?? '',
      r.originalText,
      decision?.decision ?? '',
      decision?.reason ?? '',
      document.pages[r.sourcePage - 1]!.visual,
    ];
  });
  for (const page of document.pages)
    if (
      ['nontext', 'mixed', 'unknown'].includes(page.visual) &&
      !document.lines.some((line) => line.page === page.page)
    ) {
      const d = p.pageDecisions.find((decision) => decision.page === page.page)!;
      cells.push([
        d.decision === 'ignore' ? 'page-ignored' : 'page-included',
        'non-financial',
        '',
        '',
        '',
        '',
        '',
        '',
        String(page.page),
        '',
        d.reason ?? '',
        review.status,
        review.delta ?? '',
        '',
        d.decision,
        d.reason ?? '',
        page.visual,
      ]);
    }
  const table: CsvTable = {
    columns: labels.map((label, i) => ({ id: `c${i}`, label })),
    rows: cells.map((row, i) => ({
      id: `r${i + 1}`,
      sourceRow: i + 1,
      originalWidth: labels.length,
      cells: row,
    })),
    warnings: [],
    hasHeader: true,
    delimiter: ',',
  };
  const csv = exportCsv(table, { spreadsheetSafe: p.spreadsheetSafe }, signal);
  if (new TextEncoder().encode(csv).length > BANK_LIMITS.outputBytes)
    throw new Error('Bank CSV exceeds 32 MiB.');
  return csv;
}
