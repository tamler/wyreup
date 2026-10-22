import type { ParamFieldSchema, ToolModule, ToolRunContext } from '../types.js';
import financeSourceData from './finance-sources.json' with { type: 'json' };
import {
  createUtility,
  numberParam,
  stringParam,
  UtilityInputError,
  type JsonValue,
  type UtilityParams,
} from './common.js';

function fail(field: string, message: string): never {
  throw new UtilityInputError(field, 'bounds', message);
}
function digits(p: UtilityParams): number {
  return numberParam(p, 'currencyDecimals', { min: 0, max: 3, integer: true });
}
function check(ctx: ToolRunContext): void {
  if (ctx.signal.aborted) throw new UtilityInputError('$run', 'abort', 'Calculation cancelled.');
}

type Fields = Record<string, { default: unknown; schema: ParamFieldSchema }>;
type Condition = {
  field: string;
  equals?: string | number | boolean;
  in?: Array<string | number | boolean>;
};
function num(
  defaultValue: number | null,
  label: string,
  minValue = 0,
  maxValue = 1e12,
  integer = false,
  showWhen?: Condition,
): Fields[string] {
  return {
    default: defaultValue,
    schema: {
      type: 'number',
      label,
      min: minValue,
      max: maxValue,
      ...(integer ? { step: 1 } : {}),
      ...(showWhen ? { showWhen } : {}),
    },
  };
}
function percent(
  defaultValue: number | null,
  label: string,
  showWhen?: Condition,
  maxValue = 100,
): Fields[string] {
  return num(defaultValue, `${label} (%)`, 0, maxValue, false, showWhen);
}
function choice(
  defaultValue: string,
  label: string,
  values: string[],
  showWhen?: Condition,
): Fields[string] {
  return {
    default: defaultValue,
    schema: {
      type: 'enum',
      label,
      options: values.map((v) => ({ value: v, label: v })),
      ...(showWhen ? { showWhen } : {}),
    },
  };
}
function bool(defaultValue: boolean, label: string, showWhen?: Condition): Fields[string] {
  return {
    default: defaultValue,
    schema: { type: 'boolean', label, ...(showWhen ? { showWhen } : {}) },
  };
}
function rows(defaultValue: string | null, label: string, showWhen?: Condition): Fields[string] {
  return {
    default: defaultValue,
    schema: {
      type: 'string',
      label,
      maxLength: 100000,
      multiline: true,
      help: 'Use the labeled rows or CSV/TSV preview. Function callers supply a JSON row string.',
      ...(showWhen ? { showWhen } : {}),
    },
  };
}
const currencyFields: Fields = {
  currency: {
    default: 'USD',
    schema: {
      type: 'string',
      label: 'Currency (one uppercase three-letter code)',
      minLength: 3,
      maxLength: 3,
    },
  },
  currencyDecimals: num(2, 'Currency decimal places', 0, 3, true),
};
const sourceUrls: Record<string, string[]> = financeSourceData.sources;
export function financeSourcesForTool(
  id: string,
): Array<{ title: string; url: string; checkedOn: string }> {
  return (sourceUrls[id] ?? []).map((url) => ({
    title: 'Official fee and calculation definitions',
    url,
    checkedOn: financeSourceData.checkedOn,
  }));
}
const tools: ToolModule<UtilityParams>[] = [];
function define(
  id: string,
  name: string,
  description: string,
  fields: Fields,
): void {
  const all = { ...currencyFields, ...fields };
  const sources = financeSourcesForTool(id);
  tools.push(
    createUtility({
      id,
      name,
      description,
      category: 'finance',
      keywords: [name.toLowerCase(), 'calculator', 'cost', 'estimate'],
      seoContent: {
        intro: `${description} All calculations run locally using entered assumptions. ${sources.length ? `Enter your actual plan, contract, territory and payment-method rates; this is an estimate, not a complete current fee schedule or provider quote. Official definitions checked ${financeSourceData.checkedOn}: ${sources.map((source) => source.url).join(' ')}` : 'No automated tax, account or price lookup.'}`,
      },
      defaults: Object.fromEntries(Object.entries(all).map(([k, v]) => [k, v.default])),
      paramSchema: Object.fromEntries(Object.entries(all).map(([k, v]) => [k, v.schema])),
      async calculate(p, ctx) {
        if (!/^[A-Z]{3}$/.test(stringParam(p, 'currency')))
          fail('currency', 'Enter one uppercase three-letter currency code.');
        digits(p);
        check(ctx);
        const { calculateFinance } = await import('./finance-calculations.js');
        check(ctx);
        const result = await calculateFinance(id, p, ctx);
        check(ctx);
        return {
          ...result,
          currency: stringParam(p, 'currency'),
          currencyDecimals: digits(p),
          inputs: p as Record<string, JsonValue>,
          sources,
          assumptions: {
            ratesSource: 'user-supplied',
            exampleCurrency: 'USD is an editable example, not a locale or provider inference.',
            rounding:
              'Half away from zero to declared minor units; estimate, not provider settlement.',
            ratios: 'Margin is profit/revenue and ROI is profit/seller cost, expressed as ratios.',
            ...(sources.length
              ? {
                  providerScope:
                    'Use actual plan, contract, territory and method rates. No complete current provider fee schedule, affiliation or quote.',
                }
              : {}),
          },
          limitations: [
            ...(Array.isArray(result.limitations) ? result.limitations : []),
            'Single currency; no exchange-rate, jurisdictional tax, account data or refund lookup.',
          ],
        };
      },
    }),
  );
}

