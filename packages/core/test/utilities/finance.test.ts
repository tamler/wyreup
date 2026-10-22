import { describe, expect, it } from 'vitest';
import { financeTools } from '../../src/utilities/finance.js';
import type { UtilityParams, UtilityResult } from '../../src/utilities/common.js';

async function run(
  id: string,
  params: UtilityParams,
  signal = new AbortController().signal,
): Promise<UtilityResult> {
  const tool = financeTools.find((item) => item.id === id);
  if (!tool) throw new Error(`Missing ${id}`);
  const outputs = await tool.run([], params, {
    signal,
    executionId: 'finance-known-answer',
    cache: new Map(),
    onProgress() {},
  });
  const blobs = Array.isArray(outputs) ? outputs : [outputs];
  expect(blobs).toHaveLength(1);
  expect(blobs[0]!.type).toBe('application/json');
  return JSON.parse(await blobs[0]!.text()) as UtilityResult;
}
const row = (value: unknown) => JSON.stringify(value);
const sampleOrder = {
  unitPrice: 100,
  quantity: 1,
  customerShipping: 10,
  collectedTax: 10,
  productCost: 40,
  shippingCost: 8,
};
const feeBandsJson = row([{ upperBound: 100, percent: 10 }, { percent: 5 }]);
type Fixture = { id: string; params: UtilityParams; expected: Record<string, unknown> };
const fixtures: Fixture[] = [
  {
    id: 'mortgage-calculator',
    params: {
      price: 120000,
      downPayment: 0,
      APR: 0,
      years: 10,
      annualPropertyTax: 1200,
      annualInsurance: 600,
      monthlyHOA: 50,
    },
    expected: {
      scheduledPayment: 1000,
      monthlyHousing: 1200,
      totalInterest: 0,
      allCashIncludingDownPayment: 144000,
    },
  },
  {
    id: 'loan-calculator',
    params: { principal: 1200, APR: 12, months: 1 },
    expected: { scheduledPayment: 1212, totalInterest: 12, totalPaid: 1212 },
  },
  {
    id: 'tip-calculator',
    params: { bill: 110, taxAmount: 10, billIncludesTax: false, tipPercent: 20, people: 3 },
    expected: { tip: 20, total: 130, shares: [43.34, 43.33, 43.33] },
  },
  {
    id: 'discount-calculator',
    params: { originalPrice: 100, discountRatesJson: row([{ percent: 20 }, { percent: 10 }]) },
    expected: { salePrice: 72, saved: 28, discountPercent: 28 },
  },
  {
    id: 'sales-tax-calculator',
    params: { mode: 'reverse', amount: 110, rate: 10 },
    expected: { subtotal: 100, tax: 10, total: 110 },
  },
  {
    id: 'amazon-fba-profit-calculator',
    params: {
      ...sampleOrder,
      collectedTax: 5,
      referralRate: 10,
      fulfillmentFee: 5,
      storagePerUnit: 1,
      inboundPerUnit: 2,
      sellingPlanPerUnit: 1,
    },
    expected: { totalFees: 17, payout: 93, sellerCost: 51, profit: 42 },
  },
  {
    id: 'etsy-fee-profit-calculator',
    params: {
      ...sampleOrder,
      transactionRate: 10,
      paymentRate: 5,
      paymentFixed: 0.5,
      listingFeePerUnit: 0.2,
    },
    expected: { totalFees: 17.7, payout: 92.3, profit: 44.3 },
  },
  {
    id: 'ebay-fee-profit-calculator',
    params: { ...sampleOrder, finalValuePercent: 10, perOrderFixed: 0.4 },
    expected: { totalFees: 12.4, payout: 97.6, profit: 49.6 },
  },
  {
    id: 'paypal-fee-calculator',
    params: { gross: 100, percent: 10, fixed: 1 },
    expected: { totalFees: 11, net: 89 },
  },
  {
    id: 'stripe-fee-calculator',
    params: { gross: 200, percent: 2, internationalRate: 1, fixed: 0.5 },
    expected: { totalFees: 6.5, net: 193.5 },
  },
  {
    id: 'fuel-trip-cost-calculator',
    params: { distanceMiles: 300, mpg: 30, pricePerGallon: 4, travelers: 3 },
    expected: { consumedFuel: 10, cost: 40, shares: [13.34, 13.33, 13.33], purchaseCount: null },
  },
  {
    id: 'airbnb-host-payout-calculator',
    params: {
      nightlyPrice: 100,
      nights: 2,
      discountRate: 10,
      cleaningFee: 50,
      hostServiceRate: 10,
      collectedTax: 30,
      cleaningCost: 40,
      operatingCost: 20,
    },
    expected: {
      discountedLodging: 180,
      totalFees: 23,
      payout: 207,
      profit: 147,
      cashReceived: 207,
      taxObligation: 0,
    },
  },
  {
    id: 'shopify-profit-margin-calculator',
    params: {
      unitPrice: 100,
      discountPercent: 20,
      customerShipping: 5,
      collectedTax: 8,
      paymentRate: 5,
      paymentFixed: 0.5,
      productCost: 30,
      shippingCost: 6,
      adCost: 10,
      monthlyPlanCost: 100,
      monthlyOrders: 10,
    },
    expected: { totalFees: 5.15, profit: 23.85, revenue: 85 },
  },
  {
    id: 'ev-charging-cost-calculator',
    params: {
      batteryKWh: 60,
      startPercent: 20,
      endPercent: 80,
      efficiencyPercent: 90,
      electricityRate: 0.2,
      batteryConsumptionKWhPer100Miles: 20,
      monthlyMiles: 900,
    },
    expected: {
      addedBatteryEnergyKWh: 36,
      gridEnergyKWh: 40,
      sessionCost: 8,
      monthlyGridKWh: 200,
      monthlyCost: 40,
    },
  },
  {
    id: 'youtube-rpm-calculator',
    params: { views: 250000, RPM: 4 },
    expected: { revenue: 1000, RPM: 4 },
  },
  {
    id: 'patreon-earnings-calculator',
    params: {
      tiersJson: row([{ members: 100, monthlyPrice: 10 }]),
      platformRate: 10,
      paymentRate: 5,
      paymentFixed: 0.3,
    },
    expected: { revenue: 1000, totalFees: 180, payout: 820 },
  },
  {
    id: 'fiverr-fee-calculator',
    params: { projectPrice: 100, extras: 20, sellerFeeRate: 20, sellerExpenses: 10 },
    expected: { totalFees: 24, payout: 96, profit: 86 },
  },
  {
    id: 'upwork-fee-calculator',
    params: { mode: 'hourly', amount: 50, hours: 10, freelancerRate: 10 },
    expected: { totalFees: 50, payout: 450, netHourly: 45 },
  },
  {
    id: 'kdp-royalty-calculator',
    params: { mode: 'ebook70', eligibilityConfirmed: true, price: 10, deliveryCost: 1 },
    expected: {
      rawRoyaltyPerCopy: 6.3,
      royaltyPerCopy: 6.3,
      deliveryApplied: 1,
      effectiveMode: 'ebook70',
    },
  },
  {
    id: 'tiktok-shop-fee-calculator',
    params: {
      unitPrice: 100,
      referralRate: 6,
      affiliateRate: 10,
      productCost: 30,
      shippingCost: 5,
    },
    expected: { totalFees: 16, profit: 49 },
  },
  {
    id: 'square-fee-calculator',
    params: { gross: 80, percent: 2, fixed: 0.2 },
    expected: { totalFees: 1.8, net: 78.2 },
  },
  {
    id: 'poshmark-fee-calculator',
    params: {
      salePrice: 20,
      threshold: 20,
      fixedLowerTier: 3,
      percentUpperTier: 20,
      productCost: 5,
    },
    expected: { totalFees: 4, profit: 11, selectedTier: 'upper' },
  },
  {
    id: 'depop-fee-calculator',
    params: {
      unitPrice: 50,
      customerShipping: 5,
      collectedTax: 5,
      platformRate: 0,
      paymentRate: 5,
      paymentFixed: 0.5,
      boostedRate: 10,
      productCost: 20,
      shippingCost: 5,
    },
    expected: { totalFees: 8.5, payout: 46.5, profit: 21.5 },
  },
  {
    id: 'mercari-profit-calculator',
    params: { ...sampleOrder, sellerRate: 10, paymentRate: 0 },
    expected: { totalFees: 11, profit: 51 },
  },
  {
    id: 'stockx-seller-fee-calculator',
    params: {
      unitPrice: 100,
      transactionRate: 10,
      paymentRate: 3,
      productCost: 40,
      shippingCost: 5,
    },
    expected: { totalFees: 13, payout: 87, profit: 42 },
  },
  {
    id: 'shopify-break-even-roas-calculator',
    params: { AOV: 100, productCost: 60, targetProfitPercent: 10 },
    expected: { contribution: 40, breakEvenROAS: 2.5, allowableAds: 30 },
  },
  {
    id: 'twitch-subscription-revenue-calculator',
    params: {
      tiersJson: row([
        { subscriberCount: 100, netSubscriptionPrice: 4, creatorSharePercent: 50 },
        { subscriberCount: 10, netSubscriptionPrice: 10, creatorSharePercent: 70 },
      ]),
      primeJson: row([{ count: 5, payoutPerSubscription: 2 }]),
      expenses: 10,
    },
    expected: { grossPayout: 280, payout: 280, profit: 270 },
  },
  {
    id: 'twitch-bits-to-usd-converter',
    params: { bits: 12345, viewerBundleEnabled: true, viewerBundleBits: 500, viewerBundlePrice: 7 },
    expected: {
      creatorRevenueUSD: 123.45,
      viewerCost: { rawCost: 172.83, estimatedCost: 172.83, currency: 'USD', currencyDecimals: 2 },
    },
  },
  {
    id: 'gumroad-fee-calculator',
    params: { gross: 100, channelRate: 10, fixed: 1, digitalProductCost: 20 },
    expected: { totalFees: 11, net: 89, profit: 69 },
  },
  {
    id: 'kickstarter-fee-calculator',
    params: {
      campaignGoal: 10000,
      pledgedAmount: 10000,
      successConfirmed: true,
      failedPledgeRate: 10,
      platformRate: 5,
      processingRate: 3,
      processingFixed: 0.2,
      successfulPledgeCount: 900,
    },
    expected: { collected: 9000, totalFees: 900, proceeds: 8100 },
  },
  {
    id: 'printify-profit-calculator',
    params: {
      unitPrice: 20,
      discountPercent: 10,
      quantity: 2,
      productionCost: 8,
      productionShipping: 5,
      customerShipping: 3,
      storefrontPercent: 10,
      storefrontFixed: 0,
    },
    expected: { revenue: 39, totalFees: 3.9, sellerCost: 21, profit: 14.1 },
  },
  {
    id: 'redbubble-profit-calculator',
    params: {
      itemsJson: row([{ basePriceAfterDiscount: 20, markupPercent: 50, quantity: 10 }]),
      platformFeeRate: 20,
      excessMarkupThreshold: 20,
      excessRate: 50,
      periodCap: 40,
    },
    expected: {
      newGrossEarnings: 100,
      newExcessEarnings: 60,
      periodFeeBefore: 0,
      periodFeeAfter: 40,
      incrementalFee: 40,
      netNewArtistEarnings: 60,
    },
  },
  {
    id: 'teespring-profit-calculator',
    params: { productPrice: 25, baseCost: 10, discountRate: 20, quantity: 3 },
    expected: { revenue: 60, sellerCost: 30, profit: 30 },
  },
  {
    id: 'amazon-handmade-fee-calculator',
    params: {
      unitPrice: 100,
      customerShipping: 10,
      referralRate: 15,
      productCost: 40,
      shippingCost: 8,
    },
    expected: { totalFees: 16.5, payout: 93.5, profit: 45.5 },
  },
  {
    id: 'grailed-fee-calculator',
    params: { ...sampleOrder, commissionRate: 10, paymentRate: 5, paymentFixed: 0.5 },
    expected: { totalFees: 16.5, payout: 93.5, profit: 45.5 },
  },
  {
    id: 'reverb-fee-calculator',
    params: { ...sampleOrder, sellingRate: 5, paymentRate: 3, paymentFixed: 0.5 },
    expected: { totalFees: 9.6, profit: 52.4 },
  },
  {
    id: 'discogs-fee-calculator',
    params: {
      unitPrice: 50,
      customerShipping: 10,
      collectedTax: 5,
      marketplaceRate: 10,
      paymentRate: 4,
      paymentFixed: 0.4,
      productCost: 20,
      shippingCost: 8,
    },
    expected: { totalFees: 9, profit: 23 },
  },
  {
    id: 'whatnot-seller-fee-calculator',
    params: { ...sampleOrder, commissionRate: 8, paymentRate: 3, paymentFixed: 0.3 },
    expected: { totalFees: 11.9, profit: 50.1 },
  },
  {
    id: 'ko-fi-fee-calculator',
    params: {
      grossPerPayment: 10,
      paymentCount: 10,
      platformRate: 0,
      processorRate: 3,
      processorFixed: 0.3,
    },
    expected: { totalFees: 6, net: 94 },
  },
  {
    id: 'fourthwall-profit-calculator',
    params: {
      productPrice: 30,
      discountPercent: 10,
      quantity: 2,
      productCost: 10,
      customerShipping: 5,
      shippingSubsidy: 4,
      platformRate: 5,
    },
    expected: { revenue: 59, totalFees: 2.95, sellerCost: 24, profit: 32.05 },
  },
  {
    id: 'recipe-cost-calculator',
    params: {
      ingredientsJson: row([
        { packageCost: 10, packageQuantity: 1000, usedQuantity: 200, unit: 'g' },
        { packageCost: 6, packageQuantity: 12, usedQuantity: 2, unit: 'eggs' },
      ]),
      servings: 3,
      laborOverhead: 3,
      targetFoodCostPercent: 25,
      salePriceEnabled: true,
      salePrice: 4,
    },
    expected: {
      rawFoodCost: 3,
      rawBatchCost: 6,
      rawFullCostPerServing: 2,
      rawFoodCostPerServing: 1,
      suggestedPrice: 4,
      achievedFoodCostPercent: 25,
      fullMarginPercent: 50,
    },
  },
];

