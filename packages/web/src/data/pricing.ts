export interface CreditPack {
  credits: number;
  usd: number;
  label: string;
  featured?: boolean;
}

export const PACKS: CreditPack[] = [
  { credits: 220, usd: 5, label: 'Starter' },
  { credits: 480, usd: 10, label: 'Best value', featured: true },
  { credits: 1000, usd: 20, label: 'Power' },
];

export const MONTHLY: { credits: number; usdPerMonth: number } = {
  credits: 440,
  usdPerMonth: 8,
};

const featuredPack = PACKS.find((p) => p.featured);
if (!featuredPack) {
  throw new Error('PACKS must include a featured pack');
}

/** USD per credit from the featured pack (derived, not hardcoded). */
export const CREDIT_USD = featuredPack.usd / featuredPack.credits;

/** Approximate dollar cost for a credit amount, e.g. "~$0.06" (ceil to cents). */
export function approxUsd(credits: number): string {
  const cents = Math.ceil(credits * CREDIT_USD * 100);
  return `~$${(cents / 100).toFixed(2)}`;
}