const orderFields: Fields = {
  unitPrice: num(100, 'Merchandise unit price'),
  quantity: num(1, 'Quantity', 1, 1e6, true),
  discountPercent: percent(0, 'Merchandise discount'),
  customerShipping: num(0, 'Customer shipping paid per order'),
  giftWrap: num(0, 'Customer gift wrap paid per order'),
  collectedTax: num(0, 'Pass-through buyer tax'),
  productCost: num(0, 'Product cost per unit'),
  shippingCost: num(0, 'Seller shipping expense per order'),
  adCost: num(0, 'Advertising cost per order'),
  otherCost: num(0, 'Other seller cost per order'),
  feeVAT: percent(0, 'VAT on fees, if applicable'),
};
function baseField(defaultValue: string, label: string): Fields[string] {
  return choice(defaultValue, label, ['merchandise', 'revenue', 'charge']);
}
function capFields(key: string, label: string): Fields {
  return {
    [`${key}Enabled`]: bool(false, `${label} cap enabled`),
    [key]: num(null, `${label} cap`, 0, 1e12, false, { field: `${key}Enabled`, equals: true }),
  };
}
const scheduleFields: Fields = {
  feeScheduleEnabled: bool(false, 'Use my entered fee bands'),
  feeBandsJson: rows('[]', 'Fee bands', { field: 'feeScheduleEnabled', equals: true }),
  feeTierMode: choice('marginal', 'Band calculation', ['marginal', 'whole'], {
    field: 'feeScheduleEnabled',
    equals: true,
  }),
};

define(
  'tip-calculator',
  'Tip Calculator',
  'Calculate a tax-aware tip and divide the settled bill fairly.',
  {
    bill: num(100, 'Bill including supplied tax'),
    tipPercent: percent(null, 'Tip'),
    people: num(1, 'People', 1, 1e6, true),
    billIncludesTax: bool(true, 'Include supplied tax in tip base'),
    taxAmount: num(0, 'Tax already in bill'),
  },
);
define(
  'discount-calculator',
  'Discount Calculator',
  'Apply ordered stacked discounts or recover a discount percentage.',
  {
    mode: choice('apply', 'Calculation', ['apply', 'find-percent']),
    originalPrice: num(100, 'Original price'),
    discountRatesJson: rows(null, 'Ordered discount rates', { field: 'mode', equals: 'apply' }),
    salePrice: num(null, 'Sale price', 0, 1e12, false, { field: 'mode', equals: 'find-percent' }),
  },
);
define(
  'sales-tax-calculator',
  'Sales Tax Calculator',
  'Add entered sales tax or separate it from a tax-inclusive amount.',
  {
    mode: choice('add', 'Calculation', ['add', 'reverse']),
    amount: num(100, 'Amount'),
    rate: percent(null, 'User-supplied tax rate'),
  },
);

const loanFields: Fields = {
  principal: num(10000, 'Loan principal', 0.001),
  APR: percent(null, 'Annual percentage rate'),
  months: num(12, 'Scheduled months', 1, 1200, true),
  extraMonthlyPrincipal: num(0, 'Additional monthly principal'),
};
define(
  'loan-calculator',
  'Loan Calculator',
  'Estimate fixed-rate monthly payments with an exact settled payoff schedule.',
  loanFields,
);
define(
  'mortgage-calculator',
  'Mortgage Calculator',
  'Model mortgage payments, entered housing costs and additional principal.',
  {
    price: num(300000, 'Property price'),
    downPayment: num(60000, 'Down payment'),
    APR: percent(null, 'Annual percentage rate'),
    years: num(30, 'Loan years', 1, 100, true),
    extraMonthlyPrincipal: num(0, 'Additional monthly principal'),
    annualPropertyTax: num(0, 'Annual property tax'),
    annualInsurance: num(0, 'Annual insurance'),
    monthlyHOA: num(0, 'Monthly HOA'),
    monthlyPMI: num(0, 'Monthly PMI'),
  },
);