describe('finance task calculations', () => {
  it('has exactly the 41 independently specified tools and excludes existing compound interest', () => {
    expect(financeTools.map((tool) => tool.id).sort()).toEqual(
      fixtures.map((fixture) => fixture.id).sort(),
    );
    expect(new Set(financeTools.map((tool) => tool.id)).size).toBe(41);
  });
  for (const fixture of fixtures)
    it(`${fixture.id} calculates an independent known answer`, async () => {
      const result = await run(fixture.id, fixture.params);
      for (const [key, expected] of Object.entries(fixture.expected))
        expect(result[key], key).toEqual(expected);
      expect(result.currency).toBe('USD');
      expect(result.inputs).toBeTruthy();
    });

  it('keeps the reviewed FBA selling-plan and inbound costs outside platform payout', async () => {
    const params = {
      unitPrice: 100,
      customerShipping: 10,
      collectedTax: 5,
      referralRate: 10,
      fulfillmentFee: 5,
      storagePerUnit: 1,
      inboundPerUnit: 2,
      productCost: 40,
      sellingPlanPerUnit: 1,
    };
    expect(await run('amazon-fba-profit-calculator', params)).toMatchObject({
      totalFees: 17,
      payout: 93,
      sellerCost: 43,
      profit: 50,
    });
    expect(await run('amazon-fba-profit-calculator', { ...params, quantity: 2 })).toMatchObject({
      totalFees: 33,
      payout: 177,
      sellerCost: 86,
      profit: 91,
    });
  });
  it('uses bands alone with omitted or invalid inactive scalars; distinguishes marginal and whole', async () => {
    const fba = { unitPrice: 200, feeScheduleEnabled: true, feeBandsJson, fulfillmentFee: 0 };
    expect(await run('amazon-fba-profit-calculator', fba)).toMatchObject({
      totalFees: 15,
      profit: 185,
    });
    expect(await run('amazon-fba-profit-calculator', { ...fba, referralRate: null })).toMatchObject(
      { totalFees: 15 },
    );
    expect(await run('amazon-fba-profit-calculator', { ...fba, referralRate: 99 })).toMatchObject({
      totalFees: 15,
    });
    const ebay = {
      unitPrice: 100,
      customerShipping: 10,
      collectedTax: 10,
      feeScheduleEnabled: true,
      feeBandsJson,
      perOrderFixed: 0.4,
    };
    expect(await run('ebay-fee-profit-calculator', ebay)).toMatchObject({ totalFees: 11.4 });
    expect(
      await run('ebay-fee-profit-calculator', { ...ebay, feeTierMode: 'whole' }),
    ).toMatchObject({ totalFees: 6.4 });
    await expect(
      run('amazon-fba-profit-calculator', { ...fba, feeBandsJson: '[]' }),
    ).rejects.toThrow(/rows/i);
    await expect(
      run('amazon-fba-profit-calculator', { fulfillmentFee: 0, referralRate: null }),
    ).rejects.toMatchObject({ field: 'referralRate', code: 'required' });
  });
  it('pins upper-inclusive fee thresholds, aggregate minimum/cap and quantity-based fixed fees', async () => {
    const params = { feeScheduleEnabled: true, feeBandsJson, fulfillmentFee: 0 };
    expect(await run('amazon-fba-profit-calculator', { ...params, unitPrice: 100 })).toMatchObject({
      totalFees: 10,
    });
    expect(
      await run('amazon-fba-profit-calculator', { ...params, unitPrice: 100.01 }),
    ).toMatchObject({ totalFees: 10 });
    expect(
      await run('amazon-fba-profit-calculator', {
        ...params,
        unitPrice: 1,
        referralMinimum: 0.5,
        referralCapEnabled: true,
        referralCap: 1,
      }),
    ).toMatchObject({ totalFees: 0.5 });
    expect(
      await run('amazon-fba-profit-calculator', {
        ...params,
        unitPrice: 200,
        referralMinimum: 0.5,
        referralCapEnabled: true,
        referralCap: 1,
      }),
    ).toMatchObject({ totalFees: 1 });
    await expect(
      run('amazon-fba-profit-calculator', {
        ...params,
        referralMinimum: 0.5,
        referralCapEnabled: true,
        referralCap: 0.4,
      }),
    ).rejects.toThrow(/cap/i);
    expect(
      await run('etsy-fee-profit-calculator', {
        ...sampleOrder,
        quantity: 2,
        transactionRate: 10,
        paymentRate: 5,
        paymentFixed: 0.5,
        listingFeePerUnit: 0.2,
      }),
    ).toMatchObject({ totalFees: 32.9, payout: 177.1, sellerCost: 88, profit: 89.1 });
  });
  it('calculates fee VAT separately, capped offsite base and explicit tax-inclusive bases', async () => {
    const params = {
      ...sampleOrder,
      transactionRate: 10,
      paymentRate: 5,
      paymentFixed: 0.5,
      listingFeePerUnit: 0.2,
    };
    expect(await run('etsy-fee-profit-calculator', { ...params, feeVAT: 20 })).toMatchObject({
      totalFees: 21.24,
      payout: 88.76,
      profit: 40.76,
    });
    const result = await run('etsy-fee-profit-calculator', {
      ...params,
      offsiteAdRate: 10,
      offsiteCapEnabled: true,
      offsiteCap: 5,
      regulatoryRate: 2,
    });
    expect(result.totalFees).toBe(24.9);
    expect(
      (result.fees as Array<Record<string, unknown>>).find(
        (item) => item.name === 'Offsite advertising',
      ),
    ).toMatchObject({ base: 110, amount: 5 });
    expect(
      await run('etsy-fee-profit-calculator', { ...params, transactionBase: 'charge' }),
    ).toMatchObject({ totalFees: 18.7 });
  });
  it('grosses up exact minor-unit targets, verifies previous increments and scales batches afterward', async () => {
    expect(
      await run('paypal-fee-calculator', {
        mode: 'reverse',
        desiredNet: 100,
        percent: 10,
        fixed: 0,
        transactionCount: 2,
      }),
    ).toMatchObject({ gross: 111.11, totalCharge: 222.22, totalNet: 200 });
    expect(
      await run('paypal-fee-calculator', { gross: 111.1, percent: 10, fixed: 0 }),
    ).toMatchObject({ net: 99.99 });
    expect(
      await run('paypal-fee-calculator', {
        mode: 'reverse',
        desiredNet: 100,
        percent: 2.9,
        fixed: 0.3,
      }),
    ).toMatchObject({ gross: 103.3, net: 100 });
    expect(
      await run('paypal-fee-calculator', { gross: 103.29, percent: 2.9, fixed: 0.3 }),
    ).toMatchObject({ net: 99.99 });
    await expect(
      run('paypal-fee-calculator', { mode: 'reverse', desiredNet: 100, percent: 100, fixed: 0 }),
    ).rejects.toThrow(/slope/i);
    await expect(
      run('paypal-fee-calculator', {
        mode: 'reverse',
        desiredNet: 100,
        percent: 99.999999,
        fixed: 0,
      }),
    ).rejects.toThrow(/100,000/i);
    await expect(
      run('paypal-fee-calculator', { mode: 'reverse', desiredNet: 1e12, percent: 50, fixed: 0 }),
    ).rejects.toThrow(/unattainable/i);
  });
  it('finds global minimum despite two simultaneous rounded fee jumps, using an independent cent oracle', async () => {
    const base = {
      transactionRate: 10,
      paymentRate: 10,
      paymentFixed: 0,
      listingFeePerUnit: 0,
      reverseEnabled: true,
      desiredNet: 0.12,
    };
    const independentlyRoundedNet = (cents: number) => cents - 2 * Math.floor((cents + 5) / 10);
    expect(independentlyRoundedNet(14)).toBe(12);
    expect(independentlyRoundedNet(15)).toBe(11);
    const minimum = Array.from({ length: 31 }, (_, cents) => cents).find(
      (cents) => independentlyRoundedNet(cents) >= 12,
    );
    expect(minimum).toBe(14);
    expect(await run('etsy-fee-profit-calculator', base)).toMatchObject({
      breakEvenMerchandiseCharge: 0.14,
    });
  });
  it('rounds exact decimal ties away from zero and preserves negative seller losses', async () => {
    expect(
      await run('paypal-fee-calculator', { gross: 100.5, percent: 1, fixed: 0 }),
    ).toMatchObject({ totalFees: 1.01 });
    const kdp = await run('kdp-royalty-calculator', {
      mode: 'expanded',
      price: 10,
      userRate: 20,
      printingCost: 3.005,
      currencyDecimals: 3,
    });
    expect(kdp.royaltyPerCopy).toBe(-1.005);
    expect(
      await run('kdp-royalty-calculator', {
        mode: 'expanded',
        price: 1.99,
        userRate: 50,
        printingCost: 2,
      }),
    ).toMatchObject({ rawRoyaltyPerCopy: -1.005, royaltyPerCopy: -1.01 });
    expect(
      await run('fiverr-fee-calculator', {
        projectPrice: 10,
        sellerFeeRate: 20,
        sellerExpenses: 20,
      }),
    ).toMatchObject({ profit: -12 });
  });
  it('settles amortization rows and a zero-rate final residual exactly', async () => {
    const loan = await run('loan-calculator', { principal: 100, APR: 12, months: 2 });
    expect(Math.abs((loan.rawPayment as number) - 10201 / 201)).toBeLessThanOrEqual(1e-9);
    expect(loan.schedule).toEqual([
      { month: 1, payment: 50.75, interest: 1, principal: 49.75, balance: 50.25 },
      { month: 2, payment: 50.75, interest: 0.5, principal: 50.25, balance: 0 },
    ]);
    const mortgage = await run('mortgage-calculator', {
      price: 120000,
      downPayment: 20000,
      APR: 0,
      years: 10,
    });
    expect(mortgage).toMatchObject({ totalPaid: 100000, allCashIncludingDownPayment: 120000 });
    expect(mortgage.lastPayment).toMatchObject({ payment: 833.73, balance: 0 });
    const extra = await run('loan-calculator', {
      principal: 1200,
      APR: 0,
      months: 12,
      extraMonthlyPrincipal: 50,
    });
    expect(extra).toMatchObject({
      scheduledPayment: 100,
      payoffMonths: 8,
      totalPaid: 1200,
      totalInterest: 0,
    });
  });
  it('does not require discount rows in find-percent or optional inactive tank/selling-price fields', async () => {
    expect(
      await run('discount-calculator', { mode: 'find-percent', originalPrice: 100, salePrice: 75 }),
    ).toMatchObject({ discountPercent: 25 });
    expect(
      await run('discount-calculator', {
        mode: 'find-percent',
        originalPrice: 0,
        salePrice: 0,
        discountRatesJson: null,
      }),
    ).toMatchObject({ discountPercent: null });
    await expect(run('discount-calculator', { discountRatesJson: '[]' })).rejects.toThrow(/rows/i);
    expect(
      await run('fuel-trip-cost-calculator', { mpg: 30, pricePerGallon: 4, tankCapacity: null }),
    ).toMatchObject({ purchaseCount: null });
    await expect(
      run('fuel-trip-cost-calculator', {
        mpg: 30,
        pricePerGallon: 4,
        tankEnabled: true,
        tankCapacity: 0,
      }),
    ).rejects.toThrow(/tankCapacity/i);
  });
  it('preserves share remainder cents at zero/three decimal places and complete large-group ranges', async () => {
    expect(
      await run('tip-calculator', { bill: 100, tipPercent: 10, people: 3, currencyDecimals: 0 }),
    ).toMatchObject({ shares: [37, 37, 36] });
    expect(
      await run('tip-calculator', { bill: 1, tipPercent: 0, people: 3, currencyDecimals: 3 }),
    ).toMatchObject({ shares: [0.334, 0.333, 0.333] });
    expect(await run('tip-calculator', { bill: 1, tipPercent: 0, people: 1000000 })).toMatchObject({
      shares: null,
      shareDistribution: [
        { firstPerson: 1, lastPerson: 100, amount: 0.01 },
        { firstPerson: 101, lastPerson: 1000000, amount: 0 },
      ],
    });
  });
  it('separates Airbnb tax cash from earnings and retains zero-discount oracles', async () => {
    const params = {
      nightlyPrice: 100,
      nights: 2,
      cleaningFee: 50,
      hostServiceRate: 10,
      collectedTax: 30,
      cleaningCost: 40,
      operatingCost: 20,
    };
    expect(await run('airbnb-host-payout-calculator', params)).toMatchObject({
      totalFees: 25,
      payout: 225,
      profit: 165,
    });
    expect(
      await run('airbnb-host-payout-calculator', {
        ...params,
        discountRate: 10,
        taxRemittedByPlatform: false,
      }),
    ).toMatchObject({ cashReceived: 237, taxObligation: 30, earningsPayout: 207, profit: 147 });
    expect(
      await run('printify-profit-calculator', {
        unitPrice: 20,
        quantity: 2,
        productionCost: 8,
        productionShipping: 5,
        customerShipping: 3,
        storefrontPercent: 10,
        storefrontFixed: 0,
      }),
    ).toMatchObject({ revenue: 43, totalFees: 4.3, profit: 17.7 });
  });
  it('uses explicit eligibility fallback, VAT and print threshold inclusivity', async () => {
    expect(
      await run('kdp-royalty-calculator', { mode: 'ebook70', price: 10, deliveryCost: 1 }),
    ).toMatchObject({
      royaltyPerCopy: 3.5,
      deliveryApplied: 0,
      effectiveMode: 'ebook35',
      eligibilityStatus: 'fallback',
    });
    expect(
      await run('kdp-royalty-calculator', {
        price: 12,
        priceIncludesVAT: true,
        userVATrate: 20,
        deliveryCost: 1,
      }),
    ).toMatchObject({ taxExclusivePrice: 10, royaltyPerCopy: 3.5 });
    const print = {
      mode: 'print',
      threshold: 9.99,
      lowPercent: 50,
      highPercent: 60,
      printingCost: 3,
    };
    expect(await run('kdp-royalty-calculator', { ...print, price: 9.98 })).toMatchObject({
      rawRoyaltyPerCopy: 1.99,
      royaltyPerCopy: 1.99,
    });
    expect(await run('kdp-royalty-calculator', { ...print, price: 9.99 })).toMatchObject({
      rawRoyaltyPerCopy: 2.994,
      royaltyPerCopy: 2.99,
    });
    await expect(run('kdp-royalty-calculator', { mode: 'custom' })).rejects.toThrow(/option/i);
  });
  it('calculates Redbubble incremental current-period fees, cap reset, exemptions and allocation', async () => {
    const params = fixtures.find((fixture) => fixture.id === 'redbubble-profit-calculator')!.params;
    expect(
      await run('redbubble-profit-calculator', {
        ...params,
        currentPeriodIncludedGrossEarnings: 50,
        currentPeriodIncludedExcessEarnings: 30,
      }),
    ).toMatchObject({
      periodFeeBefore: 25,
      periodFeeAfter: 40,
      incrementalFee: 15,
      netNewArtistEarnings: 85,
    });
    expect(
      await run('redbubble-profit-calculator', {
        ...params,
        currentPeriodIncludedGrossEarnings: 100,
        currentPeriodIncludedExcessEarnings: 60,
      }),
    ).toMatchObject({ incrementalFee: 0, netNewArtistEarnings: 100 });
    expect(
      await run('redbubble-profit-calculator', { ...params, accountTier: 'Premium' }),
    ).toMatchObject({ incrementalFee: 40 });
    expect(
      await run('redbubble-profit-calculator', {
        ...params,
        accountTier: 'Pro',
        platformFeeRate: null,
        excessRate: null,
        excessMarkupThreshold: null,
        periodCap: null,
      }),
    ).toMatchObject({ incrementalFee: 0, netNewArtistEarnings: 100, newExcessEarnings: null });
    await expect(
      run('redbubble-profit-calculator', { ...params, priorMonthGross: 0 }),
    ).rejects.toThrow(/unknown/i);
    await expect(
      run('redbubble-profit-calculator', { ...params, currentPeriodIncludedExcessEarnings: 1 }),
    ).rejects.toThrow(/excess/i);
    const allocated = await run('redbubble-profit-calculator', {
      ...params,
      itemsJson: row([
        { basePriceAfterDiscount: 0.01, markupPercent: 100, quantity: 1 },
        { basePriceAfterDiscount: 0.01, markupPercent: 100, quantity: 1 },
        { basePriceAfterDiscount: 0.01, markupPercent: 100, quantity: 1 },
      ]),
      platformFeeRate: 33.333333,
      excessRate: 0,
      excessMarkupThreshold: 100,
    });
    expect(allocated.incrementalFee).toBe(0.01);
    expect(allocated.items).toEqual([
      {
        name: 'Item 1',
        quantity: 1,
        retailPerUnit: 0.02,
        rawArtistEarnings: 0.01,
        feeAllocation: 0.01,
      },
      {
        name: 'Item 2',
        quantity: 1,
        retailPerUnit: 0.02,
        rawArtistEarnings: 0.01,
        feeAllocation: 0,
      },
      {
        name: 'Item 3',
        quantity: 1,
        retailPerUnit: 0.02,
        rawArtistEarnings: 0.01,
        feeAllocation: 0,
      },
    ]);
  });
  it('uses successful per-member processing bases and excludes buyer tax from Patreon earnings', async () => {
    expect(
      await run('patreon-earnings-calculator', {
        tiersJson: row([{ members: 100, monthlyPrice: 10, taxPerMember: 2 }]),
        platformRate: 10,
        paymentRate: 5,
        paymentFixed: 0.3,
      }),
    ).toMatchObject({ payout: 810, collectedTax: 200 });
    expect(
      await run('patreon-earnings-calculator', {
        tiersJson: row([{ members: 10, failedMembers: 2, monthlyPrice: 10 }]),
        platformRate: 10,
        paymentRate: 5,
        paymentFixed: 0.3,
      }),
    ).toMatchObject({ successfulMembers: 8, revenue: 80, totalFees: 14.4 });
    await expect(
      run('patreon-earnings-calculator', {
        tiersJson: row([{ members: 1, failedMembers: 2, monthlyPrice: 10 }]),
        platformRate: 10,
        paymentRate: 5,
        paymentFixed: 0.3,
      }),
    ).rejects.toThrow(/failed/i);
  });
  it('checks raw physical/ratio precision independently rather than rounded display values', async () => {
    const ev = await run('ev-charging-cost-calculator', {
      efficiencyPercent: 90,
      electricityRate: 0.2,
      batteryConsumptionKWhPer100Miles: 20,
    });
    expect(Math.abs((ev.wallConsumptionKWhPer100Miles as number) - 200 / 9)).toBeLessThanOrEqual(
      1e-9,
    );
    expect(Math.abs((ev.costPerMile as number) - 2 / 45)).toBeLessThanOrEqual(1e-9);
    const roas = await run('shopify-break-even-roas-calculator', {
      AOV: 100,
      productCost: 60,
      targetProfitPercent: 10,
    });
    expect(Math.abs((roas.targetROAS as number) - 10 / 3)).toBeLessThanOrEqual(1e-9);
    expect(
      await run('shopify-break-even-roas-calculator', { AOV: 100, productCost: 120 }),
    ).toMatchObject({ breakEvenROAS: null, targetROAS: null });
  });
  it('keeps unreceived crowdfunding at zero and rejects impossible successful-charge counts', async () => {
    expect(await run('kickstarter-fee-calculator', { pledgedAmount: 10000 })).toMatchObject({
      fundingStatus: 'notreceived',
      totalFees: 0,
      proceeds: 0,
    });
    const params = fixtures.find((fixture) => fixture.id === 'kickstarter-fee-calculator')!.params;
    expect(
      await run('kickstarter-fee-calculator', { ...params, pledgedAmount: 9000 }),
    ).toMatchObject({ fundingStatus: 'notfunded', proceeds: 0 });
    expect(
      await run('kickstarter-fee-calculator', {
        ...params,
        failedPledgeRate: 100,
        successfulPledgeCount: 0,
      }),
    ).toMatchObject({ collected: 0, totalFees: 0, proceeds: 0 });
    await expect(
      run('kickstarter-fee-calculator', { ...params, successfulPledgeCount: 0 }),
    ).rejects.toThrow(/count/i);
  });
  it('rejects wrong money precision, currency, numeric types, counts, row schemas and overrides', async () => {
    await expect(
      run('paypal-fee-calculator', { gross: 1.001, percent: 0, fixed: 0 }),
    ).rejects.toThrow(/minor units/i);
    await expect(run('paypal-fee-calculator', { percent: '0', fixed: 0 })).rejects.toThrow(
      /number/i,
    );
    await expect(run('paypal-fee-calculator', { percent: null, fixed: 0 })).rejects.toMatchObject({
      field: 'percent',
      code: 'required',
    });
    await expect(run('paypal-fee-calculator', { percent: 0.1234567, fixed: 0 })).rejects.toThrow(
      /six/i,
    );
    await expect(
      run('paypal-fee-calculator', { percent: 0, fixed: 0, currency: 'usd' }),
    ).rejects.toThrow(/currency/i);
    await expect(run('tip-calculator', { tipPercent: 0, people: 1.5 })).rejects.toMatchObject({
      field: 'people',
      code: 'integer',
    });
    await expect(
      run('twitch-bits-to-usd-converter', { bits: 100, currency: 'EUR' }),
    ).rejects.toThrow(/option/i);
    await expect(
      run('twitch-bits-to-usd-converter', { bits: 100, currencyDecimals: 3 }),
    ).rejects.toThrow(/currencyDecimals/i);
    await expect(
      run('discount-calculator', { discountRatesJson: row([{ percent: 10, injected: true }]) }),
    ).rejects.toThrow(/unknown/i);
    await expect(
      run('discount-calculator', { discountRatesJson: row([{ percent: null }]) }),
    ).rejects.toThrow(/number/i);
    await expect(
      run('recipe-cost-calculator', {
        ingredientsJson: row([
          { packageCost: 1, packageQuantity: 1, usedQuantity: 1, unit: 'g', wastePercent: 100 },
        ]),
        targetFoodCostPercent: 25,
      }),
    ).rejects.toThrow(/waste/i);
  });
  it('supports null undefined ROI at zero investment and fails pre-cancelled operations', async () => {
    expect(await run('fiverr-fee-calculator', { projectPrice: 0, sellerFeeRate: 0 })).toMatchObject(
      {
        margin: null,
        marginStatus: 'undefined, zero denominator',
        ROI: null,
        roiStatus: 'undefined, zero denominator',
      },
    );
    const controller = new AbortController();
    controller.abort();
    await expect(
      run('loan-calculator', { principal: 1000, APR: 10 }, controller.signal),
    ).rejects.toThrow(/cancel/i);
  });
});
