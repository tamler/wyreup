import type { ParamFieldSchema, ToolCategory, ToolModule, ToolRunContext } from '../types.js';
import { cloneUtilityJson, createUtility, numberParam, stringParam, UtilityInputError, validateUtilityParams, type UtilityParams, type UtilityResult } from './common.js';


export const BUILDING_UNITS = {
  length: 'metres unless field suffix specifies otherwise',
  area: 'square metres',
  volume: 'cubic metres',
  mass: 'kilograms',
  cost: 'entered currency units; rounded once to hundredths',
};
export type Spec = readonly [unknown, ParamFieldSchema];
export const buildingNumber = (value: number, min = 0, max = 10000, integer = false): Spec => [
  value,
  { type: 'number', label: '', min, max, ...(integer ? { step: 1 } : {}) },
];
export const buildingChoice = (value: string, values: string[]): Spec => [
  value,
  { type: 'enum', label: '', options: values.map((value) => ({ value, label: value })) },
];
export const string = (value: string, maxLength = 120): Spec => [
  value,
  { type: 'string', label: '', maxLength },
];
export const buildingRows = (value: unknown): Spec => [value, { type: 'json', label: '' }];
export const buildingN = (params: UtilityParams, key: string): number => numberParam(params, key);
export function buildingError(
  field: string,
  message: string,
  code: 'bounds' | 'budget' = 'bounds',
): never {
  throw new UtilityInputError(field, code, message);
}
export function buildingCount(value: number, field: string): number {
  if (!Number.isFinite(value) || !Number.isSafeInteger(value) || value < 0 || value > 1000000)
    buildingError(
      `$.result.${field}`,
      'Count exceeds one million or is not a nonnegative safe integer.',
      'budget',
    );
  return value;
}
export function purchaseCeiling(value: number, field: string): number {
  if (!Number.isFinite(value) || value < 0)
    buildingError(`$.result.${field}`, 'Invalid purchase quantity.');
  const nearest = Math.round(value);
  const result =
    nearest >= 1 && Math.abs(value - nearest) <= 8 * Number.EPSILON * Math.max(1, Math.abs(value))
      ? nearest
      : Math.ceil(value);
  return buildingCount(result, field);
}
export function buildingResult(
  result: UtilityResult,
  assumptions: string[],
  max = Number.POSITIVE_INFINITY,
  units: Record<string, string> = BUILDING_UNITS,
): UtilityResult {
  const inspect = (value: unknown, path: string): void => {
    if (typeof value === 'number' && (!Number.isFinite(value) || Math.abs(value) > max))
      buildingError(path, 'Derived value is nonfinite or exceeds the output bound.');
    if (Array.isArray(value)) value.forEach((child, i) => inspect(child, `${path}[${i}]`));
    else if (value && typeof value === 'object')
      for (const [key, child] of Object.entries(value)) inspect(child, `${path}.${key}`);
  };
  inspect(result, '$.result');
  return { ...result, units, assumptions };
}
export function buildingSpecs(specs: Record<string, Spec>) {
  const defaults: UtilityParams = {};
  const paramSchema: Record<string, ParamFieldSchema> = {};
  for (const [key, [value, schema]] of Object.entries(specs)) {
    defaults[key] = value;
    paramSchema[key] = {
      ...schema,
      label: key.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()),
    };
  }
  return { defaults, paramSchema };
}
export function buildingUtility(
  id: string,
  name: string,
  description: string,
  specs: Record<string, Spec>,
  calculate: (p: UtilityParams, ctx: ToolRunContext) => UtilityResult,
  assumptions: string[],
  category: ToolCategory = 'building',
  resultLimit?: number,
  units?: Record<string, string>,
): ToolModule<UtilityParams> {
  return createUtility({
    id,
    name,
    description,
    ...buildingSpecs(specs),
    category,
    keywords: id.split('-'),
    calculate: (p, ctx) => buildingResult(calculate(p, ctx), assumptions, resultLimit, units),
  });
}
export const N = buildingNumber;
export const W = (value: number) => N(value, 0, 100);
export const cost = (value: number) => N(value, 0, 1000000);
export const n = buildingN;

export interface BoardFootPiece {
  thicknessIn: number;
  widthIn: number;
  lengthFt: number;
  quantity: number;
  pricePerBoardFoot: number;
}
export interface GutterCandidate {
  name: string;
  widthM: number;
  waterDepthM: number;
}
export type RowColumn =
  | { type: 'number'; min: number; max: number; integer?: boolean }
  | { type: 'string'; minLength?: number; maxLength: number };
