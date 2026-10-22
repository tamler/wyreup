import { parseCsv, type CsvDelimiter, cloneUtilityJson } from '@wyreup/core/execution';

export interface FinanceColumn {
  key: string;
  label: string;
  type: 'number' | 'string';
  min?: number;
  max?: number;
  integer?: boolean;
  optional?: boolean;
  default?: number;
  maxLength?: number;
}
export interface FinanceRowContract {
  columns: FinanceColumn[];
  maxRows: number;
  allowEmpty?: boolean;
  bands?: boolean;
  countColumn?: string;
}
export type FinanceRow = Record<string, number | string | null>;
const name: FinanceColumn = {
  key: 'name',
  label: 'Name',
  type: 'string',
  optional: true,
  maxLength: 120,
};
const number = (
  key: string,
  label: string,
  max = 1e12,
  extra: Partial<FinanceColumn> = {},
): FinanceColumn => ({ key, label, type: 'number', min: 0, max, ...extra });
const counts = (key: string, label: string): FinanceColumn =>
  number(key, label, 1e6, { integer: true });
const rates = (key: string, label: string, extra: Partial<FinanceColumn> = {}): FinanceColumn =>
  number(key, `${label} (%) — your rate`, 100, extra);
const contracts: Record<string, Record<string, FinanceRowContract>> = {
  'discount-calculator': {
    discountRatesJson: { columns: [rates('percent', 'Discount')], maxRows: 100 },
  },
  'amazon-fba-profit-calculator': {
    feeBandsJson: {
      columns: [
        number('upperBound', 'Inclusive upper fee-base bound', 1e12, {
          min: 0.000001,
          optional: true,
        }),
        rates('percent', 'Band rate'),
      ],
      maxRows: 100,
      bands: true,
    },
  },
  'ebay-fee-profit-calculator': {
    feeBandsJson: {
      columns: [
        number('upperBound', 'Inclusive upper fee-base bound', 1e12, {
          min: 0.000001,
          optional: true,
        }),
        rates('percent', 'Band rate'),
      ],
      maxRows: 100,
      bands: true,
    },
  },
  'patreon-earnings-calculator': {
    tiersJson: {
      columns: [
        name,
        counts('members', 'Members'),
        number('monthlyPrice', 'Monthly price in selected currency'),
        counts('failedMembers', 'Failed members'),
        number('taxPerMember', 'Buyer tax per member'),
        rates('paymentPercent', 'Override payment rate', { optional: true }),
        number('paymentFixed', 'Override fixed payment fee', 1e12, { optional: true }),
      ].map((field) =>
        ['failedMembers', 'taxPerMember'].includes(field.key)
          ? { ...field, optional: true, default: 0 }
          : field,
      ),
      maxRows: 1000,
      countColumn: 'members',
    },
  },
  'twitch-subscription-revenue-calculator': {
    tiersJson: {
      columns: [
        name,
        counts('subscriberCount', 'Subscribers'),
        number('netSubscriptionPrice', 'Net shared price in selected currency'),
        rates('creatorSharePercent', 'Creator share'),
      ],
      maxRows: 1000,
      countColumn: 'subscriberCount',
    },
    primeJson: {
      columns: [
        name,
        counts('count', 'Prime subscriptions'),
        number('payoutPerSubscription', 'Known payout per subscription'),
      ],
      maxRows: 1000,
      countColumn: 'count',
      allowEmpty: true,
    },
  },
  'redbubble-profit-calculator': {
    itemsJson: {
      columns: [
        name,
        number('basePriceAfterDiscount', 'Base price after discount'),
        rates('markupPercent', 'Artist markup', { max: 1000 }),
        counts('quantity', 'New sales this period'),
      ],
      maxRows: 1000,
      countColumn: 'quantity',
    },
  },
  'recipe-cost-calculator': {
    ingredientsJson: {
      columns: [
        name,
        number('packageCost', 'Package cost in selected currency'),
        number('packageQuantity', 'Package quantity', 1e12, { min: 0.000001 }),
        number('usedQuantity', 'Quantity used in same unit'),
        { key: 'unit', label: 'Same unit for package and use', type: 'string', maxLength: 30 },
        rates('wastePercent', 'Waste', { max: 99.999999, optional: true, default: 0 }),
      ],
      maxRows: 1000,
    },
  },
};
export function financeRowContract(toolId: string, key: string): FinanceRowContract | undefined {
  return contracts[toolId]?.[key];
}
export function newFinanceRow(contract: FinanceRowContract): FinanceRow {
  return Object.fromEntries(
    contract.columns
      .filter((column) => !column.optional || column.default !== undefined)
      .map((column) => [column.key, column.default ?? (column.type === 'string' ? '' : null)]),
  );
}