function paymentTool(id: string, name: string, extraFields: Fields = {}): void {
  const fields: Fields = {
    mode: choice('forward', 'Calculation', ['forward', 'reverse']),
    gross: num(100, 'Gross charge per transaction', 0, 1e12, false, {
      field: 'mode',
      equals: 'forward',
    }),
    desiredNet: num(100, 'Desired net per transaction', 0, 1e12, false, {
      field: 'mode',
      equals: 'reverse',
    }),
    percent: percent(null, 'Primary processing rate, required'),
    fixed: num(null, 'Fixed fee per transaction, required'),
    additionalRate: percent(0, 'Additional rate, if applicable'),
    minimum: num(0, 'Minimum fee, if applicable'),
    ...capFields('cap', 'Processing fee'),
    feeVAT: percent(0, 'VAT on processing fee'),
    transactionCount: num(1, 'Transactions', 1, 1e6, true),
    ...extraFields,
  };
  define(
    id,
    name,
    'Estimate entered processing fees and the smallest charge for a target net.',
    fields,
  );
}
paymentTool('paypal-fee-calculator', 'PayPal Fee Calculator');
paymentTool('stripe-fee-calculator', 'Stripe Fee Calculator', {
  internationalRate: percent(0, 'International additional rate'),
  manualRate: percent(0, 'Manual-entry additional rate'),
  conversionRate: percent(0, 'Conversion additional rate'),
});
paymentTool('square-fee-calculator', 'Square Fee Calculator', {
  paymentMethod: choice('custom', 'Your payment method label', [
    'card-present',
    'online',
    'manual',
    'custom',
  ]),
});

define(
  'amazon-fba-profit-calculator',
  'Amazon FBA Profit Calculator',
  'Estimate an FBA order using entered referral, fulfillment and seller costs.',
  {
    ...orderFields,
    ...scheduleFields,
    referralRate: percent(null, 'Referral rate, required', {
      field: 'feeScheduleEnabled',
      equals: false,
    }),
    referralMinimum: num(0, 'Referral minimum'),
    ...capFields('referralCap', 'Referral'),
    fulfillmentFee: num(null, 'Fulfillment fee per unit, required'),
    storagePerUnit: num(0, 'Allocated storage per unit'),
    inboundPerUnit: num(0, 'Inbound transport per unit'),
    sellingPlanPerUnit: num(0, 'Your selling-plan allocation per unit'),
  },
);
define(
  'etsy-fee-profit-calculator',
  'Etsy Fee and Profit Calculator',
  'Separate entered listing, transaction, payment, offsite and regulatory fees.',
  {
    ...orderFields,
    listingFeePerUnit: num(null, 'Listing fee per sold unit, required'),
    transactionRate: percent(null, 'Transaction rate, required'),
    transactionBase: baseField('revenue', 'Transaction fee base'),
    paymentRate: percent(null, 'Payment rate, required'),
    paymentFixed: num(null, 'Payment fixed fee per order, required'),
    offsiteAdRate: percent(0, 'Offsite advertising rate, if applicable'),
    offsiteBase: baseField('revenue', 'Offsite advertising base'),
    ...capFields('offsiteCap', 'Offsite advertising'),
    regulatoryRate: percent(0, 'Regulatory fee rate, if applicable'),
    reverseEnabled: bool(false, 'Find break-even merchandise charge'),
    desiredNet: num(0, 'Desired profit after seller costs', 0, 1e12, false, {
      field: 'reverseEnabled',
      equals: true,
    }),
  },
);
define(
  'ebay-fee-profit-calculator',
  'eBay Fee and Profit Calculator',
  'Model final-value bands and a single order fee without duplicate processing.',
  {
    ...orderFields,
    ...scheduleFields,
    finalValuePercent: percent(null, 'Final-value rate, required', {
      field: 'feeScheduleEnabled',
      equals: false,
    }),
    perOrderFixed: num(null, 'Fixed fee per order, required'),
    finalValueMinimum: num(0, 'Final-value minimum'),
    ...capFields('finalValueCap', 'Final-value'),
    finalValueBase: baseField('charge', 'Final-value fee base'),
    promotedListingRate: percent(0, 'Promoted listing rate'),
    promotedBase: baseField('revenue', 'Promoted listing base'),
    insertionFee: num(0, 'Insertion fee per order'),
  },
);

