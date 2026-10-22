import type { ToolRunContext } from '../types.js';
import {
  numberParam,
  stringParam,
  UtilityInputError,
  type JsonValue,
  type UtilityParams,
  type UtilityResult,
} from './common.js';

type Calculation = (p: UtilityParams, ctx: ToolRunContext) => UtilityResult | Promise<UtilityResult>;

type Q = { n: bigint; d: bigint };
const ZERO: Q = { n: 0n, d: 1n };
const ONE: Q = { n: 1n, d: 1n };
const HUNDRED: Q = { n: 100n, d: 1n };
const LIMIT = BigInt(Number.MAX_SAFE_INTEGER);
function fail(field: string, message: string): never {
  throw new UtilityInputError(field, 'bounds', message);
}
function q(n: bigint, d = 1n): Q {
  if (!d) fail('arithmetic', 'Division by zero.');
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  let a = n < 0n ? -n : n;
  let b = d;
  while (b) {
    const next = a % b;
    a = b;
    b = next;
  }
  return { n: n / a, d: d / a };
}
function add(a: Q, b: Q): Q {
  return q(a.n * b.d + b.n * a.d, a.d * b.d);
}
function sub(a: Q, b: Q): Q {
  return q(a.n * b.d - b.n * a.d, a.d * b.d);
}
function mul(a: Q, b: Q): Q {
  return q(a.n * b.n, a.d * b.d);
}
function div(a: Q, b: Q): Q {
  return q(a.n * b.d, a.d * b.n);
}
function cmp(a: Q, b: Q): number {
  const n = a.n * b.d - b.n * a.d;
  return n < 0n ? -1 : n > 0n ? 1 : 0;
}
function min(a: Q, b: Q): Q {
  return cmp(a, b) < 0 ? a : b;
}
function max(a: Q, b: Q): Q {
  return cmp(a, b) > 0 ? a : b;
}
function floor(a: Q): bigint {
  const x = a.n / a.d;
  return a.n < 0n && a.n % a.d ? x - 1n : x;
}
function ceil(a: Q): bigint {
  return -floor(q(-a.n, a.d));
}
function decimal(value: number): Q {
  if (!Number.isFinite(value)) fail('arithmetic', 'Finite numbers required.');
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(String(value));
  if (!match) fail('arithmetic', 'Unsupported decimal.');
  const power = Number(match[4] ?? 0) - (match[3]?.length ?? 0);
  const n = BigInt(`${match[1]}${match[2]}${match[3] ?? ''}`);
  return power >= 0 ? q(n * 10n ** BigInt(power)) : q(n, 10n ** BigInt(-power));
}
function value(a: Q): number {
  const negative = a.n < 0n;
  const n = negative ? -a.n : a.n;
  const whole = n / a.d;
  const fraction = ((n % a.d) * 1000000000000000n) / a.d;
  const result = Number(`${whole}.${String(fraction).padStart(15, '0')}`);
  if (!Number.isFinite(result)) fail('arithmetic', 'Derived value overflow.');
  return negative ? -result : result;
}
function roundInteger(a: Q): bigint {
  const n = a.n < 0n ? -a.n : a.n;
  const rounded = n / a.d + (2n * (n % a.d) >= a.d ? 1n : 0n);
  const result = a.n < 0n ? -rounded : rounded;
  if (result > LIMIT || result < -LIMIT)
    fail('arithmetic', 'Minor-unit ledger exceeds safe integer bounds.');
  return result;
}
function digits(p: UtilityParams): number {
  return numberParam(p, 'currencyDecimals', { min: 0, max: 3, integer: true });
}
function scale(p: UtilityParams): Q {
  return q(10n ** BigInt(digits(p)));
}
function settled(a: Q, p: UtilityParams): Q {
  return div(q(roundInteger(mul(a, scale(p)))), scale(p));
}
function money(p: UtilityParams, key: string): Q {
  const a = decimal(numberParam(p, key, { min: 0, max: 1e12 }));
  const units = mul(a, scale(p));
  if (units.d !== 1n || units.n > LIMIT)
    fail(key, 'Enter an amount representable in the declared currency minor units.');
  return a;
}
function rate(p: UtilityParams, key: string, maxRate = 100): Q {
  const a = decimal(numberParam(p, key, { min: 0, max: maxRate }));
  if (1000000n % a.d !== 0n) fail(key, 'Rates support at most six decimal places.');
  return div(a, HUNDRED);
}
function count(p: UtilityParams, key: string, minimum = 0, maximum = 1e6): number {
  return numberParam(p, key, { min: minimum, max: maximum, integer: true });
}
function sum(items: Q[]): Q {
  return items.reduce(add, ZERO);
}
function optionalRatio(n: Q, d: Q): number | null {
  return d.n === 0n ? null : value(div(n, d));
}
function check(ctx: ToolRunContext): void {
  if (ctx.signal.aborted) throw new UtilityInputError('$run', 'abort', 'Calculation cancelled.');
}
type Band = { upperBound?: Q; percent: Q };
interface Fee {
  name: string;
  a: Q;
  b: Q;
  percent: Q;
  fixed: Q;
  minimum: Q;
  cap?: Q;
  bands?: Band[];
  tierMode?: string;
}
function rowList(
  p: UtilityParams,
  key: string,
  allowed: string[],
  cap = 1000,
  empty = false,
): Record<string, unknown>[] {
  const raw = stringParam(p, key);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    fail(key, 'Enter a valid JSON row list.');
  }
  if (!Array.isArray(parsed) || parsed.length > cap || (!empty && parsed.length === 0))
    fail(key, `Supply ${empty ? '0' : '1'} to ${cap} rows.`);
  return parsed.map((row: unknown, i: number) => {
    if (!row || typeof row !== 'object' || Array.isArray(row))
      fail(key, `Row ${i + 1}: expected an object.`);
    const item = row as Record<string, unknown>;
    for (const field of Object.keys(item))
      if (!allowed.includes(field)) fail(key, `Row ${i + 1}: unknown column ${field}.`);
    if (item.name !== undefined && (typeof item.name !== 'string' || item.name.length > 120))
      fail(key, `Row ${i + 1}: name must be at most 120 characters.`);
    return item;
  });
}
function rowNumber(
  row: Record<string, unknown>,
  key: string,
  index: number,
  minValue = 0,
  maxValue = 1e12,
  integer = false,
  optional?: number,
): number {
  if (!Object.hasOwn(row, key) && optional !== undefined) return optional;
  const n = row[key];
  if (
    typeof n !== 'number' ||
    !Number.isFinite(n) ||
    n < minValue ||
    n > maxValue ||
    (integer && !Number.isInteger(n))
  )
    fail(
      key,
      `Row ${index + 1}: enter a finite ${integer ? 'integer ' : ''}number from ${minValue} to ${maxValue}.`,
    );
  return n;
}
function rowMoney(
  row: Record<string, unknown>,
  key: string,
  index: number,
  p: UtilityParams,
  optional?: number,
): Q {
  return money({ ...p, [key]: rowNumber(row, key, index, 0, 1e12, false, optional) }, key);
}
function rowRate(
  row: Record<string, unknown>,
  key: string,
  index: number,
  maximum = 100,
  optional?: number,
): Q {
  return rate({ [key]: rowNumber(row, key, index, 0, maximum, false, optional) }, key, maximum);
}
function bands(p: UtilityParams): Band[] {
  const list = rowList(p, 'feeBandsJson', ['upperBound', 'percent'], 100);
  let previous = ZERO;
  return list.map((row, i) => {
    const percentValue = rowRate(row, 'percent', i);
    if (!Object.hasOwn(row, 'upperBound')) {
      if (i !== list.length - 1)
        fail('feeBandsJson', 'Only the final band can mean remaining amount.');
      return { percent: percentValue };
    }
    const upper = rowMoney(row, 'upperBound', i, p);
    if (cmp(upper, previous) <= 0 || i === list.length - 1)
      fail('feeBandsJson', 'Bounds must ascend, with a final remaining-amount band.');
    previous = upper;
    return { upperBound: upper, percent: percentValue };
  });
}
function percentage(base: Q, fee: Fee): Q {
  if (!fee.bands) return mul(base, fee.percent);
  let previous = ZERO;
  let amount = ZERO;
  for (const band of fee.bands) {
    if (fee.tierMode === 'whole') {
      if (!band.upperBound || cmp(base, band.upperBound) <= 0) return mul(base, band.percent);
    } else {
      const slice = max(ZERO, sub(band.upperBound ? min(base, band.upperBound) : base, previous));
      amount = add(amount, mul(slice, band.percent));
    }
    if (band.upperBound) previous = band.upperBound;
  }
  return amount;
}
function rawFee(x: Q, fee: Fee): Q {
  const raw = max(fee.minimum, add(percentage(add(mul(fee.a, x), fee.b), fee), fee.fixed));
  return fee.cap ? min(raw, fee.cap) : raw;
}
function fee(
  name: string,
  p: UtilityParams,
  percentKey: string,
  fixedKey?: string,
  a = ONE,
  b = ZERO,
  minimumKey?: string,
  capKey?: string,
): Fee {
  const item: Fee = {
    name,
    a,
    b,
    percent: rate(p, percentKey),
    fixed: fixedKey ? money(p, fixedKey) : ZERO,
    minimum: minimumKey ? money(p, minimumKey) : ZERO,
  };
  if (capKey && p[`${capKey}Enabled`] === true) {
    item.cap = money(p, capKey);
    if (cmp(item.cap, item.minimum) < 0) fail(capKey, 'Cap must be at least the minimum fee.');
  }
  return item;
}
function feeTotals(
  x: Q,
  components: Fee[],
  vat: Q,
  p: UtilityParams,
): { fees: JsonValue[]; raw: Q; total: Q } {
  const entries = components.map((item) => {
    const raw = rawFee(x, item);
    const amount = settled(raw, p);
    return { item, raw, amount };
  });
  const beforeVat = sum(entries.map((entry) => entry.amount));
  const vatAmount = settled(mul(beforeVat, vat), p);
  return {
    fees: [
      ...entries.map(({ item, raw, amount }) => ({
        name: item.name,
        base: value(add(mul(item.a, x), item.b)),
        rawAmount: value(raw),
        amount: value(amount),
        minorUnits: Number(roundInteger(mul(amount, scale(p)))),
      })),
      {
        name: 'VAT on fees',
        base: value(beforeVat),
        rawAmount: value(mul(beforeVat, vat)),
        amount: value(vatAmount),
        minorUnits: Number(roundInteger(mul(vatAmount, scale(p)))),
      },
    ],
    raw: mul(sum(entries.map((entry) => entry.raw)), add(ONE, vat)),
    total: add(beforeVat, vatAmount),
  };
}
function ledger(
  p: UtilityParams,
  merchandise: Q,
  receipts: Q,
  tax: Q,
  components: Fee[],
  costs: Record<string, Q>,
  vat = ZERO,
): UtilityResult {
  const revenue = add(merchandise, receipts);
  const calculated = feeTotals(merchandise, components, vat, p);
  const costEntries = Object.entries(costs).map(([name, raw]) => ({
    name,
    rawAmount: value(raw),
    amount: value(settled(raw, p)),
  }));
  const sellerCost = sum(Object.values(costs).map((raw) => settled(raw, p)));
  const payout = sub(revenue, calculated.total);
  const profit = sub(payout, sellerCost);
  return {
    merchandise: value(merchandise),
    revenue: value(revenue),
    collectedTax: value(tax),
    chargedTotal: value(add(revenue, tax)),
    fees: calculated.fees,
    rawTotalFees: value(calculated.raw),
    totalFees: value(calculated.total),
    payout: value(payout),
    costs: costEntries,
    sellerCost: value(sellerCost),
    profit: value(profit),
    margin: optionalRatio(profit, revenue),
    marginStatus: revenue.n === 0n ? 'undefined, zero denominator' : 'defined',
    ROI: optionalRatio(profit, sellerCost),
    roiStatus: sellerCost.n === 0n ? 'undefined, zero denominator' : 'defined',
    limitations: [
      'Pass-through buyer tax is excluded from earnings. Merchant shipping expense differs from customer shipping receipts.',
    ],
  };
}
// Partition raw affine fee pieces, then enumerate a conservative rounding envelope.
// Rounded net is deliberately not assumed monotone.
function grossUp(
  p: UtilityParams,
  target: Q,
  receipts: Q,
  costs: Q,
  components: Fee[],
  vat: Q,
  ctx: ToolRunContext,
): Q {
  const maximum = decimal(1e12);
  const unit = div(ONE, scale(p));
  const slopeBound = sum(
    components.map((item) =>
      mul(
        item.a,
        item.bands
          ? item.bands.reduce((highest, band) => max(highest, band.percent), ZERO)
          : item.percent,
      ),
    ),
  );
  if (cmp(mul(slopeBound, add(ONE, vat)), ONE) >= 0)
    fail(
      'desiredNet',
      'Reverse requires combined uncapped fee slope below 100%, including fee VAT.',
    );
  const points: Q[] = [ZERO, maximum];
  const addPoint = (point: Q) => {
    if (cmp(point, ZERO) > 0 && cmp(point, maximum) < 0) points.push(point);
  };
  for (const item of components)
    if (item.a.n)
      for (const band of item.bands ?? [])
        if (band.upperBound) addPoint(div(sub(band.upperBound, item.b), item.a));
  const unique = () =>
    points.sort(cmp).filter((point, i, all) => i === 0 || cmp(point, all[i - 1]!) !== 0);
  let boundaries = unique();
  function affine(item: Fee, x: Q, clamped: boolean): { m: Q; c: Q } {
    const base = add(mul(item.a, x), item.b);
    let r = item.percent;
    let offset = ZERO;
    if (item.bands) {
      let previous = ZERO;
      let prior = ZERO;
      for (const band of item.bands) {
        if (!band.upperBound || cmp(base, band.upperBound) <= 0) {
          r = band.percent;
          offset = item.tierMode === 'whole' ? ZERO : sub(prior, mul(previous, r));
          break;
        }
        prior = add(prior, mul(sub(band.upperBound, previous), band.percent));
        previous = band.upperBound;
      }
    }
    const m = mul(item.a, r);
    const c = add(add(mul(item.b, r), offset), item.fixed);
    const at = add(mul(m, x), c);
    if (clamped && cmp(at, item.minimum) < 0) return { m: ZERO, c: item.minimum };
    if (clamped && item.cap && cmp(at, item.cap) > 0) return { m: ZERO, c: item.cap };
    return { m, c };
  }
  for (let i = 0; i < boundaries.length - 1; i++) {
    const midpoint = div(add(boundaries[i]!, boundaries[i + 1]!), q(2n));
    for (const item of components) {
      const expression = affine(item, midpoint, false);
      if (!expression.m.n) continue;
      for (const clamp of [item.minimum, item.cap])
        if (clamp) {
          const crossing = div(sub(clamp, expression.c), expression.m);
          if (cmp(crossing, boundaries[i]!) > 0 && cmp(crossing, boundaries[i + 1]!) < 0)
            addPoint(crossing);
        }
    }
  }
  boundaries = unique();
  if (boundaries.length > 1001) fail('desiredNet', 'Reverse exceeds 1,000 raw continuous pieces.');
  const envelope = mul(mul(q(BigInt(components.length + 2)), unit), add(ONE, vat));
  const ranges: Array<{ low: bigint; high: bigint }> = [];
  for (const point of boundaries) {
    const units = div(point, unit);
    if (units.d === 1n) ranges.push({ low: units.n, high: units.n });
  }
  for (let i = 0; i < boundaries.length - 1; i++) {
    const lower = boundaries[i]!;
    const upper = boundaries[i + 1]!;
    const midpoint = div(add(lower, upper), q(2n));
    const expressions = components.map((item) => affine(item, midpoint, true));
    const m = sub(ONE, mul(sum(expressions.map((item) => item.m)), add(ONE, vat)));
    const c = sub(sub(receipts, costs), mul(sum(expressions.map((item) => item.c)), add(ONE, vat)));
    if (m.n <= 0n) fail('desiredNet', 'Reverse requires positive raw net slope in every piece.');
    const L = floor(div(lower, unit)) + 1n;
    const H = ceil(div(upper, unit)) - 1n;
    const possible = ceil(div(sub(sub(target, c), envelope), mul(m, unit)));
    const guaranteed = ceil(div(add(sub(target, c), envelope), mul(m, unit)));
    const low = possible > L ? possible : L;
    const high = guaranteed < H ? guaranteed : H;
    if (low <= high) ranges.push({ low, high });
  }
  const candidates = ranges.reduce((n, range) => n + range.high - range.low + 1n, 0n);
  if (candidates > 100000n)
    fail(
      'desiredNet',
      'Reverse exceeds 100,000 candidate increments; this fee model is unsupported for reverse.',
    );
  let best: bigint | undefined;
  for (const range of ranges)
    for (let units = range.low; units <= range.high; units++) {
      check(ctx);
      const amount = mul(q(units), unit);
      const forward = sub(
        sub(add(amount, receipts), feeTotals(amount, components, vat, p).total),
        costs,
      );
      if (cmp(forward, target) >= 0 && (best === undefined || units < best)) best = units;
    }
  if (best === undefined)
    fail('desiredNet', 'Target is unattainable within the supported charge domain.');
  const result = mul(q(best), unit);
  if (
    best > 0n &&
    cmp(
      sub(
        sub(
          add(mul(q(best - 1n), unit), receipts),
          feeTotals(mul(q(best - 1n), unit), components, vat, p).total,
        ),
        costs,
      ),
      target,
    ) >= 0
  )
    fail('desiredNet', 'Reverse minimality verification failed.');
  return result;
}
function order(p: UtilityParams): {
  merchandise: Q;
  receipts: Q;
  tax: Q;
  costs: Record<string, Q>;
  qty: Q;
  rawMerchandise: Q;
} {
  const qty = q(BigInt(count(p, 'quantity', 1)));
  const rawMerchandise = mul(mul(money(p, 'unitPrice'), sub(ONE, rate(p, 'discountPercent'))), qty);
  return {
    merchandise: settled(rawMerchandise, p),
    rawMerchandise,
    receipts: add(money(p, 'customerShipping'), money(p, 'giftWrap')),
    tax: money(p, 'collectedTax'),
    qty,
    costs: {
      product: mul(money(p, 'productCost'), qty),
      shipping: money(p, 'shippingCost'),
      advertising: money(p, 'adCost'),
      other: money(p, 'otherCost'),
    },
  };
}
function base(p: UtilityParams, key: string, o: ReturnType<typeof order>): { a: Q; b: Q } {
  const selected = stringParam(p, key);
  return selected === 'merchandise'
    ? { a: ONE, b: ZERO }
    : { a: ONE, b: selected === 'charge' ? add(o.receipts, o.tax) : o.receipts };
}
function fromBase(
  name: string,
  p: UtilityParams,
  rateKey: string,
  baseKey: string,
  o: ReturnType<typeof order>,
  fixedKey?: string,
  minimumKey?: string,
  capKey?: string,
): Fee {
  const selected = base(p, baseKey, o);
  return fee(name, p, rateKey, fixedKey, selected.a, selected.b, minimumKey, capKey);
}
function orderResult(p: UtilityParams, components: Fee[], o = order(p)): UtilityResult {
  return {
    ...ledger(p, o.merchandise, o.receipts, o.tax, components, o.costs, rate(p, 'feeVAT')),
    rawMerchandise: value(o.rawMerchandise),
    merchandiseRoundingDifference: value(sub(o.merchandise, o.rawMerchandise)),
  };
}
function scheduleFee(
  name: string,
  p: UtilityParams,
  rateKey: string,
  fixedKey: string | undefined,
  b: Q,
  minimumKey?: string,
  capKey?: string,
): Fee {
  const item = fee(
    name,
    { ...p, [rateKey]: p.feeScheduleEnabled ? 0 : p[rateKey] },
    rateKey,
    fixedKey,
    ONE,
    b,
    minimumKey,
    capKey,
  );
  if (p.feeScheduleEnabled) {
    item.bands = bands(p);
    item.tierMode = stringParam(p, 'feeTierMode');
  }
  return item;
}
function split(total: Q, people: number, p: UtilityParams): UtilityResult {
  const units = roundInteger(mul(total, scale(p)));
  const divisor = BigInt(people);
  const low = units / divisor;
  const remainder = Number(units % divisor);
  const amount = (n: bigint) => value(div(q(n), scale(p)));
  const distribution: JsonValue[] = [];
  if (remainder)
    distribution.push({ firstPerson: 1, lastPerson: remainder, amount: amount(low + 1n) });
  if (remainder < people)
    distribution.push({ firstPerson: remainder + 1, lastPerson: people, amount: amount(low) });
  return {
    rawEqualShare: value(div(total, q(divisor))),
    shares:
      people <= 1000
        ? Array.from({ length: people }, (_, i) => amount(low + (i < remainder ? 1n : 0n)))
        : null,
    shareDistribution: distribution,
    shareDescription:
      'Ranges describe every person, including large groups, with exact remainder distribution.',
  };
}
function amortization(p: UtilityParams, ctx: ToolRunContext): UtilityResult {
  const principal = money(p, 'principal');
  if (!principal.n) fail('principal', 'Principal must be positive.');
  const months = count(p, 'months', 1, 1200);
  const apr = numberParam(p, 'APR', { min: 0, max: 100 });
  rate(p, 'APR');
  const monthlyRate = apr / 1200;
  const rawPayment =
    monthlyRate === 0
      ? value(principal) / months
      : (value(principal) * monthlyRate) / -Math.expm1(-months * Math.log1p(monthlyRate));
  const regular = roundInteger(mul(decimal(rawPayment), scale(p)));
  const extra = roundInteger(mul(money(p, 'extraMonthlyPrincipal'), scale(p)));
  let balance = roundInteger(mul(principal, scale(p)));
  let totalInterest = 0n;
  let paid = 0n;
  const schedule: JsonValue[] = [];
  const r = div(decimal(apr), q(1200n));
  for (let month = 1; month <= months && balance > 0n; month++) {
    check(ctx);
    const interest = roundInteger(mul(q(balance), r));
    const owed = balance + interest;
    const planned = regular + extra;
    const payment = month === months || planned > owed ? owed : planned;
    const principalPaid = payment - interest;
    if (principalPaid < 0n) fail('APR', 'Rounded payment cannot cover monthly interest.');
    balance -= principalPaid;
    totalInterest += interest;
    paid += payment;
    if (paid > LIMIT || totalInterest > LIMIT)
      fail('principal', 'Schedule sums exceed safe minor-unit bounds.');
    const amount = (n: bigint) => value(div(q(n), scale(p)));
    schedule.push({
      month,
      payment: amount(payment),
      interest: amount(interest),
      principal: amount(principalPaid),
      balance: amount(balance),
    });
  }
  return {
    principal: value(principal),
    rawPayment,
    scheduledPayment: value(div(q(regular), scale(p))),
    payoffMonths: schedule.length,
    totalInterest: value(div(q(totalInterest), scale(p))),
    totalPaid: value(div(q(paid), scale(p))),
    schedule,
    firstPayment: schedule[0] ?? null,
    lastPayment: schedule.at(-1) ?? null,
  };
}

