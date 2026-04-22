export interface InvestmentDcaParams {
  monthlyContribution: number;
  priceHistory: number[]; // monthly prices in chronological order
}

export const defaultInvestmentDcaParams: InvestmentDcaParams = {
  monthlyContribution: 500,
  priceHistory: [100, 95, 110, 105, 120, 115, 130, 125, 140, 135, 150, 145],
};