export function validateBuildingRows(
  value: unknown,
  field: string,
  columns: Record<string, RowColumn>,
  maxRows: number,
): Record<string, string | number>[] {
  const cloned = cloneUtilityJson(value, `$.${field}`);
  if (!Array.isArray(cloned))
    throw new UtilityInputError(`$.${field}`, 'type', 'Expected an array of rows.');
  if (cloned.length > maxRows)
    throw new UtilityInputError(`$.${field}`, 'budget', `At most ${maxRows} rows.`);
  return cloned.map((row, index) => {
    const path = `$.${field}[${index}]`;
    if (!row || typeof row !== 'object' || Array.isArray(row))
      throw new UtilityInputError(path, 'type', 'Expected a plain row object.');
    for (const key of Object.keys(row))
      if (!Object.hasOwn(columns, key))
        throw new UtilityInputError(`${path}.${key}`, 'unknown', 'Unknown column.');
    const result: Record<string, string | number> = {};
    for (const [key, spec] of Object.entries(columns)) {
      if (!Object.hasOwn(row, key))
        throw new UtilityInputError(`${path}.${key}`, 'required', 'Required column.');
      const cell = row[key];
      if (typeof cell !== spec.type)
        throw new UtilityInputError(`${path}.${key}`, 'type', `Expected ${spec.type}.`);
      if (spec.type === 'number') {
        const number = cell as number;
        if (spec.integer && !Number.isInteger(number))
          throw new UtilityInputError(`${path}.${key}`, 'integer', 'Expected a whole number.');
        if (!Number.isFinite(number) || number < spec.min || number > spec.max)
          throw new UtilityInputError(
            `${path}.${key}`,
            'bounds',
            `Use ${spec.min} through ${spec.max}.`,
          );
      } else if (
        (cell as string).trim().length < (spec.minLength ?? 1) ||
        (cell as string).length > spec.maxLength
      )
        throw new UtilityInputError(
          `${path}.${key}`,
          'bounds',
          `Use nonblank text of at most ${spec.maxLength} characters.`,
        );
      result[key] = cell as string | number;
    }
    return result;
  });
}
export function validateBoardFootPieces(value: unknown): BoardFootPiece[] {
  return validateBuildingRows(
    value,
    'pieces',
    {
      thicknessIn: { type: 'number', min: 0.000001, max: 10000 },
      widthIn: { type: 'number', min: 0.000001, max: 10000 },
      lengthFt: { type: 'number', min: 0.000001, max: 10000 },
      quantity: { type: 'number', min: 0, max: 1000000, integer: true },
      pricePerBoardFoot: { type: 'number', min: 0, max: 1000000 },
    },
    100,
  ) as unknown as BoardFootPiece[];
}
export function validateGutterCandidates(value: unknown): GutterCandidate[] {
  return validateBuildingRows(
    value,
    'candidates',
    {
      name: { type: 'string', maxLength: 120 },
      widthM: { type: 'number', min: 0.000001, max: 100 },
      waterDepthM: { type: 'number', min: 0.000001, max: 100 },
    },
    32,
  ) as unknown as GutterCandidate[];
}