define(
  'fuel-trip-cost-calculator',
  'Fuel Trip Cost Calculator',
  'Estimate fuel consumed, cost split and required fuel purchases.',
  {
    mode: choice('imperial', 'Units', ['imperial', 'metric']),
    distanceMiles: num(300, 'Trip distance (miles)', 0, 1e12, false, {
      field: 'mode',
      equals: 'imperial',
    }),
    mpg: num(null, 'US miles per gallon', 0.000001, 1e12, false, {
      field: 'mode',
      equals: 'imperial',
    }),
    pricePerGallon: num(null, 'Price per US gallon', 0, 1e12, false, {
      field: 'mode',
      equals: 'imperial',
    }),
    distanceKm: num(300, 'Trip distance (km)', 0, 1e12, false, { field: 'mode', equals: 'metric' }),
    LPer100Km: num(null, 'Liters per 100 km', 0.000001, 1e12, false, {
      field: 'mode',
      equals: 'metric',
    }),
    pricePerLiter: num(null, 'Price per liter', 0, 1e12, false, {
      field: 'mode',
      equals: 'metric',
    }),
    travelers: num(1, 'Travelers', 1, 1e6, true),
    tankEnabled: bool(false, 'Estimate fuel purchases using tank size'),
    tankCapacity: num(null, 'Tank capacity in selected fuel unit', 0.000001, 1e12, false, {
      field: 'tankEnabled',
      equals: true,
    }),
    startingFuel: num(0, 'Starting fuel in tank', 0, 1e12, false, {
      field: 'tankEnabled',
      equals: true,
    }),
  },
);
define(
  'airbnb-host-payout-calculator',
  'Airbnb Host Payout Calculator',
  'Apply a lodging discount and separate host earnings from collected tax.',
  {
    nightlyPrice: num(100, 'Nightly price'),
    nights: num(1, 'Nights', 1, 1e6, true),
    cleaningFee: num(0, 'Cleaning fee charged to guest'),
    otherHostFees: num(0, 'Other host fees charged to guest'),
    discountRate: percent(0, 'Lodging-only discount'),
    hostServiceRate: percent(null, 'Host service fee rate, required'),
    feeVAT: percent(0, 'VAT on host service fee'),
    collectedTax: num(0, 'Collected guest tax'),
    taxRemittedByPlatform: bool(true, 'Platform remits collected tax'),
    operatingCost: num(0, 'Other operating cost per stay'),
    cleaningCost: num(0, 'Cleaning expense per stay'),
  },
);
define(
  'shopify-profit-margin-calculator',
  'Shopify Profit Margin Calculator',
  'Estimate an order including entered processing and allocated account costs.',
  {
    ...orderFields,
    paymentRate: percent(null, 'Payment rate, required'),
    paymentFixed: num(null, 'Payment fixed fee, required'),
    additionalTransactionRate: percent(0, 'Additional transaction rate, if applicable'),
    monthlyPlanCost: num(0, 'Monthly plan cost'),
    monthlyAppCost: num(0, 'Monthly app cost'),
    monthlyOrders: num(1, 'Orders used for monthly allocation', 1, 1e6, true),
  },
);
define(
  'ev-charging-cost-calculator',
  'EV Charging Cost Calculator',
  'Estimate grid electricity and costs from battery energy and charging losses.',
  {
    batteryKWh: num(60, 'Battery capacity (kWh)', 0.000001),
    startPercent: percent(20, 'Starting charge'),
    endPercent: percent(80, 'Ending charge'),
    efficiencyPercent: num(null, 'Wall-to-battery efficiency (%)', 0.000001, 100),
    electricityRate: num(null, 'Electricity price per grid kWh'),
    batteryConsumptionKWhPer100Miles: num(
      null,
      'Battery consumption before charging losses (kWh/100 miles)',
      0.000001,
    ),
    monthlyMiles: num(0, 'Monthly miles'),
    fixedSessionFee: num(0, 'Fixed charge per session'),
  },
);
define(
  'youtube-rpm-calculator',
  'YouTube RPM Calculator',
  'Estimate creator revenue from RPM or recover RPM from actual revenue.',
  {
    mode: choice('revenue', 'Calculation', ['revenue', 'rpm']),
    views: num(0, 'Supplied eligible views', 0, 1e12, true),
    RPM: num(null, 'Creator RPM per 1,000 views', 0, 1e12, false, {
      field: 'mode',
      equals: 'revenue',
    }),
    actualRevenue: num(null, 'Actual creator revenue', 0, 1e12, false, {
      field: 'mode',
      equals: 'rpm',
    }),
  },
);
define(
  'patreon-earnings-calculator',
  'Patreon Earnings Calculator',
  'Calculate successful membership charges and per-member processing fees.',
  {
    tiersJson: rows(null, 'Membership tiers'),
    platformRate: percent(null, 'Platform rate, required'),
    paymentRate: percent(null, 'Payment rate, required'),
    paymentFixed: num(null, 'Payment fixed fee per successful member, required'),
    conversionRate: percent(0, 'Additional currency conversion rate'),
    otherFees: num(0, 'Other fees'),
    expenses: num(0, 'Creator expenses'),
  },
);
define(
  'fiverr-fee-calculator',
  'Fiverr Fee Calculator',
  'Estimate seller payout and project profit from entered seller fees.',
  {
    projectPrice: num(100, 'Project price'),
    extras: num(0, 'Project extras'),
    sellerFeeRate: percent(null, 'Seller fee rate, required'),
    sellerExpenses: num(0, 'Seller expenses'),
    withdrawalCost: num(0, 'Withdrawal cost'),
  },
);
define(
  'upwork-fee-calculator',
  'Upwork Fee Calculator',
  'Estimate project or hourly net pay and gross up a target hourly net.',
  {
    mode: choice('project', 'Calculation', ['project', 'hourly', 'gross-up']),
    amount: num(100, 'Project price or gross hourly rate', 0, 1e12, false, {
      field: 'mode',
      in: ['project', 'hourly'],
    }),
    hours: num(1, 'Hours', 0.000001, 1e6, false, { field: 'mode', in: ['hourly', 'gross-up'] }),
    desiredNet: num(null, 'Desired net hourly rate', 0, 1e12, false, {
      field: 'mode',
      equals: 'gross-up',
    }),
    freelancerRate: percent(null, 'Your contract fee rate, required'),
    expenses: num(0, 'Project expenses'),
  },
);
define(
  'kdp-royalty-calculator',
  'KDP Royalty Calculator',
  'Apply explicit ebook eligibility or entered print threshold assumptions.',
  {
    mode: choice('ebook35', 'Royalty mode', ['ebook35', 'ebook70', 'print', 'expanded']),
    eligibilityConfirmed: bool(false, 'I confirm sale/book/territory/price eligibility for 70%', {
      field: 'mode',
      equals: 'ebook70',
    }),
    price: num(10, 'Price per copy'),
    priceIncludesVAT: bool(false, 'Price includes entered VAT'),
    userVATrate: percent(0, 'VAT in price, if applicable'),
    deliveryCost: num(0, 'Delivery cost per ebook', 0, 1e12, false, {
      field: 'mode',
      in: ['ebook35', 'ebook70'],
    }),
    printingCost: num(0, 'Printing cost per copy', 0, 1e12, false, {
      field: 'mode',
      in: ['print', 'expanded'],
    }),
    threshold: num(null, 'Your print price threshold', 0, 1e12, false, {
      field: 'mode',
      equals: 'print',
    }),
    lowPercent: percent(null, 'Print rate below threshold, required', {
      field: 'mode',
      equals: 'print',
    }),
    highPercent: percent(null, 'Print rate at/above threshold, required', {
      field: 'mode',
      equals: 'print',
    }),
    userRate: percent(null, 'Expanded distribution rate, required', {
      field: 'mode',
      equals: 'expanded',
    }),
    units: num(1, 'Copies sold', 1, 1e6, true),
  },
);

