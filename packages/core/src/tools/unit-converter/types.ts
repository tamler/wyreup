export type UnitCategory =
  | 'length' | 'mass' | 'temperature' | 'area' | 'volume'
  | 'speed' | 'data' | 'time';

export interface UnitConverterParams {
  value: number;
  from: string;
  to: string;
  category?: UnitCategory;
}

export const defaultUnitConverterParams: UnitConverterParams = {
  value: 1,
  from: 'km',
  to: 'm',
  category: 'length',
};