const paymentCalculation: Calculation = (p, ctx) => {
      const component = fee('Processing', p, 'percent', 'fixed', ONE, ZERO, 'minimum', 'cap');
      component.percent = sum([
        component.percent,
        rate(p, 'additionalRate'),
        ...['internationalRate', 'manualRate', 'conversionRate']
          .filter((key) => Object.hasOwn(p, key))
          .map((key) => rate(p, key)),
      ]);
      const vat = rate(p, 'feeVAT');
      const gross =
        p.mode === 'reverse'
          ? grossUp(p, money(p, 'desiredNet'), ZERO, ZERO, [component], vat, ctx)
          : money(p, 'gross');
      const result = ledger(p, gross, ZERO, ZERO, [component], {}, vat);
      const transactions = q(BigInt(count(p, 'transactionCount', 1)));
      return {
        ...result,
        gross: value(gross),
        net: result.payout!,
        totalCharge: value(mul(gross, transactions)),
        totalNet: value(mul(decimal(result.payout as number), transactions)),
        totalProcessingFees: value(mul(decimal(result.totalFees as number), transactions)),
        transactionCount: Number(transactions.n),
        ...(p.mode === 'reverse'
          ? {
              targetNet: value(money(p, 'desiredNet')),
              reverseTaxAssumption: 'No pass-through tax; target is per transaction.',
            }
          : {}),
      };
    };