function marketplace(
  id: string,
  name: string,
  fields: Fields,
): void {
  define(
    id,
    name,
    'Estimate this order using explicit fee bases and seller costs.',
    { ...orderFields, ...fields },
  );
}
marketplace(
  'tiktok-shop-fee-calculator',
  'TikTok Shop Fee Calculator',
  {
    referralRate: percent(null, 'Referral rate, required'),
    referralBase: baseField('revenue', 'Referral base'),
    affiliateRate: percent(0, 'Affiliate commission, if applicable'),
    affiliateBase: baseField('merchandise', 'Affiliate base'),
    fulfillmentCost: num(0, 'Fulfillment cost per order'),
    returnAllowance: num(0, 'Return allowance per order'),
  },
);
define(
  'poshmark-fee-calculator',
  'Poshmark Fee Calculator',
  'Apply your full-base threshold fee rule and seller shipping discount.',
  {
    salePrice: num(100, 'Merchandise sale price'),
    threshold: num(null, 'Entered threshold, required'),
    fixedLowerTier: num(null, 'Lower-tier fixed fee, required'),
    percentUpperTier: percent(null, 'Upper-tier percentage, required'),
    lowerTierIncludesThreshold: bool(false, 'Lower tier includes the threshold price'),
    shippingDiscount: num(0, 'Seller-funded shipping discount'),
    productCost: num(0, 'Product acquisition cost'),
  },
);
marketplace(
  'depop-fee-calculator',
  'Depop Fee Calculator',
  {
    platformRate: percent(null, 'Platform rate, required; explicit zero allowed'),
    platformBase: baseField('merchandise', 'Platform fee base'),
    paymentRate: percent(null, 'Payment rate, required'),
    paymentFixed: num(null, 'Payment fixed fee, required'),
    paymentBase: baseField('charge', 'Payment fee base'),
    boostedRate: percent(0, 'Boosted listing rate'),
    boostedBase: baseField('merchandise', 'Boosted listing base'),
  },
);
marketplace(
  'mercari-profit-calculator',
  'Mercari Profit Calculator',
  {
    sellerRate: percent(null, 'Seller rate, required'),
    sellerBase: baseField('revenue', 'Seller fee base'),
    paymentRate: percent(null, 'Seller-borne payment rate, required; explicit zero allowed'),
    paymentFixed: num(0, 'Seller-borne payment fixed fee'),
    paymentBase: baseField('charge', 'Payment fee base'),
  },
);
marketplace(
  'stockx-seller-fee-calculator',
  'StockX Seller Fee Calculator',
  {
    transactionRate: percent(null, 'Your seller-level transaction rate, required'),
    paymentRate: percent(null, 'Payment rate, required'),
    paymentBase: baseField('merchandise', 'Payment fee base'),
    levelFixed: num(0, 'Additional seller-level fixed fee'),
  },
);
define(
  'shopify-break-even-roas-calculator',
  'Shopify Break-even ROAS Calculator',
  'Estimate break-even and target ROAS from actual non-advertising order costs.',
  {
    AOV: num(100, 'Average order revenue excluding tax'),
    productCost: num(0, 'Product cost'),
    shippingCost: num(0, 'Shipping cost'),
    fulfillmentCost: num(0, 'Fulfillment cost'),
    paymentCost: num(0, 'Actual payment fees'),
    returnAllowance: num(0, 'Return allowance'),
    allocatedOverhead: num(0, 'Allocated overhead'),
    targetProfitPercent: percent(0, 'Target profit as revenue share'),
  },
);
define(
  'twitch-subscription-revenue-calculator',
  'Twitch Subscription Revenue Calculator',
  'Combine entered net subscription shares and explicit Prime payouts.',
  {
    tiersJson: rows(null, 'Paid subscription tiers'),
    primeJson: rows('[]', 'Prime subscription payouts'),
    otherDeduction: num(0, 'Other creator deductions'),
    expenses: num(0, 'Creator expenses'),
  },
);
define(
  'twitch-bits-to-usd-converter',
  'Twitch Bits to USD Converter',
  'Convert standard eligible chat-Cheer Bits into creator USD revenue.',
  {
    currency: choice('USD', 'Creator currency (fixed)', ['USD']),
    currencyDecimals: num(2, 'Creator decimal places (fixed)', 2, 2, true),
    bits: num(0, 'Eligible chat-Cheer Bits', 0, 1e12, true),
    viewerBundleEnabled: bool(false, 'Estimate viewer cost from my entered bundle'),
    viewerBundleBits: num(null, 'Bits in your viewer bundle', 1, 1e12, true, {
      field: 'viewerBundleEnabled',
      equals: true,
    }),
    viewerBundlePrice: num(null, 'Your viewer bundle price', 0, 1e12, false, {
      field: 'viewerBundleEnabled',
      equals: true,
    }),
    viewerCurrency: {
      default: 'USD',
      schema: {
        type: 'string',
        label: 'Viewer bundle currency (separate)',
        minLength: 3,
        maxLength: 3,
        showWhen: { field: 'viewerBundleEnabled', equals: true },
      },
    },
    viewerCurrencyDecimals: num(2, 'Viewer currency decimal places', 0, 3, true, {
      field: 'viewerBundleEnabled',
      equals: true,
    }),
  },
);