export interface ConstructionMaterial {
  description: string;
  quantity: number;
  unit: string;
  unitPrice: number;
}
export interface ConstructionLabor {
  description: string;
  hours: number;
  hourlyRate: number;
}
export interface ConstructionEstimateParams {
  title: string;
  customer: string;
  currency: string;
  materials: ConstructionMaterial[];
  labor: ConstructionLabor[];
  markupPercent: number;
  discount: number;
  taxPercent: number;
  notes: string;
  issueDate: string;
  format: 'json' | 'pdf';
}
export type ValidatedConstructionEstimate = ConstructionEstimateParams;
export type ConstructionEstimateResult = UtilityResult & {
  totalMinor: number;
  currency: string;
  pdfMetadataDate: string;
};
export const constructionSpecs = buildingSpecs({
  title: string('Construction estimate'),
  customer: string('Example customer'),
  currency: string('USD', 3),
  materials: buildingRows([{ description: 'Material', quantity: 10, unit: 'each', unitPrice: 5 }]),
  labor: buildingRows([{ description: 'Labor', hours: 2, hourlyRate: 20 }]),
  markupPercent: W(10),
  discount: cost(0),
  taxPercent: W(5),
  notes: string('Quantities and rates are estimates.', 2000),
  issueDate: string('', 10),
  format: buildingChoice('json', ['json', 'pdf']),
});
export function decimal(value: number, field: string, maxScale: number): [bigint, bigint] {
  const [coefficient, exponentText] = value.toString().toLowerCase().split('e');
  const exponent = exponentText === undefined ? 0 : Number(exponentText),
    parts = coefficient!.split('.'),
    digits = parts.join(''),
    scale = (parts[1]?.length ?? 0) - exponent;
  if (scale > maxScale)
    throw new UtilityInputError(field, 'bounds', `At most ${maxScale} decimal places.`);
  return scale > 0
    ? [BigInt(digits), 10n ** BigInt(scale)]
    : [BigInt(digits) * 10n ** BigInt(-scale), 1n];
}
export const halfUp = (a: bigint, b: bigint) => (2n * a + b) / (2n * b);
export const minor = (value: number, field: string) => {
  const [a, b] = decimal(value, field, 6);
  return halfUp(a * 100n, b);
};
export function validateConstructionEstimate(params: UtilityParams): ValidatedConstructionEstimate {
  const p = validateUtilityParams(
    constructionSpecs.defaults,
    constructionSpecs.paramSchema,
    params,
  );
  const materials = validateBuildingRows(
    p.materials,
    'materials',
    {
      description: { type: 'string', maxLength: 120 },
      quantity: { type: 'number', min: 0, max: 1000000 },
      unit: { type: 'string', maxLength: 120 },
      unitPrice: { type: 'number', min: 0, max: 1000000 },
    },
    100,
  ) as unknown as ConstructionMaterial[];
  const labor = validateBuildingRows(
    p.labor,
    'labor',
    {
      description: { type: 'string', maxLength: 120 },
      hours: { type: 'number', min: 0, max: 1000000 },
      hourlyRate: { type: 'number', min: 0, max: 1000000 },
    },
    100,
  ) as unknown as ConstructionLabor[];
  for (const [rowIndex, row] of materials.entries())
    for (const key of ['quantity', 'unitPrice'] as const)
      decimal(row[key], `$.materials[${rowIndex}].${key}`, 6);
  for (const [rowIndex, row] of labor.entries())
    for (const key of ['hours', 'hourlyRate'] as const)
      decimal(row[key], `$.labor[${rowIndex}].${key}`, 6);
  for (const key of ['markupPercent', 'taxPercent']) decimal(n(p, key), key, 4);
  decimal(n(p, 'discount'), 'discount', 6);
  const currency = stringParam(p, 'currency'),
    issueDate = stringParam(p, 'issueDate');
  if (!/^[A-Z]{3}$/.test(currency))
    buildingError(
      'currency',
      'Enter three uppercase ASCII letters; currency is context, not conversion.',
    );
  if (issueDate) {
    const stamp = new Date(`${issueDate}T00:00:00Z`);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(issueDate) ||
      Number(issueDate.slice(0, 4)) < 1900 ||
      !Number.isFinite(stamp.getTime()) ||
      stamp.toISOString().slice(0, 10) !== issueDate
    )
      buildingError('issueDate', 'Use a valid YYYY-MM-DD year1900..9999 or leave blank.');
  }
  return { ...p, materials, labor } as unknown as ValidatedConstructionEstimate;
}
export function calculateConstructionEstimate(
  p: ValidatedConstructionEstimate,
): ConstructionEstimateResult {
  const line = (a: number, b: number, field: string) => {
    const [an, ad] = decimal(a, field, 6),
      [bn, bd] = decimal(b, field, 6);
    return halfUp(an * bn * 100n, ad * bd);
  };
  const materials = p.materials.map((row, i) => ({
    ...row,
    lineMinor: Number(line(row.quantity, row.unitPrice, `$.materials[${i}]`)),
  }));
  const labor = p.labor.map((row, i) => ({
    ...row,
    lineMinor: Number(line(row.hours, row.hourlyRate, `$.labor[${i}]`)),
  }));
  const subtotal = materials
      .concat(labor as unknown as typeof materials)
      .reduce((sum, row) => sum + BigInt(row.lineMinor), 0n),
    [markupN, markupD] = decimal(p.markupPercent, 'markupPercent', 4),
    markup = halfUp(subtotal * markupN, markupD * 100n),
    discount = minor(p.discount, 'discount');
  if (discount > subtotal + markup)
    buildingError('discount', 'Rounded discount exceeds subtotal plus markup.');
  const taxable = subtotal + markup - discount,
    [taxN, taxD] = decimal(p.taxPercent, 'taxPercent', 4),
    tax = halfUp(taxable * taxN, taxD * 100n),
    total = taxable + tax;
  if (total > 100000000000000n)
    buildingError('$.result.totalMinor', 'Estimate exceeds100 trillion minor units.', 'budget');
  const minors = {
      subtotalMinor: Number(subtotal),
      markupMinor: Number(markup),
      discountMinor: Number(discount),
      taxableMinor: Number(taxable),
      taxMinor: Number(tax),
      totalMinor: Number(total),
    },
    formattedTotals: Record<string, string> = {},
    numericTotals: Record<string, number> = {};
  for (const [key, value] of Object.entries(minors)) {
    const integer = BigInt(value);
    formattedTotals[key] = `${integer / 100n}.${String(integer % 100n).padStart(2, '0')}`;
    numericTotals[key] = value / 100;
  }
  return buildingResult(
    {
      title: p.title,
      customer: p.customer,
      notes: p.notes,
      currency: p.currency,
      issueDate: p.issueDate,
      pdfMetadataDate: p.issueDate || '2000-01-01',
      materials,
      labor,
      ...minors,
      formattedTotals,
      numericTotals,
    },
    [
      'All currencies use explicit hundredths. Round each line half-up, then markup, discount and tax separately. Displayed components add exactly in minor units.',
    ],
    1e14,
  ) as ConstructionEstimateResult;
}