function marketplaceCalculation(
  components: (p: UtilityParams, o: ReturnType<typeof order>) => Fee[],
  costs?: (p: UtilityParams, o: ReturnType<typeof order>) => void,
): Calculation {
  return (p) => {
      const o = order(p);
      costs?.(p, o);
      return orderResult(p, components(p, o), o);
    };
}

const calculations: Record<string, Calculation> = {
  'tip-calculator': (p) => {
    const bill = money(p, 'bill');
    const tax = money(p, 'taxAmount');
    if (cmp(tax, bill) > 0) fail('taxAmount', 'Tax cannot exceed the bill.');
    const tipBase = p.billIncludesTax ? bill : sub(bill, tax);
    const rawTip = mul(tipBase, rate(p, 'tipPercent'));
    const tip = settled(rawTip, p);
    const total = add(bill, tip);
    return {
      tipBase: value(tipBase),
      rawTip: value(rawTip),
      tip: value(tip),
      total: value(total),
      ...split(total, count(p, 'people', 1), p),
    };
  },
  'discount-calculator': (p) => {
    const original = money(p, 'originalPrice');
    let rawSale: Q;
    if (p.mode === 'find-percent') {
      rawSale = money(p, 'salePrice');
      if (cmp(rawSale, original) > 0)
        fail('salePrice', 'Sale price must not exceed original price.');
    } else
      rawSale = rowList(p, 'discountRatesJson', ['percent'], 100).reduce<Q>(
        (price, row, i) => mul(price, sub(ONE, rowRate(row, 'percent', i))),
        original,
      );
    const sale = settled(rawSale, p);
    return {
      originalPrice: value(original),
      rawSalePrice: value(rawSale),
      salePrice: value(sale),
      saved: value(sub(original, sale)),
      discountPercent: original.n
        ? value(mul(HUNDRED, div(sub(original, rawSale), original)))
        : null,
    };
  },
  'sales-tax-calculator': (p) => {
    const amount = money(p, 'amount');
    const r = rate(p, 'rate');
    const rawSubtotal = p.mode === 'reverse' ? div(amount, add(ONE, r)) : amount;
    const subtotal = settled(rawSubtotal, p);
    const total = p.mode === 'reverse' ? amount : add(subtotal, settled(mul(subtotal, r), p));
    return {
      rawSubtotal: value(rawSubtotal),
      subtotal: value(subtotal),
      tax: value(sub(total, subtotal)),
      total: value(total),
      limitations: ['No jurisdiction selection or tax determination.'],
    };
  },
  'loan-calculator': amortization,
  'mortgage-calculator': (p, ctx) => {
    const price = money(p, 'price');
    const down = money(p, 'downPayment');
    if (cmp(down, price) >= 0) fail('downPayment', 'Down payment must leave a positive principal.');
    const result = amortization(
      { ...p, principal: value(sub(price, down)), months: count(p, 'years', 1, 100) * 12 },
      ctx,
    );
    const rawTax = div(money(p, 'annualPropertyTax'), q(12n));
    const rawInsurance = div(money(p, 'annualInsurance'), q(12n));
    const extras = sum([
      settled(rawTax, p),
      settled(rawInsurance, p),
      money(p, 'monthlyHOA'),
      money(p, 'monthlyPMI'),
    ]);
    const otherHousing = mul(extras, decimal(result.payoffMonths as number));
    const housingCash = add(decimal(result.totalPaid as number), otherHousing);
    return {
      ...result,
      downPayment: value(down),
      monthlyExtras: value(extras),
      rawMonthlyPropertyTax: value(rawTax),
      rawMonthlyInsurance: value(rawInsurance),
      monthlyHousing: value(add(decimal(result.scheduledPayment as number), extras)),
      otherHousingPaid: value(otherHousing),
      housingCashPaid: value(housingCash),
      allCashIncludingDownPayment: value(add(housingCash, down)),
      limitations: [
        'No automatic PMI cancellation, escrow changes, variable rates or lifelong housing cost forecast.',
        'Monthly annual-cost allocations are rounded estimates; repeated months need not reconcile to the entered annual total.',
      ],
    };
  },
  'paypal-fee-calculator': paymentCalculation,
  'stripe-fee-calculator': paymentCalculation,
  'square-fee-calculator': paymentCalculation,
  'amazon-fba-profit-calculator': (p) => {
    const o = order(p);
    o.costs.inbound = mul(money(p, 'inboundPerUnit'), o.qty);
    o.costs.sellingPlan = mul(money(p, 'sellingPlanPerUnit'), o.qty);
    const referral = scheduleFee(
      'Referral',
      p,
      'referralRate',
      undefined,
      o.receipts,
      'referralMinimum',
      'referralCap',
    );
    const flat = (name: string, key: string): Fee => ({
      name,
      a: ZERO,
      b: ZERO,
      percent: ZERO,
      fixed: mul(money(p, key), o.qty),
      minimum: ZERO,
    });
    return {
      ...orderResult(
        p,
        [referral, flat('Fulfillment', 'fulfillmentFee'), flat('Storage', 'storagePerUnit')],
        o,
      ),
      limitations: [
        'FBA fulfillment/storage inputs are your quote; no inferred weight/category/plan schedule.',
        'Inbound and selling-plan allocation are seller investment, excluded from platform fees and payout.',
      ],
    };
  },
  'etsy-fee-profit-calculator': (p, ctx) => {
    const o = order(p);
    const components = [
      fromBase('Transaction', p, 'transactionRate', 'transactionBase', o),
      fee('Payment', p, 'paymentRate', 'paymentFixed', ONE, add(o.receipts, o.tax)),
      fromBase(
        'Offsite advertising',
        p,
        'offsiteAdRate',
        'offsiteBase',
        o,
        undefined,
        undefined,
        'offsiteCap',
      ),
      fee('Regulatory', p, 'regulatoryRate', undefined, ONE, o.receipts),
      {
        name: 'Listing',
        a: ZERO,
        b: ZERO,
        percent: ZERO,
        fixed: mul(money(p, 'listingFeePerUnit'), o.qty),
        minimum: ZERO,
      },
    ];
    const regular = orderResult(p, components, o);
    if (!p.reverseEnabled) return regular;
    const candidate = grossUp(
      p,
      money(p, 'desiredNet'),
      o.receipts,
      sum(Object.values(o.costs).map((cost) => settled(cost, p))),
      components,
      rate(p, 'feeVAT'),
      ctx,
    );
    return {
      ...regular,
      breakEvenMerchandiseCharge: value(candidate),
      reverseResult: ledger(
        p,
        candidate,
        o.receipts,
        o.tax,
        components,
        o.costs,
        rate(p, 'feeVAT'),
      ),
      reverseAssumption:
        'Find actual postdiscount merchandise charge; fixed entered shipping, gift wrap, tax and seller costs. Tax is held fixed.',
    };
  },
  'ebay-fee-profit-calculator': (p) => {
    const o = order(p);
    const selected = base(p, 'finalValueBase', o);
    const main = scheduleFee(
      'Final value',
      p,
      'finalValuePercent',
      'perOrderFixed',
      selected.b,
      'finalValueMinimum',
      'finalValueCap',
    );
    return orderResult(
      p,
      [
        main,
        fromBase('Promoted listing', p, 'promotedListingRate', 'promotedBase', o),
        {
          name: 'Insertion',
          a: ZERO,
          b: ZERO,
          percent: ZERO,
          fixed: money(p, 'insertionFee'),
          minimum: ZERO,
        },
      ],
      o,
    );
  },
  'fuel-trip-cost-calculator': (p) => {
    const imperial = p.mode === 'imperial';
    const distance = numberParam(p, imperial ? 'distanceMiles' : 'distanceKm');
    const consumed = imperial
      ? distance / numberParam(p, 'mpg', { min: 0.000001 })
      : (distance * numberParam(p, 'LPer100Km')) / 100;
    const rawCost = decimal(
      consumed * numberParam(p, imperial ? 'pricePerGallon' : 'pricePerLiter'),
    );
    const cost = settled(rawCost, p);
    let purchases: number | null = null;
    if (p.tankEnabled) {
      const capacity = numberParam(p, 'tankCapacity', { min: 0.000001 });
      const starting = numberParam(p, 'startingFuel');
      if (starting > capacity) fail('startingFuel', 'Starting fuel cannot exceed capacity.');
      purchases = Math.ceil(Math.max(0, consumed - starting) / capacity);
      if (!Number.isSafeInteger(purchases)) fail('tankCapacity', 'Purchase count overflow.');
    }
    return {
      consumedFuel: consumed,
      fuelUnit: imperial ? 'US gallons' : 'liters',
      rawCost: value(rawCost),
      cost: value(cost),
      purchaseCount: purchases,
      ...split(cost, count(p, 'travelers', 1), p),
      limitations: [
        p.tankEnabled
          ? 'Purchase count is a fuel quantity estimate, not a route or stop-location guarantee.'
          : 'Tank capacity not supplied.',
      ],
    };
  },
  'airbnb-host-payout-calculator': (p) => {
    const rawLodging = mul(
      mul(money(p, 'nightlyPrice'), q(BigInt(count(p, 'nights', 1)))),
      sub(ONE, rate(p, 'discountRate')),
    );
    const lodging = settled(rawLodging, p);
    const receipts = add(money(p, 'cleaningFee'), money(p, 'otherHostFees'));
    const tax = money(p, 'collectedTax');
    const result = ledger(
      p,
      lodging,
      receipts,
      tax,
      [fee('Host service', p, 'hostServiceRate', undefined, ONE, receipts)],
      { cleaning: money(p, 'cleaningCost'), operating: money(p, 'operatingCost') },
      rate(p, 'feeVAT'),
    );
    const payout = decimal(result.payout as number);
    return {
      ...result,
      rawDiscountedLodging: value(rawLodging),
      discountedLodging: value(lodging),
      earningsPayout: value(payout),
      cashReceived: value(add(payout, p.taxRemittedByPlatform ? ZERO : tax)),
      taxObligation: p.taxRemittedByPlatform ? 0 : value(tax),
      limitations: [
        'Only lodging is discounted. Host fees are undiscounted; guest taxes and guest-service fees are excluded from the host fee base.',
      ],
    };
  },
  'shopify-profit-margin-calculator': (p) => {
    const o = order(p);
    o.costs.monthlyAllocated = div(
      add(money(p, 'monthlyPlanCost'), money(p, 'monthlyAppCost')),
      q(BigInt(count(p, 'monthlyOrders', 1))),
    );
    return {
      ...orderResult(
        p,
        [
          fee('Payment', p, 'paymentRate', 'paymentFixed', ONE, add(o.receipts, o.tax)),
          fee('Additional transaction', p, 'additionalTransactionRate', undefined, ONE, o.receipts),
        ],
        o,
      ),
      limitations: [
        'Monthly per-order allocation is an estimate rounded once; repeated allocations need not reconcile to the account total.',
      ],
    };
  },
  'ev-charging-cost-calculator': (p) => {
    const start = numberParam(p, 'startPercent');
    const end = numberParam(p, 'endPercent');
    if (end < start) fail('endPercent', 'Ending charge cannot be below starting charge.');
    const efficiency = numberParam(p, 'efficiencyPercent', { min: 0.000001, max: 100 }) / 100;
    const battery = (numberParam(p, 'batteryKWh') * (end - start)) / 100;
    const grid = battery / efficiency;
    const wallConsumption = numberParam(p, 'batteryConsumptionKWhPer100Miles') / efficiency;
    const electricity = numberParam(p, 'electricityRate');
    const monthlyGrid = (numberParam(p, 'monthlyMiles') * wallConsumption) / 100;
    return {
      addedBatteryEnergyKWh: battery,
      gridEnergyKWh: grid,
      wallConsumptionKWhPer100Miles: wallConsumption,
      costPerMile: (wallConsumption * electricity) / 100,
      rawSessionCost: grid * electricity + value(money(p, 'fixedSessionFee')),
      sessionCost: value(settled(add(decimal(grid * electricity), money(p, 'fixedSessionFee')), p)),
      monthlyGridKWh: monthlyGrid,
      monthlyCost: value(settled(decimal(monthlyGrid * electricity), p)),
      limitations: [
        'Consumption input is battery energy before charging losses, not wall-meter consumption.',
        'Monthly estimate excludes per-session charges because session count is not supplied.',
      ],
    };
  },
  'youtube-rpm-calculator': (p) => {
    const views = count(p, 'views', 0, 1e12);
    if (p.mode === 'rpm' && views === 0) fail('views', 'Positive views required to recover RPM.');
    const raw =
      p.mode === 'rpm'
        ? money(p, 'actualRevenue')
        : div(mul(decimal(views), money(p, 'RPM')), q(1000n));
    return {
      views,
      rawRevenue: value(raw),
      revenue: value(settled(raw, p)),
      RPM: p.mode === 'rpm' ? (1000 * value(raw)) / views : value(money(p, 'RPM')),
      limitations: [
        'RPM is after creator revenue share; no second share deduction.',
        'Use the chosen eligible Shorts or long-form view denominator; these counts are not automatically interchangeable.',
      ],
    };
  },
  'patreon-earnings-calculator': (p, ctx) => {
    const tiers = rowList(p, 'tiersJson', [
      'name',
      'members',
      'monthlyPrice',
      'failedMembers',
      'taxPerMember',
      'paymentPercent',
      'paymentFixed',
    ]);
    let members = 0;
    let gross = ZERO;
    let tax = ZERO;
    let processing = ZERO;
    const details = tiers.map((row, i) => {
      check(ctx);
      const total = rowNumber(row, 'members', i, 0, 1e6, true);
      const failed = rowNumber(row, 'failedMembers', i, 0, 1e6, true, 0);
      if (failed > total) fail('failedMembers', `Row ${i + 1}: failed members exceed members.`);
      members += total - failed;
      if (members > 1e6) fail('tiersJson', 'Total successful members exceed 1,000,000.');
      const price = rowMoney(row, 'monthlyPrice', i, p);
      const memberTax = rowMoney(row, 'taxPerMember', i, p, 0);
      const overrides = Object.hasOwn(row, 'paymentPercent') || Object.hasOwn(row, 'paymentFixed');
      const r = overrides ? rowRate(row, 'paymentPercent', i) : rate(p, 'paymentRate');
      const fixed = overrides ? rowMoney(row, 'paymentFixed', i, p) : money(p, 'paymentFixed');
      const success = q(BigInt(total - failed));
      const paymentPerMember = settled(add(mul(add(price, memberTax), r), fixed), p);
      gross = add(gross, mul(price, success));
      tax = add(tax, mul(memberTax, success));
      processing = add(processing, mul(paymentPerMember, success));
      return {
        name: typeof row.name === 'string' ? row.name : `Tier ${i + 1}`,
        successfulMembers: total - failed,
        failedMembers: failed,
        revenue: value(mul(price, success)),
        collectedTax: value(mul(memberTax, success)),
        processingFees: value(mul(paymentPerMember, success)),
      };
    });
    const components: Fee[] = [
      fee('Platform', p, 'platformRate', undefined, ONE),
      fee('Conversion', p, 'conversionRate'),
      {
        name: 'Per-member payment processing',
        a: ZERO,
        b: ZERO,
        percent: ZERO,
        fixed: processing,
        minimum: ZERO,
      },
      {
        name: 'Other fees',
        a: ZERO,
        b: ZERO,
        percent: ZERO,
        fixed: money(p, 'otherFees'),
        minimum: ZERO,
      },
    ];
    return {
      ...ledger(p, gross, ZERO, tax, components, { expenses: money(p, 'expenses') }),
      successfulMembers: members,
      tiers: details,
      limitations: [
        'Failed members are assigned to their own tier; buyer tax is not creator earnings.',
        'Processing fixed fees are charged once per successful member, not once for the month.',
      ],
    };
  },
  'fiverr-fee-calculator': (p) =>
    ledger(
      p,
      add(money(p, 'projectPrice'), money(p, 'extras')),
      ZERO,
      ZERO,
      [fee('Seller fee', p, 'sellerFeeRate')],
      { expenses: money(p, 'sellerExpenses'), withdrawal: money(p, 'withdrawalCost') },
    ),
  'upwork-fee-calculator': (p, ctx) => {
    const component = fee('Freelancer fee', p, 'freelancerRate');
    const hours = p.mode === 'project' ? ONE : decimal(numberParam(p, 'hours', { min: 0.000001 }));
    const hourly =
      p.mode === 'gross-up'
        ? grossUp(p, money(p, 'desiredNet'), ZERO, ZERO, [component], ZERO, ctx)
        : money(p, 'amount');
    const gross = settled(mul(hourly, hours), p);
    const result = ledger(p, gross, ZERO, ZERO, [component], { expenses: money(p, 'expenses') });
    return {
      ...result,
      grossHourly: p.mode === 'project' ? null : value(hourly),
      netHourly: p.mode === 'project' ? null : value(div(decimal(result.payout as number), hours)),
      limitations: [
        'Fee is the entered actual contract rate. Hourly gross-up targets pay before separate project expenses.',
      ],
    };
  },
  'kdp-royalty-calculator': (p) => {
    const price = money(p, 'price');
    const taxExclusive = p.priceIncludesVAT ? div(price, add(ONE, rate(p, 'userVATrate'))) : price;
    const mode = stringParam(p, 'mode');
    const eligible = mode === 'ebook70' && p.eligibilityConfirmed === true;
    let royalty: Q;
    let applied = ZERO;
    let effectiveMode = mode;
    if (mode === 'ebook35' || mode === 'ebook70') {
      if (eligible) {
        applied = money(p, 'deliveryCost');
        royalty = mul(sub(taxExclusive, applied), decimal(0.7));
      } else {
        royalty = mul(taxExclusive, decimal(0.35));
        effectiveMode = 'ebook35';
      }
    } else {
      const r =
        mode === 'print'
          ? rate(p, cmp(price, money(p, 'threshold')) >= 0 ? 'highPercent' : 'lowPercent')
          : rate(p, 'userRate');
      royalty = sub(mul(taxExclusive, r), money(p, 'printingCost'));
    }
    const perCopy = settled(royalty, p);
    return {
      taxExclusivePrice: value(taxExclusive),
      rawRoyaltyPerCopy: value(royalty),
      royaltyPerCopy: value(perCopy),
      totalRoyalty: value(mul(perCopy, q(BigInt(count(p, 'units', 1))))),
      effectiveMode,
      eligibilityStatus:
        mode === 'ebook70' ? (eligible ? 'confirmed' : 'fallback') : 'not applicable',
      deliveryApplied: value(applied),
      deliveryStatus: eligible
        ? 'Deducted before the 70% share.'
        : 'Not applied at 35% or in print modes.',
      status: royalty.n < 0n ? 'Estimated loss from entered costs.' : 'Estimate',
      limitations: [
        'Print thresholds and percentages are entered assumptions, not marketplace presets.',
        'Eligibility confirmation is user supplied, not automatic book/sale validation.',
      ],
    };
  },
  'tiktok-shop-fee-calculator': marketplaceCalculation((p, o) => [
    fromBase('Referral', p, 'referralRate', 'referralBase', o),
    fromBase('Affiliate', p, 'affiliateRate', 'affiliateBase', o),
  ], (p, o) => {
    o.costs.fulfillment = money(p, 'fulfillmentCost');
    o.costs.returnAllowance = money(p, 'returnAllowance');
  }),
  'poshmark-fee-calculator': (p) => {
    const price = money(p, 'salePrice');
    const relation = cmp(price, money(p, 'threshold'));
    const lower = relation < 0 || (relation === 0 && p.lowerTierIncludesThreshold);
    const raw = lower ? money(p, 'fixedLowerTier') : mul(price, rate(p, 'percentUpperTier'));
    return {
      ...ledger(
        p,
        price,
        ZERO,
        ZERO,
        [
          {
            name: lower ? 'Lower fixed tier' : 'Upper whole-price tier',
            a: ZERO,
            b: price,
            percent: ZERO,
            fixed: raw,
            minimum: ZERO,
          },
        ],
        { product: money(p, 'productCost'), shippingDiscount: money(p, 'shippingDiscount') },
      ),
      selectedTier: lower ? 'lower' : 'upper',
    };
  },
  'depop-fee-calculator': marketplaceCalculation((p, o) => [
    fromBase('Platform', p, 'platformRate', 'platformBase', o),
    fromBase('Payment', p, 'paymentRate', 'paymentBase', o, 'paymentFixed'),
    fromBase('Boosted listing', p, 'boostedRate', 'boostedBase', o),
  ]),
  'mercari-profit-calculator': marketplaceCalculation((p, o) => [
    fromBase('Seller fee', p, 'sellerRate', 'sellerBase', o),
    fromBase('Payment', p, 'paymentRate', 'paymentBase', o, 'paymentFixed'),
  ]),
  'stockx-seller-fee-calculator': marketplaceCalculation((p, o) => [
    fee('Transaction', p, 'transactionRate', 'levelFixed'),
    fromBase('Payment', p, 'paymentRate', 'paymentBase', o),
  ]),
  'shopify-break-even-roas-calculator': (p) => {
    const revenue = money(p, 'AOV');
    const costs = sum(
      [
        'productCost',
        'shippingCost',
        'fulfillmentCost',
        'paymentCost',
        'returnAllowance',
        'allocatedOverhead',
      ].map((key) => money(p, key)),
    );
    const contribution = sub(revenue, costs);
    const allowable = sub(contribution, mul(revenue, rate(p, 'targetProfitPercent')));
    return {
      revenue: value(revenue),
      nonAdCosts: value(costs),
      contribution: value(contribution),
      allowableAds: value(allowable),
      breakEvenROAS: contribution.n > 0n ? value(div(revenue, contribution)) : null,
      targetROAS: allowable.n > 0n ? value(div(revenue, allowable)) : null,
      status:
        allowable.n > 0n
          ? 'Estimated attainable target'
          : 'Unattainable: allowable ad spending is nonpositive',
      limitations: [
        'ROAS uses revenue divided by advertising cost; this is a cost scenario, not a conversion or sales forecast.',
      ],
    };
  },
  'twitch-subscription-revenue-calculator': (p, ctx) => {
    let totalCount = 0;
    const detail = rowList(p, 'tiersJson', [
      'name',
      'subscriberCount',
      'netSubscriptionPrice',
      'creatorSharePercent',
    ]).map((row, i) => {
      check(ctx);
      const n = rowNumber(row, 'subscriberCount', i, 0, 1e6, true);
      totalCount += n;
      const raw = mul(
        mul(rowMoney(row, 'netSubscriptionPrice', i, p), q(BigInt(n))),
        rowRate(row, 'creatorSharePercent', i),
      );
      return {
        name: typeof row.name === 'string' ? row.name : `Tier ${i + 1}`,
        count: n,
        rawPayout: value(raw),
        payout: value(settled(raw, p)),
      };
    });
    const prime = rowList(
      p,
      'primeJson',
      ['name', 'count', 'payoutPerSubscription'],
      1000,
      true,
    ).map((row, i) => {
      const n = rowNumber(row, 'count', i, 0, 1e6, true);
      totalCount += n;
      return {
        name: typeof row.name === 'string' ? row.name : `Prime ${i + 1}`,
        count: n,
        payout: value(mul(rowMoney(row, 'payoutPerSubscription', i, p), q(BigInt(n)))),
      };
    });
    if (totalCount > 1e6) fail('tiersJson', 'Total subscriptions exceed 1,000,000.');
    const gross = sum([...detail, ...prime].map((row) => decimal(row.payout)));
    const payout = sub(gross, money(p, 'otherDeduction'));
    return {
      tiers: detail,
      prime,
      grossPayout: value(gross),
      payout: value(payout),
      profit: value(sub(payout, money(p, 'expenses'))),
      limitations: [
        'Prices are the net shared basis, not inferred retail prices. Prime payout is user supplied.',
      ],
    };
  },
  'twitch-bits-to-usd-converter': (p) => {
    const bitsCount = count(p, 'bits', 0, 1e12);
    const creator = div(q(BigInt(bitsCount)), HUNDRED);
    let viewer: JsonValue = null;
    if (p.viewerBundleEnabled) {
      const viewerCurrency = stringParam(p, 'viewerCurrency');
      if (!/^[A-Z]{3}$/.test(viewerCurrency))
        fail('viewerCurrency', 'Enter uppercase three-letter viewer currency.');
      const vp = { ...p, currencyDecimals: count(p, 'viewerCurrencyDecimals', 0, 3) };
      const raw = div(
        mul(money(vp, 'viewerBundlePrice'), q(BigInt(bitsCount))),
        q(BigInt(count(p, 'viewerBundleBits', 1, 1e12))),
      );
      viewer = {
        rawCost: value(raw),
        estimatedCost: value(settled(raw, vp)),
        currency: viewerCurrency,
        currencyDecimals: digits(vp),
      };
    }
    return {
      bits: bitsCount,
      creatorRevenueUSD: value(creator),
      viewerCost: viewer,
      limitations: [
        'Standard eligible chat-Cheer payout is one US cent per Bit. Extensions, payout thresholds and taxes are outside scope.',
        'Viewer cost is a proportional estimate, not a purchasable bundle quote; no subtraction across viewer and creator currencies.',
      ],
    };
  },
  'gumroad-fee-calculator': (p) => {
    const tax = money(p, 'collectedTax');
    const components = [fee('Channel', p, 'channelRate', 'fixed')];
    if (!p.paymentIncluded)
      components.push(
        fee('Outside processing', p, 'separatePaymentRate', 'separatePaymentFixed', ONE, tax),
      );
    const result = ledger(p, money(p, 'gross'), ZERO, tax, components, {
      product: money(p, 'digitalProductCost'),
    });
    return {
      ...result,
      net: result.payout!,
      limitations: [
        'Channel is a label only. Do not add separate processing when already included in your channel fee.',
      ],
    };
  },
  'kickstarter-fee-calculator': (p): UtilityResult => {
    const pledged = money(p, 'pledgedAmount');
    const goal = money(p, 'campaignGoal');
    if (!goal.n) fail('campaignGoal', 'Goal must be positive.');
    if (!p.successConfirmed || cmp(pledged, goal) < 0)
      return {
        fundingStatus: p.successConfirmed ? 'notfunded' : 'notreceived',
        pledgedAmount: value(pledged),
        collected: 0,
        totalFees: 0,
        proceeds: 0,
        limitations: [
          'Pledged amount is informational until successful funding is explicitly confirmed and goal is met.',
        ],
      };
    const rawCollected = mul(pledged, sub(ONE, rate(p, 'failedPledgeRate')));
    const collected = settled(rawCollected, p);
    const n = count(p, 'successfulPledgeCount');
    if (Boolean(collected.n) !== Boolean(n))
      fail(
        'successfulPledgeCount',
        'Zero collected amount requires zero successful pledges; positive collection requires a positive count.',
      );
    const processing = fee('Processing', p, 'processingRate');
    processing.fixed = mul(money(p, 'processingFixed'), q(BigInt(n)));
    const result = ledger(
      p,
      collected,
      ZERO,
      ZERO,
      [fee('Platform', p, 'platformRate'), processing],
      { fulfillment: money(p, 'fulfillmentCost'), campaign: money(p, 'campaignCost') },
    );
    return {
      ...result,
      fundingStatus: 'received',
      pledgedAmount: value(pledged),
      rawCollected: value(rawCollected),
      collected: value(collected),
      successfulPledgeCount: n,
      proceeds: result.payout!,
      limitations: [
        'Failed collections after a confirmed funded campaign do not retroactively undo funding success.',
        'Processing uses aggregate collected percentage plus fixed fees for the exact entered successful count, not an inferred average pledge.',
      ],
    };
  },
  'printify-profit-calculator': (p) => {
    const qty = q(BigInt(count(p, 'quantity', 1)));
    const raw = mul(mul(money(p, 'unitPrice'), sub(ONE, rate(p, 'discountPercent'))), qty);
    const receipts = money(p, 'customerShipping');
    return {
      ...ledger(
        p,
        settled(raw, p),
        receipts,
        money(p, 'collectedTax'),
        [fee('Storefront', p, 'storefrontPercent', 'storefrontFixed', ONE, receipts)],
        {
          production: mul(money(p, 'productionCost'), qty),
          shipping: money(p, 'productionShipping'),
          advertising: money(p, 'adCost'),
        },
      ),
      rawMerchandise: value(raw),
      limitations: [
        'Discount applies to unit merchandise before quantity; customer shipping is undiscounted.',
        'Production inputs come from your actual quote; no catalog pricing inference.',
      ],
    };
  },
  'redbubble-profit-calculator': (p, ctx) => {
    const exempt = p.accountTier === 'Pro';
    let units = 0;
    const detail = rowList(p, 'itemsJson', [
      'name',
      'basePriceAfterDiscount',
      'markupPercent',
      'quantity',
    ]).map((row, i) => {
      check(ctx);
      const basePrice = rowMoney(row, 'basePriceAfterDiscount', i, p);
      const markup = rowRate(row, 'markupPercent', i, 1000);
      const quantity = rowNumber(row, 'quantity', i, 0, 1e6, true);
      units += quantity;
      if (units > 1e6) fail('itemsJson', 'New-sale quantity total exceeds 1,000,000.');
      const gross = mul(mul(basePrice, markup), q(BigInt(quantity)));
      const excess = exempt
        ? null
        : mul(
            mul(basePrice, max(ZERO, sub(markup, rate(p, 'excessMarkupThreshold', 1000)))),
            q(BigInt(quantity)),
          );
      return {
        name: typeof row.name === 'string' ? row.name : `Item ${i + 1}`,
        quantity,
        retailPerUnit: value(add(basePrice, mul(basePrice, markup))),
        gross,
        excess,
      };
    });
    const rawGross = sum(detail.map((item) => item.gross));
    const grossNew = settled(rawGross, p);
    const rawExcess = exempt ? null : sum(detail.map((item) => item.excess!));
    const excessNew = rawExcess ? settled(rawExcess, p) : null;
    const includedGross = money(p, 'currentPeriodIncludedGrossEarnings');
    const includedExcess = money(p, 'currentPeriodIncludedExcessEarnings');
    if (cmp(includedExcess, includedGross) > 0)
      fail(
        'currentPeriodIncludedExcessEarnings',
        'Included excess cannot exceed included gross artist earnings.',
      );
    const periodFee = (g: Q, e: Q): Q =>
      exempt
        ? ZERO
        : settled(
            min(
              min(
                money(p, 'periodCap'),
                add(
                  settled(mul(g, rate(p, 'platformFeeRate')), p),
                  settled(mul(e, rate(p, 'excessRate')), p),
                ),
              ),
              g,
            ),
            p,
          );
    const before = periodFee(includedGross, includedExcess);
    const combinedGross = add(includedGross, grossNew);
    const combinedExcess = exempt ? null : add(includedExcess, excessNew!);
    const after = periodFee(combinedGross, combinedExcess ?? ZERO);
    const incremental = max(ZERO, sub(after, before));
    const feeUnits = roundInteger(mul(incremental, scale(p)));
    const allocations = detail.map((item, index) => {
      const weighted = rawGross.n ? mul(q(feeUnits), div(item.gross, rawGross)) : ZERO;
      return { index, units: floor(weighted), remainder: sub(weighted, q(floor(weighted))) };
    });
    const missing = feeUnits - allocations.reduce((n, item) => n + item.units, 0n);
    const ordered = [...allocations].sort(
      (a, b) => cmp(b.remainder, a.remainder) || a.index - b.index,
    );
    for (let i = 0; i < Number(missing); i++) ordered[i]!.units++;
    return {
      currentPeriodIncludedGrossEarnings: value(includedGross),
      currentPeriodIncludedExcessEarnings: exempt ? null : value(includedExcess),
      rawNewGrossEarnings: value(rawGross),
      newGrossEarnings: value(grossNew),
      newExcessEarnings: excessNew ? value(excessNew) : null,
      combinedGrossEarnings: value(combinedGross),
      combinedExcessEarnings: combinedExcess ? value(combinedExcess) : null,
      periodFeeBefore: value(before),
      periodFeeAfter: value(after),
      incrementalFee: value(incremental),
      netNewArtistEarnings: value(sub(grossNew, incremental)),
      feeStatus: exempt
        ? 'Both fees ignored for exempt Pro tier.'
        : 'Incremental current-period entered-rate estimate',
      items: detail.map((item, i) => ({
        name: item.name,
        quantity: item.quantity,
        retailPerUnit: item.retailPerUnit,
        rawArtistEarnings: value(item.gross),
        feeAllocation: value(div(q(allocations[i]!.units), scale(p))),
      })),
      limitations: [
        'Current fee period: exclude earnings from earlier periods; reset included balances to zero for each new period.',
        'Standard and Premium are labels for entered-rate math, not automatically selected schedules.',
        'No refunds, credits, mid-period rate changes, stored period history or actual settlement reconciliation.',
      ],
    };
  },
  'teespring-profit-calculator': (p) => {
    const qty = q(BigInt(count(p, 'quantity', 1)));
    const raw = mul(mul(money(p, 'productPrice'), sub(ONE, rate(p, 'discountRate'))), qty);
    return {
      ...ledger(p, settled(raw, p), ZERO, ZERO, [], {
        production: mul(money(p, 'baseCost'), qty),
        shipping: money(p, 'sellerShippingSupport'),
        other: money(p, 'otherCost'),
      }),
      rawRevenue: value(raw),
      limitations: ['Entered base cost includes your Spring fees; no extra inferred commission.'],
    };
  },
  'amazon-handmade-fee-calculator': marketplaceCalculation((p, o) => [fee('Referral', p, 'referralRate', undefined, ONE, o.receipts, 'referralMinimum')], (p, o) => {
    o.costs.planAllocation = money(p, 'sellingPlanAllocation');
  }),
  'grailed-fee-calculator': marketplaceCalculation((p, o) => [
    fromBase('Commission', p, 'commissionRate', 'commissionBase', o),
    fromBase('Payment', p, 'paymentRate', 'paymentBase', o, 'paymentFixed'),
  ]),
  'reverb-fee-calculator': marketplaceCalculation((p, o) => [
    fee('Selling', p, 'sellingRate', undefined, ONE, o.receipts, 'sellingMinimum', 'sellingCap'),
    fee('Payment', p, 'paymentRate', 'paymentFixed', ONE, add(o.receipts, o.tax)),
    fee('Bump', p, 'bumpRate', undefined, ONE, o.receipts),
  ], (p, o) => {
    o.costs.protection = money(p, 'protectionCost');
  }),
  'discogs-fee-calculator': marketplaceCalculation((p, o) => [
    fee(
      'Marketplace',
      p,
      'marketplaceRate',
      undefined,
      ONE,
      o.receipts,
      'marketplaceMinimum',
      'marketplaceCap',
    ),
    fee('Payment', p, 'paymentRate', 'paymentFixed', ONE, add(o.receipts, o.tax)),
  ]),
  'whatnot-seller-fee-calculator': marketplaceCalculation((p, o) => [
    fromBase('Commission', p, 'commissionRate', 'commissionBase', o),
    fee('Payment', p, 'paymentRate', 'paymentFixed', ONE, add(o.receipts, o.tax)),
  ], (p, o) => {
    o.costs.giveaway = money(p, 'giveawayCost');
  }),
  'ko-fi-fee-calculator': (p) => {
    const revenue = money(p, 'grossPerPayment');
    const tax = money(p, 'taxPerPayment');
    const n = q(BigInt(count(p, 'paymentCount', 1)));
    const platformPer = settled(mul(revenue, rate(p, 'platformRate')), p);
    const processingPer = settled(
      add(mul(add(revenue, tax), rate(p, 'processorRate')), money(p, 'processorFixed')),
      p,
    );
    const allocationRaw = div(
      money(p, 'accountCost'),
      q(BigInt(count(p, 'monthlyTransactions', 1))),
    );
    const costs: Record<string, Q> = { account: mul(settled(allocationRaw, p), n) };
    if (p.revenueType === 'shop') {
      costs.product = mul(money(p, 'productCostPerPayment'), n);
      costs.fulfillment = mul(money(p, 'fulfillmentPerPayment'), n);
    }
    const components: Fee[] = [
      {
        name: 'Platform over payments',
        a: ZERO,
        b: ZERO,
        percent: ZERO,
        fixed: mul(platformPer, n),
        minimum: ZERO,
      },
      {
        name: 'Processing over payments',
        a: ZERO,
        b: ZERO,
        percent: ZERO,
        fixed: mul(processingPer, n),
        minimum: ZERO,
      },
    ];
    const result = ledger(p, mul(revenue, n), ZERO, mul(tax, n), components, costs);
    return {
      ...result,
      net: result.payout!,
      rawAccountAllocationPerPayment: value(allocationRaw),
      accountAllocationPerPayment: value(settled(allocationRaw, p)),
      limitations: [
        'Revenue type is a label, not a preset rate. Each payment gets one fixed processing charge.',
        'Account allocation is a rounded per-payment estimate, not exact month reconciliation.',
      ],
    };
  },
  'fourthwall-profit-calculator': (p) => {
    const qty = q(BigInt(count(p, 'quantity', 1)));
    const raw = mul(mul(money(p, 'productPrice'), sub(ONE, rate(p, 'discountPercent'))), qty);
    const receipts = money(p, 'customerShipping');
    const tax = money(p, 'collectedTax');
    const components = [fee('Platform', p, 'platformRate', undefined, ONE, receipts)];
    if (!p.processingFeeIncluded)
      components.push(
        fee('Outside processing', p, 'paymentRate', 'paymentFixed', ONE, add(receipts, tax)),
      );
    return {
      ...ledger(p, settled(raw, p), receipts, tax, components, {
        product: mul(money(p, 'productCost'), qty),
        shipping: money(p, 'shippingSubsidy'),
        campaign: money(p, 'campaignCost'),
      }),
      rawMerchandise: value(raw),
      limitations: [
        'Product type labels the entered cost scenario. Do not count a fee already included in the base cost twice.',
        'Processing fields are ignored when processing is included.',
      ],
    };
  },
  'recipe-cost-calculator': (p, ctx) => {
    const detail = rowList(p, 'ingredientsJson', [
      'name',
      'packageCost',
      'packageQuantity',
      'usedQuantity',
      'unit',
      'wastePercent',
    ]).map((row, i) => {
      check(ctx);
      if (typeof row.unit !== 'string' || row.unit.trim() === '' || row.unit.length > 30)
        fail(
          'unit',
          `Row ${i + 1}: supply the same quantity unit for package and use (1–30 characters).`,
        );
      const quantity = decimal(rowNumber(row, 'packageQuantity', i, 0.000001));
      const used = decimal(rowNumber(row, 'usedQuantity', i));
      const waste = rowRate(row, 'wastePercent', i, 100, 0);
      if (cmp(waste, ONE) >= 0) fail('wastePercent', 'Waste must be below 100%.');
      const cost = div(
        mul(rowMoney(row, 'packageCost', i, p), div(used, sub(ONE, waste))),
        quantity,
      );
      return {
        name: typeof row.name === 'string' ? row.name : `Ingredient ${i + 1}`,
        unit: row.unit,
        cost,
      };
    });
    const food = sum(detail.map((row) => row.cost));
    const batch = add(food, money(p, 'laborOverhead'));
    const servings = q(BigInt(count(p, 'servings', 1)));
    const foodPerServing = div(food, servings);
    const fullPerServing = div(batch, servings);
    const target = rate(p, 'targetFoodCostPercent');
    if (!target.n) fail('targetFoodCostPercent', 'Target food cost must be positive.');
    const suggested = div(foodPerServing, target);
    const selling = p.salePriceEnabled ? money(p, 'salePrice') : null;
    if (selling && !selling.n) fail('salePrice', 'Selling price must be positive.');
    return {
      ingredients: detail.map((row) => ({
        name: row.name,
        unit: row.unit,
        rawCost: value(row.cost),
        settledCost: value(settled(row.cost, p)),
      })),
      rawFoodCost: value(food),
      rawBatchCost: value(batch),
      rawFoodCostPerServing: value(foodPerServing),
      rawFullCostPerServing: value(fullPerServing),
      suggestedPrice: value(suggested),
      suggestedPriceRounded: value(settled(suggested, p)),
      achievedFoodCostPercent: selling ? 100 * value(div(foodPerServing, selling)) : null,
      fullMarginPercent: selling ? 100 * value(div(sub(selling, fullPerServing), selling)) : null,
      limitations: [
        'Within each ingredient, package and use quantities must already share the same unit. No guessed mass/volume conversion.',
        'Food-cost percentage excludes labor/overhead; full margin includes them.',
        'Raw fractional serving costs are preserved; settled/display values are rounded estimates.',
      ],
    };
  },
};

export function calculateFinance(
  id: string,
  p: UtilityParams,
  ctx: ToolRunContext,
): UtilityResult | Promise<UtilityResult> {
  if (!Object.hasOwn(calculations, id))
    throw new UtilityInputError('$tool', 'unknown', 'Unknown finance calculator.');
  return calculations[id]!(p, ctx);
}

