export type IcsToCsvFormat = 'csv' | 'json';

export interface IcsToCsvParams {
  /** Output format. Default CSV. */
  format?: IcsToCsvFormat;
  /** Include events whose DTSTART uses the iCalendar DATE value type. Default true. */
  includeAllDay?: boolean;
}

export interface IcsEventRow {
  start: string;
  end: string;
  summary: string;
  location: string;
  description: string;
  status: string;
  all_day: boolean;
  rrule: string;
  uid: string;
}

export const defaultIcsToCsvParams: IcsToCsvParams = {
  format: 'csv',
  includeAllDay: true,
};