export function validateFinanceRows(value: unknown, contract: FinanceRowContract): FinanceRow[] {
  value = cloneUtilityJson(value);
  if (
    !Array.isArray(value) ||
    value.length > contract.maxRows ||
    (!contract.allowEmpty && value.length === 0)
  )
    throw new Error(`Supply ${contract.allowEmpty ? '0' : '1'} to ${contract.maxRows} rows.`);
  let totalCount = 0;
  let previous = 0;
  return value.map((entry: unknown, i: number) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry))
      throw new Error(`Row ${i + 1}: expected row fields.`);
    const input = entry as Record<string, unknown>;
    const output: FinanceRow = {};
    for (const key of Object.keys(input))
      if (!contract.columns.some((column) => column.key === key))
        throw new Error(`Row ${i + 1}: unknown column ${key}.`);
    for (const column of contract.columns) {
      let cell = input[column.key];
      if (cell === undefined) {
        if (column.default !== undefined) cell = column.default;
        else if (column.optional) continue;
      }
      if (column.type === 'number') {
        if (
          typeof cell !== 'number' ||
          !Number.isFinite(cell) ||
          cell < (column.min ?? 0) ||
          cell > (column.max ?? 1e12) ||
          (column.integer && !Number.isInteger(cell))
        )
          throw new Error(
            `Row ${i + 1}, ${column.label}: enter a finite ${column.integer ? 'integer ' : ''}number in the stated bounds.`,
          );
      } else if (
        typeof cell !== 'string' ||
        cell.length > (column.maxLength ?? 120) ||
        (!column.optional && cell.trim() === '')
      )
        throw new Error(`Row ${i + 1}, ${column.label}: enter bounded text.`);
      output[column.key] = cell;
    }
    if (contract.bands) {
      const upper = output.upperBound;
      if (upper === undefined) {
        if (i !== value.length - 1)
          throw new Error('Only the last band can cover the remaining amount.');
      } else {
        if (typeof upper !== 'number' || upper <= previous || i === value.length - 1)
          throw new Error('Use ascending bounds and a final remaining-amount band.');
        previous = upper;
      }
    }
    if (contract.countColumn) {
      totalCount += output[contract.countColumn] as number;
      if (totalCount > 1e6) throw new Error('Combined row counts exceed 1,000,000.');
    }
    if (
      Object.hasOwn(output, 'failedMembers') &&
      Number(output.failedMembers) > Number(output.members)
    )
      throw new Error(`Row ${i + 1}: failed members exceed members.`);
    if (Object.hasOwn(output, 'paymentPercent') !== Object.hasOwn(output, 'paymentFixed'))
      throw new Error(`Row ${i + 1}: payment-rate override and fixed fee must both be included.`);
    return output;
  });
}
export function decodeFinanceRows(raw: unknown, contract: FinanceRowContract): FinanceRow[] {
  if (typeof raw !== 'string' || raw.length > 100000)
    throw new Error('Supply a bounded JSON row string.');
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error('Row data is not valid JSON.');
  }
  return validateFinanceRows(value, contract);
}
export function encodeFinanceRows(value: unknown, contract: FinanceRowContract): string {
  const output = JSON.stringify(validateFinanceRows(value, contract));
  if (output.length > 100000) throw new Error('Row data exceeds 100,000 characters.');
  return output;
}
export function parseFinanceRowsCsv(
  raw: string,
  delimiter: Exclude<CsvDelimiter, 'auto'>,
  contract: FinanceRowContract,
): FinanceRow[] {
  if (raw.length > 100000) throw new Error('Pasted rows exceed 100,000 characters.');
  const table = parseCsv(new TextEncoder().encode(raw), { delimiter, hasHeader: true });
  const headers = table.columns.map((column) => column.label);
  if (
    new Set(headers).size !== headers.length ||
    headers.some((header) => !contract.columns.some((column) => column.key === header))
  )
    throw new Error('Headers must be exact, unique declared column names.');
  for (const column of contract.columns)
    if (!column.optional && !headers.includes(column.key))
      throw new Error(`Missing required column ${column.key}.`);
  if (table.warnings.length)
    throw new Error('Every pasted row must have the same declared column count.');
  const parsed = table.rows.map((row, i) =>
    Object.fromEntries<string | number>(
      headers.map((header, j): [string, string | number] => {
        const column = contract.columns.find((candidate) => candidate.key === header)!;
        const cell = row.cells[j];
        if (column.type === 'string') return [header, cell];
        if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(cell))
          throw new Error(
            `Row ${i + 1}, ${header}: use an explicit decimal number, without symbols, separators, exponent or blank zero.`,
          );
        return [header, Number(cell)];
      }),
    ),
  );
  return validateFinanceRows(parsed, contract);
}
