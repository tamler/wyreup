export type VcfToCsvFormat = 'csv' | 'json';

export interface VcfToCsvParams {
  format?: VcfToCsvFormat;
}

export interface VcfContactRow {
  name: string;
  given_name: string;
  family_name: string;
  org: string;
  title: string;
  emails: string;
  phones: string;
  address: string;
  birthday: string;
  url: string;
  note: string;
}

export const defaultVcfToCsvParams: VcfToCsvParams = {
  format: 'csv',
};