define(
  'gumroad-fee-calculator',
  'Gumroad Fee Calculator',
  'Separate an entered channel fee from optional outside processing charges.',
  {
    channel: choice('direct', 'Channel label (does not select a rate)', [
      'direct',
      'discover',
      'custom',
    ]),
    gross: num(100, 'Gross sale excluding buyer tax'),
    collectedTax: num(0, 'Pass-through buyer tax'),
    channelRate: percent(null, 'Your channel fee rate, required'),
    fixed: num(null, 'Channel fixed fee, required; explicit zero allowed'),
    paymentIncluded: bool(true, 'Processing already included in entered channel fee'),
    separatePaymentRate: percent(null, 'Separate processing rate, required', {
      field: 'paymentIncluded',
      equals: false,
    }),
    separatePaymentFixed: num(null, 'Separate processing fixed fee, required', 0, 1e12, false, {
      field: 'paymentIncluded',
      equals: false,
    }),
    digitalProductCost: num(0, 'Digital product cost'),
  },
);
define(
  'kickstarter-fee-calculator',
  'Kickstarter Fee Calculator',
  'Estimate received proceeds only for an explicitly confirmed funded campaign.',
  {
    campaignGoal: num(10000, 'Campaign goal', 0.001),
    pledgedAmount: num(0, 'Pledged amount'),
    successConfirmed: bool(false, 'I confirm the campaign successfully funded'),
    failedPledgeRate: percent(null, 'Failed collection rate, required', {
      field: 'successConfirmed',
      equals: true,
    }),
    platformRate: percent(null, 'Platform rate, required', {
      field: 'successConfirmed',
      equals: true,
    }),
    processingRate: percent(null, 'Processing rate, required', {
      field: 'successConfirmed',
      equals: true,
    }),
    processingFixed: num(null, 'Processing fixed fee per successful pledge', 0, 1e12, false, {
      field: 'successConfirmed',
      equals: true,
    }),
    successfulPledgeCount: num(null, 'Exact successful pledge count', 0, 1e6, true, {
      field: 'successConfirmed',
      equals: true,
    }),
    fulfillmentCost: num(0, 'Fulfillment cost'),
    campaignCost: num(0, 'Campaign cost'),
  },
);
define(
  'printify-profit-calculator',
  'Printify Profit Calculator',
  'Apply merchandise discounts and entered manufacturing and storefront costs.',
  {
    unitPrice: num(20, 'Merchandise unit price'),
    discountPercent: percent(0, 'Merchandise-only discount'),
    quantity: num(1, 'Units', 1, 1e6, true),
    productionCost: num(null, 'Production cost per unit, required'),
    productionShipping: num(0, 'Production shipping per order'),
    customerShipping: num(0, 'Shipping paid by customer per order'),
    collectedTax: num(0, 'Pass-through buyer tax'),
    storefrontPercent: percent(null, 'Storefront fee rate, required'),
    storefrontFixed: num(null, 'Storefront fixed fee per order, required'),
    adCost: num(0, 'Advertising cost'),
  },
);
define(
  'redbubble-profit-calculator',
  'Redbubble Profit Calculator',
  'Estimate incremental fees from new sales in the same current fee period.',
  {
    itemsJson: rows(null, 'New sales in current fee period'),
    accountTier: choice('Standard', 'Account tier label', ['Standard', 'Premium', 'Pro']),
    platformFeeRate: percent(null, 'Your current-period platform fee rate, required', {
      field: 'accountTier',
      in: ['Standard', 'Premium'],
    }),
    excessMarkupThreshold: percent(
      null,
      'Your excess-markup threshold, required',
      { field: 'accountTier', in: ['Standard', 'Premium'] },
      1000,
    ),
    excessRate: percent(null, 'Your excess-markup fee rate, required', {
      field: 'accountTier',
      in: ['Standard', 'Premium'],
    }),
    periodCap: num(null, 'Your current-period combined fee cap, required', 0, 1e12, false, {
      field: 'accountTier',
      in: ['Standard', 'Premium'],
    }),
    currentPeriodIncludedGrossEarnings: num(
      0,
      'Gross artist earnings already included in this same period',
    ),
    currentPeriodIncludedExcessEarnings: num(
      0,
      'Excess earnings already included in this same period',
    ),
  },
);
define(
  'teespring-profit-calculator',
  'Spring Profit Calculator',
  'Estimate discounted merchandise profit from entered base production costs.',
  {
    productPrice: num(25, 'Product price per unit'),
    baseCost: num(null, 'Base cost per unit, required'),
    discountRate: percent(0, 'Merchandise discount'),
    quantity: num(1, 'Units', 1, 1e6, true),
    sellerShippingSupport: num(0, 'Seller shipping support per order'),
    otherCost: num(0, 'Other seller cost'),
  },
);
marketplace(
  'amazon-handmade-fee-calculator',
  'Amazon Handmade Fee Calculator',
  {
    referralRate: percent(null, 'Referral rate, required'),
    referralMinimum: num(0, 'Referral minimum'),
    sellingPlanAllocation: num(0, 'Seller plan allocation per order'),
  },
);
marketplace(
  'grailed-fee-calculator',
  'Grailed Fee Calculator',
  {
    commissionRate: percent(null, 'Commission rate, required'),
    commissionBase: baseField('merchandise', 'Commission base'),
    paymentRate: percent(null, 'Payment rate, required'),
    paymentFixed: num(null, 'Payment fixed fee, required'),
    paymentBase: baseField('charge', 'Payment base'),
  },
);
marketplace(
  'reverb-fee-calculator',
  'Reverb Fee Calculator',
  {
    sellingRate: percent(null, 'Selling rate, required'),
    sellingMinimum: num(0, 'Selling fee minimum'),
    ...capFields('sellingCap', 'Selling fee'),
    paymentRate: percent(null, 'Payment rate, required'),
    paymentFixed: num(null, 'Payment fixed fee, required'),
    bumpRate: percent(0, 'Bump rate, if applicable'),
    protectionCost: num(0, 'Protection cost'),
  },
);
marketplace(
  'discogs-fee-calculator',
  'Discogs Fee Calculator',
  {
    marketplaceRate: percent(null, 'Marketplace rate, required'),
    marketplaceMinimum: num(0, 'Marketplace fee minimum'),
    ...capFields('marketplaceCap', 'Marketplace fee'),
    paymentRate: percent(null, 'Payment rate, required'),
    paymentFixed: num(null, 'Payment fixed fee, required'),
  },
);
marketplace(
  'whatnot-seller-fee-calculator',
  'Whatnot Seller Fee Calculator',
  {
    commissionRate: percent(null, 'Commission rate, required'),
    commissionBase: baseField('merchandise', 'Commission base'),
    paymentRate: percent(null, 'Payment rate, required'),
    paymentFixed: num(null, 'Payment fixed fee per order, required'),
    giveawayCost: num(0, 'Giveaway cost per order'),
  },
);
define(
  'ko-fi-fee-calculator',
  'Ko-fi Fee Calculator',
  'Estimate per-payment platform and processing fees without assuming free donations.',
  {
    revenueType: choice('donation', 'Revenue label', ['donation', 'membership', 'shop']),
    grossPerPayment: num(10, 'Revenue per payment excluding tax'),
    taxPerPayment: num(0, 'Buyer tax per payment'),
    paymentCount: num(1, 'Payments', 1, 1e6, true),
    platformRate: percent(null, 'Platform rate, required; explicit zero allowed'),
    processorRate: percent(null, 'Processing rate, required'),
    processorFixed: num(null, 'Processing fixed fee per payment, required'),
    accountCost: num(0, 'Monthly account cost'),
    monthlyTransactions: num(1, 'Monthly transactions for account allocation', 1, 1e6, true),
    productCostPerPayment: num(0, 'Product cost per shop payment', 0, 1e12, false, {
      field: 'revenueType',
      equals: 'shop',
    }),
    fulfillmentPerPayment: num(0, 'Fulfillment cost per shop payment', 0, 1e12, false, {
      field: 'revenueType',
      equals: 'shop',
    }),
  },
);
define(
  'fourthwall-profit-calculator',
  'Fourthwall Profit Calculator',
  'Estimate discounted product earnings with explicit included-processing assumptions.',
  {
    productType: choice('catalog', 'Product and cost label', [
      'catalog',
      'self-shipped',
      'digital',
      'membership',
    ]),
    productPrice: num(30, 'Unit product price'),
    discountPercent: percent(0, 'Merchandise discount'),
    quantity: num(1, 'Units', 1, 1e6, true),
    productCost: num(0, 'Your product/base cost per unit'),
    customerShipping: num(0, 'Customer shipping paid per order'),
    shippingSubsidy: num(0, 'Seller shipping subsidy per order'),
    collectedTax: num(0, 'Pass-through buyer tax'),
    platformRate: percent(null, 'Platform rate, required'),
    processingFeeIncluded: bool(true, 'Processing already included in platform fee'),
    paymentRate: percent(null, 'Outside processing rate, required', {
      field: 'processingFeeIncluded',
      equals: false,
    }),
    paymentFixed: num(null, 'Outside processing fixed fee, required', 0, 1e12, false, {
      field: 'processingFeeIncluded',
      equals: false,
    }),
    campaignCost: num(0, 'Campaign cost per order'),
  },
);
define(
  'recipe-cost-calculator',
  'Recipe Cost Calculator',
  'Cost ingredients in matching units and separate food costs from labor and overhead.',
  {
    ingredientsJson: rows(null, 'Recipe ingredients'),
    servings: num(1, 'Servings', 1, 1e6, true),
    laborOverhead: num(0, 'Batch labor and overhead'),
    targetFoodCostPercent: num(null, 'Target food cost (%)', 0.000001, 100),
    salePriceEnabled: bool(false, 'Compare an entered selling price per serving'),
    salePrice: num(null, 'Selling price per serving', 0.001, 1e12, false, {
      field: 'salePriceEnabled',
      equals: true,
    }),
  },
);

export const financeTools = tools;
